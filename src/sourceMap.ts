/**
 * Phel Source Map utilities
 *
 * Phel source maps use VLQ encoding (same as JavaScript source maps).
 * The format is:
 * - Lines are separated by semicolons (;)
 * - Segments within a line are separated by commas (,)
 * - Each segment is VLQ-encoded with 4 values:
 *   [generatedColumn, sourceIndex, originalLine, originalColumn]
 */

// VLQ decoding constants
const VLQ_BASE_SHIFT = 5;
const VLQ_BASE = 1 << VLQ_BASE_SHIFT; // 32
const VLQ_BASE_MASK = VLQ_BASE - 1; // 31
const VLQ_CONTINUATION_BIT = VLQ_BASE; // 32

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_MAP: Map<string, number> = new Map();
for (let i = 0; i < BASE64_CHARS.length; i++) {
    BASE64_MAP.set(BASE64_CHARS[i], i);
}

export interface SourceMapping {
    generatedLine: number; // 0-based (from parser), 1-based after adjustment
    generatedColumn: number;
    originalLine: number; // 0-based (from parser), 1-based after adjustment
    originalColumn: number;
}

/**
 * Extended mapping with adjusted line numbers for lookup.
 */
interface AdjustedMapping {
    generatedLine: number; // 1-based with header offset applied
    generatedColumn: number;
    originalLine: number; // 1-based
    originalColumn: number;
}

/**
 * Decode a single VLQ value from the string starting at index.
 * Returns the decoded value and the next index to read from.
 */
function decodeVLQ(encoded: string, index: number): [number, number] {
    let result = 0;
    let shift = 0;
    let continuation = true;

    while (continuation && index < encoded.length) {
        const char = encoded[index++];
        const digit = BASE64_MAP.get(char);

        if (digit === undefined) {
            throw new Error(`Invalid base64 character: ${char}`);
        }

        continuation = (digit & VLQ_CONTINUATION_BIT) !== 0;
        result += (digit & VLQ_BASE_MASK) << shift;
        shift += VLQ_BASE_SHIFT;
    }

    // Convert from VLQ signed representation
    const isNegative = (result & 1) === 1;
    result = result >> 1;

    return [isNegative ? -result : result, index];
}

/**
 * Decode an entire VLQ-encoded segment (4 values)
 */
function decodeSegment(segment: string): number[] {
    const values: number[] = [];
    let index = 0;

    while (index < segment.length) {
        const [value, nextIndex] = decodeVLQ(segment, index);
        values.push(value);
        index = nextIndex;
    }

    return values;
}

/**
 * Parse a Phel source map string into an array of mappings.
 * The source map format is VLQ-encoded, with:
 * - Semicolons separating generated lines
 * - Commas separating segments within a line
 */
export function parseSourceMap(sourceMapString: string): SourceMapping[] {
    const mappings: SourceMapping[] = [];
    const lines = sourceMapString.split(';');

    // Running totals (values are relative in VLQ)
    let generatedColumn = 0;
    let originalLine = 0;
    let originalColumn = 0;

    for (let generatedLine = 0; generatedLine < lines.length; generatedLine++) {
        const line = lines[generatedLine];
        if (line === '') {
            continue;
        }

        // Reset generated column for each new line
        generatedColumn = 0;

        const segments = line.split(',');
        for (const segment of segments) {
            if (segment === '') {
                continue;
            }

            const values = decodeSegment(segment);
            if (values.length >= 4) {
                generatedColumn += values[0];
                // values[1] is source index (always 0 for single file)
                originalLine += values[2];
                originalColumn += values[3];

                mappings.push({
                    generatedLine: generatedLine + 1, // Convert to 1-based
                    generatedColumn,
                    originalLine: originalLine + 1, // Convert to 1-based
                    originalColumn,
                });
            }
        }
    }

    return mappings;
}

/**
 * Patterns that indicate a line is NOT executable (can't set breakpoint).
 * These are typically structural PHP code, not actual statements.
 */
const NON_EXECUTABLE_PATTERNS = [
    /^\s*}\s*[,;]?\s*$/, // Closing brace: }, },  };
    /^\s*\)\s*[,;]?\s*$/, // Closing paren: ), );
    /^\s*\]\s*[,;]?\s*$/, // Closing bracket: ], ];
    /^\s*\)\s*\)\s*[,;]?\s*$/, // Double closing: ));
    /^\s*}\s*\)\s*[,;]?\s*$/, // Mixed closing: });
    /^\s*new\s+class\s*\(/, // Anonymous class declaration start
    /^\s*class\s+\w+/, // Class declaration
    /^\s*public\s+const\s+/, // Constant declaration
    /^\s*private\s+const\s+/, // Private constant
    /^\s*private\s+\$/, // Private property
    /^\s*namespace\s+/, // Namespace declaration
    /^\s*use\s+/, // Use statement
    /^\s*public\s+function\s+__construct/, // Constructor declaration
    /^\s*public\s+function\s+__invoke/, // Invoke method declaration (signature only)
    /^\s*\) extends \\Phel\\Lang\\AbstractFn/, // AbstractFn extends clause
];

/**
 * Patterns that indicate a line IS executable (Phel-specific PHP patterns).
 * These take precedence over generic checks.
 */
const PHEL_EXECUTABLE_PATTERNS = [
    /\$\w+_\d+\s*=/, // Phel variable assignment: $status_1936 =
    /\\Phel::getDefinition\(/, // Function call: \Phel::getDefinition(...)
    /\\Phel::map\(/, // Map literal: \Phel::map(...)
    /\\Phel::vector\(/, // Vector literal: \Phel::vector(...)
    /\\Phel::keyword\(/, // Keyword: \Phel::keyword(...)
    /\\Phel::list\(/, // List literal: \Phel::list(...)
    /\\Phel\\Lang\\Truthy::isTruthy\(/, // If condition
    /^\s*return\s+/, // Return statement
    /^\s*if\s*\(/, // If statement
    /^\s*while\s*\(/, // While loop (from loop/recur)
    /^\s*foreach\s*\(/, // Foreach loop
    /^\s*throw\s+/, // Throw statement
    /^\s*echo\s+/, // Echo/print statement
    /\(\s*\\Phel::getDefinition\([^)]+\)\s*\)\(/, // Function call with invocation
];

/**
 * Check if a PHP line is likely executable (can have a breakpoint).
 * Phel-aware: recognizes compiled Phel patterns.
 */
function isExecutableLine(lineContent: string): boolean {
    const trimmed = lineContent.trim();

    // Empty lines and comments are not executable
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
        return false;
    }

    // Check Phel-specific executable patterns first (positive match)
    for (const pattern of PHEL_EXECUTABLE_PATTERNS) {
        if (pattern.test(trimmed)) {
            return true;
        }
    }

    // Check non-executable patterns (negative match)
    for (const pattern of NON_EXECUTABLE_PATTERNS) {
        if (pattern.test(trimmed)) {
            return false;
        }
    }

    // Default: assume executable if it looks like a statement
    // (ends with semicolon or contains assignment/call)
    if (trimmed.endsWith(';') || trimmed.includes('=') || trimmed.includes('(')) {
        return true;
    }

    return false;
}

/**
 * Source map that allows bidirectional lookups between
 * original (.phel) and generated (.php) line numbers.
 *
 * Column-aware: Tracks exact source positions for expressions on the same line.
 */
export class PhelSourceMap {
    private mappings: SourceMapping[];
    private originalFile: string;
    private generatedFile: string;
    private phpLines: string[] = [];

    // Cached lookups: originalLine -> generatedLines[]
    private originalToGenerated: Map<number, number[]> = new Map();
    // Cached lookups: generatedLine -> originalLine
    private generatedToOriginal: Map<number, number> = new Map();

    // Column-aware mappings: "origLine:origCol" -> AdjustedMapping[]
    private columnMappings: Map<string, AdjustedMapping[]> = new Map();
    // All mappings by original line (includes column info)
    private detailedMappings: Map<number, AdjustedMapping[]> = new Map();

    // The compiled PHP file has 3 header lines added by the cache:
    // 1. <?php
    // 2. // /path/to/source.phel
    // 3. // ;;SOURCEMAP
    // We need to add this offset to source map line numbers
    private static readonly HEADER_OFFSET = 3;

    constructor(
        sourceMapString: string,
        originalFile: string,
        generatedFile: string,
        phpContent?: string
    ) {
        this.mappings = parseSourceMap(sourceMapString);
        this.originalFile = originalFile;
        this.generatedFile = generatedFile;

        // Store PHP content for smart line selection
        if (phpContent) {
            this.phpLines = phpContent.split('\n');
        }

        // Build lookup tables with header offset applied
        for (const mapping of this.mappings) {
            const adjustedGenLine = mapping.generatedLine + PhelSourceMap.HEADER_OFFSET;
            const adjustedMapping: AdjustedMapping = {
                generatedLine: adjustedGenLine,
                generatedColumn: mapping.generatedColumn,
                originalLine: mapping.originalLine,
                originalColumn: mapping.originalColumn,
            };

            // Original to generated (one original line can map to multiple generated lines)
            if (!this.originalToGenerated.has(mapping.originalLine)) {
                this.originalToGenerated.set(mapping.originalLine, []);
            }
            const genLines = this.originalToGenerated.get(mapping.originalLine)!;
            if (!genLines.includes(adjustedGenLine)) {
                genLines.push(adjustedGenLine);
            }

            // Generated to original (use the first/lowest original line for each generated line)
            if (!this.generatedToOriginal.has(adjustedGenLine)) {
                this.generatedToOriginal.set(adjustedGenLine, mapping.originalLine);
            } else {
                const existing = this.generatedToOriginal.get(adjustedGenLine)!;
                if (mapping.originalLine < existing) {
                    this.generatedToOriginal.set(adjustedGenLine, mapping.originalLine);
                }
            }

            // Column-aware mapping: "line:col" -> [mappings]
            const key = `${mapping.originalLine}:${mapping.originalColumn}`;
            if (!this.columnMappings.has(key)) {
                this.columnMappings.set(key, []);
            }
            this.columnMappings.get(key)!.push(adjustedMapping);

            // All detailed mappings by original line
            if (!this.detailedMappings.has(mapping.originalLine)) {
                this.detailedMappings.set(mapping.originalLine, []);
            }
            this.detailedMappings.get(mapping.originalLine)!.push(adjustedMapping);
        }

        // Sort detailed mappings by column for each line
        for (const [, mappings] of this.detailedMappings) {
            mappings.sort((a, b) => a.originalColumn - b.originalColumn);
        }
    }

    /**
     * Get the PHP code at a specific line (1-based).
     */
    getPhpLineContent(line: number): string {
        if (line > 0 && line <= this.phpLines.length) {
            return this.phpLines[line - 1];
        }
        return '';
    }

    /**
     * Get the generated PHP line(s) for an original Phel line.
     * Returns the best matching generated line for debugging.
     *
     * Smart selection for multi-line forms:
     * 1. Direct mapping: If the line has a mapping, use the first executable line
     * 2. Form context: If line is within a multi-line form, find the form's start
     * 3. Fallback: Find next expression (for comments) or previous expression
     */
    getGeneratedLine(originalLine: number): number | null {
        const lines = this.originalToGenerated.get(originalLine);
        if (lines && lines.length > 0) {
            // Sort lines ascending
            const sortedLines = [...lines].sort((a, b) => a - b);

            // Try to find the first executable line
            if (this.phpLines.length > 0) {
                for (const line of sortedLines) {
                    const content = this.getPhpLineContent(line);
                    if (isExecutableLine(content)) {
                        return line;
                    }
                }
            }

            // Fallback: return first line
            return sortedLines[0];
        }

        // No direct mapping - this line might be inside a multi-line form.
        // Strategy: Check if we're between a form start and another mapping

        // Get all mapped original lines sorted
        const allMappedLines = Array.from(this.originalToGenerated.keys()).sort((a, b) => a - b);

        // Find the enclosing mapped lines
        let prevMappedLine: number | null = null;
        let nextMappedLine: number | null = null;

        for (const mappedLine of allMappedLines) {
            if (mappedLine < originalLine) {
                prevMappedLine = mappedLine;
            } else if (mappedLine > originalLine && nextMappedLine === null) {
                nextMappedLine = mappedLine;
                break;
            }
        }

        // Heuristic: If the gap between prev and next is small (< 10 lines),
        // we're likely inside a multi-line form. Use the PREVIOUS line's mapping
        // since that's where the form started.
        if (prevMappedLine !== null && nextMappedLine !== null) {
            const gap = nextMappedLine - prevMappedLine;
            const distToPrev = originalLine - prevMappedLine;
            const distToNext = nextMappedLine - originalLine;

            // If we're closer to the previous mapping and gap is reasonable,
            // use the previous mapping (form continuation)
            if (gap <= 10 && distToPrev <= distToNext) {
                return this.getExecutableLine(prevMappedLine);
            }
        }

        // Prefer next line (for comments/whitespace before code)
        if (nextMappedLine !== null) {
            const distToNext = nextMappedLine - originalLine;
            if (distToNext <= 5) {
                return this.getExecutableLine(nextMappedLine);
            }
        }

        // Fall back to previous line
        if (prevMappedLine !== null) {
            return this.getExecutableLine(prevMappedLine);
        }

        return null;
    }

    /**
     * Get the first executable PHP line for a given original Phel line.
     * Helper for getGeneratedLine fallback logic.
     */
    private getExecutableLine(originalLine: number): number | null {
        const genLines = this.originalToGenerated.get(originalLine);
        if (!genLines || genLines.length === 0) {
            return null;
        }

        const sortedLines = [...genLines].sort((a, b) => a - b);

        // Try to find an executable line
        if (this.phpLines.length > 0) {
            for (const line of sortedLines) {
                const content = this.getPhpLineContent(line);
                if (isExecutableLine(content)) {
                    return line;
                }
            }
        }

        // Return first line as fallback
        return sortedLines[0];
    }

    /**
     * Get the generated PHP line for a specific column position on a Phel line.
     * Useful when multiple expressions are on the same line.
     *
     * @param originalLine 1-based line number
     * @param originalColumn 0-based column number (optional)
     */
    getGeneratedLineAtColumn(originalLine: number, originalColumn?: number): number | null {
        const mappings = this.detailedMappings.get(originalLine);
        if (!mappings || mappings.length === 0) {
            // Fall back to line-based lookup
            return this.getGeneratedLine(originalLine);
        }

        // If no column specified, return the first executable mapping
        if (originalColumn === undefined) {
            for (const mapping of mappings) {
                const content = this.getPhpLineContent(mapping.generatedLine);
                if (isExecutableLine(content)) {
                    return mapping.generatedLine;
                }
            }
            return mappings[0].generatedLine;
        }

        // Find the mapping closest to (but not after) the given column
        let bestMapping: AdjustedMapping | null = null;
        for (const mapping of mappings) {
            if (mapping.originalColumn <= originalColumn) {
                bestMapping = mapping;
            } else {
                break; // Sorted by column, so we can stop
            }
        }

        if (bestMapping) {
            // Check if it's executable
            const content = this.getPhpLineContent(bestMapping.generatedLine);
            if (isExecutableLine(content)) {
                return bestMapping.generatedLine;
            }
            // Return it anyway as the closest match
            return bestMapping.generatedLine;
        }

        // If column is before all mappings, use the first one
        return mappings[0].generatedLine;
    }

    /**
     * Get all mappings for a specific original line with column info.
     * Returns mappings sorted by column position.
     */
    getDetailedMappings(originalLine: number): AdjustedMapping[] {
        return this.detailedMappings.get(originalLine) || [];
    }

    /**
     * Get multiple candidate lines for a breakpoint.
     * Returns lines sorted by likelihood of being executable.
     *
     * Column-aware: considers all expressions on the same line.
     */
    getBreakpointCandidates(originalLine: number, maxCandidates: number = 5): number[] {
        const candidates: number[] = [];
        const detailedMaps = this.detailedMappings.get(originalLine);

        if (detailedMaps && detailedMaps.length > 0) {
            // Use detailed mappings - includes column-specific mappings
            const uniqueLines = new Set<number>();

            // First pass: collect unique executable lines
            for (const mapping of detailedMaps) {
                const content = this.getPhpLineContent(mapping.generatedLine);
                if (isExecutableLine(content)) {
                    uniqueLines.add(mapping.generatedLine);
                }
            }

            // Second pass: add non-executable lines if needed
            for (const mapping of detailedMaps) {
                uniqueLines.add(mapping.generatedLine);
            }

            // Sort and take top candidates
            const sortedLines = Array.from(uniqueLines).sort((a, b) => a - b);
            for (const line of sortedLines) {
                if (candidates.length >= maxCandidates) {
                    break;
                }
                candidates.push(line);
            }
        } else {
            // Fallback to simple line-based lookup
            const lines = this.originalToGenerated.get(originalLine);
            if (lines && lines.length > 0) {
                const sortedLines = [...lines].sort((a, b) => a - b);

                // Add executable lines first
                for (const line of sortedLines) {
                    if (candidates.length >= maxCandidates) {
                        break;
                    }
                    const content = this.getPhpLineContent(line);
                    if (isExecutableLine(content) && !candidates.includes(line)) {
                        candidates.push(line);
                    }
                }

                // Add remaining lines
                for (const line of sortedLines) {
                    if (candidates.length >= maxCandidates) {
                        break;
                    }
                    if (!candidates.includes(line)) {
                        candidates.push(line);
                    }
                }
            }
        }

        return candidates;
    }

    /**
     * Get all generated PHP lines for an original Phel line.
     */
    getAllGeneratedLines(originalLine: number): number[] {
        return this.originalToGenerated.get(originalLine) || [];
    }

    /**
     * Get the original Phel line for a generated PHP line.
     */
    getOriginalLine(generatedLine: number): number | null {
        const line = this.generatedToOriginal.get(generatedLine);
        if (line !== undefined) {
            return line;
        }

        // Try to find the closest generated line that has a mapping
        let closestLine: number | null = null;
        let closestDist = Infinity;

        for (const [genLine, origLine] of this.generatedToOriginal) {
            const dist = Math.abs(genLine - generatedLine);
            if (dist < closestDist && genLine <= generatedLine) {
                closestDist = dist;
                closestLine = origLine;
            }
        }

        return closestLine;
    }

    getOriginalFile(): string {
        return this.originalFile;
    }

    getGeneratedFile(): string {
        return this.generatedFile;
    }

    getMappings(): SourceMapping[] {
        return this.mappings;
    }
}

/**
 * Extract source map information from a compiled PHP file.
 * The format is:
 * // /path/to/original.phel
 * // ;;VLQENCODEDMAP
 * <?php ...
 */
export function extractSourceMapFromFile(phpContent: string): {
    originalFile: string;
    sourceMap: string;
} | null {
    const lines = phpContent.split('\n');

    // First meaningful line should be the original file path
    let fileLineIndex = -1;
    let mapLineIndex = -1;

    for (let i = 0; i < Math.min(lines.length, 5); i++) {
        const line = lines[i].trim();
        if (line.startsWith('// ') && !line.startsWith('// ;;') && line.endsWith('.phel')) {
            fileLineIndex = i;
        } else if (line.startsWith('// ;;')) {
            mapLineIndex = i;
        }
    }

    if (fileLineIndex === -1 || mapLineIndex === -1) {
        return null;
    }

    const originalFile = lines[fileLineIndex].substring(3).trim();
    const sourceMap = lines[mapLineIndex].substring(5).trim();

    return { originalFile, sourceMap };
}
