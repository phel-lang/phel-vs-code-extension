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
const totals = { forms: 0, bindings: 0, unused: 0, folds: 0, symbols: 0, requires: 0 };

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
    attempt(file, 'aliasMapFromSource', () => nsAnalyzer.aliasMapFromSource(src));
    attempt(file, 'findOccurrences', () => references.findOccurrences(src, 'map'));

    // Probe positions across the file: the offset-driven entry points are where
    // an unexpected shape shows up first.
    const step = Math.max(1, Math.floor(src.length / 40));
    for (let offset = 0; offset < src.length; offset += step) {
        attempt(file, `resolveLocalAt@${offset}`, () => scope.resolveLocalAt(src, offset));
        attempt(file, `pathAt@${offset}`, () => paredit.pathAt(forms ?? [], offset));
    }
}

const width = 10;
console.log(`corpus: ${target}`);
console.log(`files:  ${files.length}`);
for (const [name, value] of Object.entries(totals)) {
    console.log(`  ${name.padEnd(width)} ${value}`);
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
