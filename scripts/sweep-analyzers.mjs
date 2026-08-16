// Run every pure analyzer over a corpus of real Phel source and report what
// they produce. The unit tests cover shapes we thought of; this covers the
// shapes people actually write.
//
// It reports two things:
//
//   * exceptions — any analyzer throwing on real input is a bug;
//   * counts — totals per analyzer. A count that looks wrong is worth chasing:
//     this is how the macro-template and sequential-rebinding bugs behind the
//     unused-local hints were found, when phel's own stdlib came back with 98
//     "unused" bindings in code written by the language's authors.
//
// Usage: node scripts/sweep-analyzers.mjs [path/to/phel-checkout-or-dir]
//        Defaults to ../phel-lang/src/phel.
//
// Exits non-zero when an analyzer threw.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(repoRoot, 'out');

if (!existsSync(out)) {
    console.error('out/ not found — run `npm run compile` first.');
    process.exit(2);
}

const paredit = require(join(out, 'phelParedit.js'));
const scope = require(join(out, 'phelScope.js'));
const folding = require(join(out, 'phelFolding.js'));
const references = require(join(out, 'phelReferences.js'));
const nsAnalyzer = require(join(out, 'phelNsAnalyzer.js'));
const docs = require(join(out, 'phelDocs.js'));
const migration = require(join(out, 'phelMigration.js'));
const inlayHints = require(join(out, 'phelInlayHints.js'));
const coreDocs = require(join(out, 'phelCoreDocs.js'));
const docsLookup = require(join(out, 'phelDocsLookup.js'));
const signatureHelp = require(join(out, 'phelSignatureHelp.js'));
const indent = require(join(out, 'phelIndent.js'));

const target = resolve(process.argv[2] ?? join(repoRoot, '..', 'phel-lang', 'src', 'phel'));
if (!existsSync(target)) {
    console.error(`corpus not found: ${target}`);
    console.error('Pass a directory of .phel files, e.g. node scripts/sweep-analyzers.mjs ../phel-lang/src/phel');
    process.exit(2);
}

const files = [];
(function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(p);
        } else if (p.endsWith('.phel')) {
            files.push(p);
        }
    }
})(target);

if (files.length === 0) {
    console.error(`no .phel files under ${target}`);
    process.exit(2);
}

const failures = [];
const totals = {
    forms: 0,
    bindings: 0,
    unused: 0,
    folds: 0,
    symbols: 0,
    requires: 0,
    migrations: 0,
    hints: 0,
    indentLines: 0,
    indentDiffs: 0,
    indentComments: 0,
};
/** The first handful of lines `indentationAt` disagrees with the corpus about. */
const indentDisagreements = [];

/**
 * The arity resolver the inlay-hints provider builds, minus the editor: core
 * corpus only (no workspace index out here), functions only.
 */
function arityResolver(src) {
    const aliases = nsAnalyzer.aliasMapFromSource(src);
    return (name) => {
        const doc = docsLookup.lookupSymbol(name, coreDocs.PHEL_DOCS, aliases);
        if (!doc || doc.kind !== 'fn') {
            return undefined;
        }
        const arities = signatureHelp.aritiesOf(doc);
        return arities.length > 0 ? arities : undefined;
    };
}

/** Run one analyzer, recording any throw against the file it happened on. */
function attempt(file, label, fn) {
    try {
        return fn();
    } catch (err) {
        failures.push(`${basename(file)}: ${label}: ${err.message}`);
        return null;
    }
}

for (const file of files) {
    const src = readFileSync(file, 'utf-8');

    const forms = attempt(file, 'parseAll', () => paredit.parseAll(src));
    totals.forms += forms?.length ?? 0;
    totals.bindings += attempt(file, 'collectAllBindings', () => scope.collectAllBindings(src))?.length ?? 0;
    totals.unused += attempt(file, 'findUnusedLocals', () => scope.findUnusedLocals(src))?.length ?? 0;
    totals.folds += attempt(file, 'computeFoldRanges', () => folding.computeFoldRanges(src))?.length ?? 0;
    totals.symbols += attempt(file, 'parsePhelFile', () => docs.parsePhelFile(src, 'sweep'))?.length ?? 0;
    totals.requires +=
        attempt(file, 'parseNsForm', () => nsAnalyzer.parseNsForm(src))?.requireClause?.entries.length ?? 0;
    // Over a phel-lang checkout this should be near zero: the stdlib was
    // rewritten onto the Clojure-style spelling in 0.50, so a large count means
    // the detector is firing on names it should have treated as shadowed.
    totals.migrations += attempt(file, 'findMigrationIssues', () => migration.findMigrationIssues(src))?.length ?? 0;
    // Whole file rather than a viewport, so the count is comparable run to run.
    // A few thousand over phel's own stdlib is the shape to expect; near zero
    // means the arity match broke, and a jump means a suppression rule did.
    totals.hints +=
        attempt(file, 'parameterHints', () =>
            inlayHints.parameterHints(src, { start: 0, end: src.length }, arityResolver(src))
        )?.length ?? 0;
    attempt(file, 'aliasMapFromSource', () => nsAnalyzer.aliasMapFromSource(src));
    attempt(file, 'findOccurrences', () => references.findOccurrences(src, 'map'));

    // A `phel format`ted corpus is exactly where the on-type indenter should
    // want every line to be, so `indentDiffs` is the measure of how far its
    // mirror of the CLI's rules has drifted. It should read 0. `indentComments`
    // is counted apart because the formatter never re-indents a comment line -
    // it keeps whatever the author wrote - so those are not ours to match.
    attempt(file, 'indentationAt', () => {
        let lineStart = 0;
        for (const line of src.split('\n')) {
            const text = line.trimEnd();
            const want = text === '' ? null : indent.indentationAt(src, lineStart);
            // null: inside a multi-line string, where the leading whitespace is
            // content. Blank lines: the formatter strips them to nothing.
            if (want !== null) {
                totals.indentLines++;
                const have = text.length - text.trimStart().length;
                if (want !== have) {
                    if (text.trimStart().startsWith(';')) {
                        totals.indentComments++;
                    } else {
                        totals.indentDiffs++;
                        if (indentDisagreements.length < 20) {
                            const at = `${basename(file)}:${src.slice(0, lineStart).split('\n').length}`;
                            indentDisagreements.push(`${at}: want ${want}, has ${have}: ${text.trim()}`);
                        }
                    }
                }
            }
            lineStart += line.length + 1;
        }
    });

    // Probe positions across the file: the offset-driven entry points are where
    // an unexpected shape shows up first.
    const step = Math.max(1, Math.floor(src.length / 40));
    for (let offset = 0; offset < src.length; offset += step) {
        attempt(file, `resolveLocalAt@${offset}`, () => scope.resolveLocalAt(src, offset));
        attempt(file, `pathAt@${offset}`, () => paredit.pathAt(forms ?? [], offset));
    }
}

const width = 14;
console.log(`corpus: ${target}`);
console.log(`files:  ${files.length}`);
for (const [name, value] of Object.entries(totals)) {
    console.log(`  ${name.padEnd(width)} ${value}`);
}

if (indentDisagreements.length > 0) {
    console.log(`\nlines indented differently than the corpus has them:`);
    for (const disagreement of indentDisagreements) {
        console.log(`  ${disagreement}`);
    }
}

if (failures.length > 0) {
    console.log(`\nfailures: ${failures.length}`);
    for (const failure of failures.slice(0, 20)) {
        console.log(`  ${failure}`);
    }
    if (failures.length > 20) {
        console.log(`  … and ${failures.length - 20} more`);
    }
    process.exit(1);
}

console.log('\nno analyzer threw.');
