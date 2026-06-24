// Small XML helpers shared by the JUnit and Clover report parsers. Both
// reports are flat, attribute-heavy XML, so a full DOM parser would be
// overkill; these cover reading an attribute value and decoding entities.

// Attribute names come from a small fixed set, so the per-name regex is
// compiled once and cached (a coverage report can have thousands of <line>
// elements, each read twice).
const attrRegexCache = new Map<string, RegExp>();

function attrRegex(name: string): RegExp {
    let re = attrRegexCache.get(name);
    if (re === undefined) {
        re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`);
        attrRegexCache.set(name, re);
    }
    return re;
}

/**
 * Read a double- or single-quoted attribute value from a tag's attribute
 * string. Returns the raw value (not entity-decoded); use {@link decodeEntities}
 * on the result when the value may contain entities.
 *
 * Note: the surrounding parsers capture attribute blobs with `[^>]*`, which
 * assumes any literal `>` inside a value is XML-escaped as `&gt;` — true for
 * the PHP XML writer that produces these reports.
 */
export function readAttr(attrs: string, name: string): string | undefined {
    const m = attrRegex(name).exec(attrs);
    if (!m) {
        return undefined;
    }
    return m[2] ?? m[3] ?? '';
}

/** Parse an integer attribute value, returning undefined when absent/invalid. */
export function toInt(value: string | undefined): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : undefined;
}

/** Decode the XML entities that the Phel reporters emit (named + numeric). */
export function decodeEntities(text: string): string {
    if (!text.includes('&')) {
        return text;
    }
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
            String.fromCodePoint(Number.parseInt(code, 16))
        )
        .replace(/&amp;/g, '&'); // last, so we don't double-decode
}
