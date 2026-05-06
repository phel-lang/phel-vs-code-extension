// Tokenize a sample of Phel against syntaxes/phel.tmLanguage.json using the
// same engine VS Code ships (vscode-textmate + vscode-oniguruma). Prints each
// line with its tokens and scopes so highlighting can be verified without
// opening the editor.
//
// Usage: node scripts/tokenize-sample.mjs [path/to/sample.phel]
//        Defaults to scripts/sample.phel.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vscodeTextmate from 'vscode-textmate';
import onigPkg from 'vscode-oniguruma';

const { Registry, parseRawGrammar, INITIAL } = vscodeTextmate;
const oniguruma = onigPkg.default ?? onigPkg;

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const wasmPath = require.resolve('vscode-oniguruma/release/onig.wasm');
const wasmBin = readFileSync(wasmPath).buffer;
await oniguruma.loadWASM(wasmBin);

const grammarPath = join(repoRoot, 'syntaxes', 'phel.tmLanguage.json');
const grammarRaw = readFileSync(grammarPath, 'utf-8');

const registry = new Registry({
    onigLib: Promise.resolve({
        createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
        createOnigString: (str) => new oniguruma.OnigString(str),
    }),
    loadGrammar: () => Promise.resolve(parseRawGrammar(grammarRaw, grammarPath)),
});

const grammar = await registry.loadGrammar('source.phel');
if (!grammar) {
    console.error('failed to load grammar');
    process.exit(1);
}

const samplePath = process.argv[2]
    ? resolve(process.argv[2])
    : join(__dirname, 'sample.phel');
const source = readFileSync(samplePath, 'utf-8');

let ruleStack = INITIAL;
const lines = source.split(/\r?\n/);

for (const [idx, line] of lines.entries()) {
    const result = grammar.tokenizeLine(line, ruleStack);
    ruleStack = result.ruleStack;

    process.stdout.write(`L${String(idx + 1).padStart(3, ' ')} | ${line}\n`);
    for (const tok of result.tokens) {
        const text = line.slice(tok.startIndex, tok.endIndex);
        if (text.trim() === '') continue;
        const scope = tok.scopes.filter((s) => s !== 'source.phel').join(' ');
        process.stdout.write(`     | ${JSON.stringify(text).padEnd(28)} ${scope}\n`);
    }
}
