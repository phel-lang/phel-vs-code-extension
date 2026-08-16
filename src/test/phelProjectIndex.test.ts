// The daemon's project index, read from what the real daemon actually answers.
//
// `src/test/fixtures/apiDaemonResponses.json` was captured from
// `php bin/phel api-daemon` in a phel-lang checkout (v0.50.0-beta), by piping
//
//   {"id":1,"method":"indexProject","params":{"srcDirs":["<checkout>/src/phel"]}}
//   {"id":2,"method":"resolveSymbol","params":{"namespace":"phel.html","symbol":"escape-html"}}
//   {"id":3,"method":"findReferences","params":{"namespace":"phel.html","symbol":"escape-html"}}
//
// into it. The index it answered with holds 1584 definitions across 35
// namespaces, so the fixture keeps three of each kind of entry verbatim and
// only the counts were adjusted to match; the one other edit is the absolute
// path, rewritten from the checkout to `/project`.
//
// Two things the capture settled, both of which this suite pins:
//   - a namespace queried as `phel\html` finds *no* references, because the
//     index keys namespaces in their dotted spelling;
//   - `Location.endLine` / `endCol` are `0` for a reference and only filled in
//     for an `ns` declaration.

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    type PhelProjectIndex,
    type PhelReferencePosition,
    daemonSymbolKey,
    definitionLocation,
    mergeReferences,
    namespaceLocationFor,
    toDefinition,
    toLocations,
    toProjectIndex,
    toVscodeCol,
    toVscodeLine,
    toVscodePosition,
} from '../phelProjectIndex';

const responses = JSON.parse(
    readFileSync(
        join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'apiDaemonResponses.json'),
        {
            encoding: 'utf-8',
        }
    )
) as Record<string, unknown>;

function projectIndex(): PhelProjectIndex {
    const index = toProjectIndex(responses.indexProject);
    assert.ok(index, 'the captured indexProject answer must read as an index');
    return index;
}

describe('phelProjectIndex', () => {
    describe('toVscodeLine / toVscodeCol', () => {
        it('shifts a 1-based position onto the editor’s 0-based one', () => {
            assert.equal(toVscodeLine(24), 23);
            assert.equal(toVscodeCol(15), 14);
        });

        it('reads 0 as unknown rather than as the first line', () => {
            assert.equal(toVscodeLine(0), undefined);
            assert.equal(toVscodeCol(0), undefined);
        });

        it('reads anything that is not a whole positive number as unknown', () => {
            assert.equal(toVscodeLine(-3), undefined);
            assert.equal(toVscodeLine(1.5), undefined);
            assert.equal(toVscodeLine('12'), undefined);
            assert.equal(toVscodeLine(undefined), undefined);
        });

        it('puts a known line with an unknown column at the start of the line', () => {
            assert.deepEqual(toVscodePosition({ line: 7, col: 0 }), { line: 6, character: 0 });
            assert.equal(toVscodePosition({ line: 0, col: 4 }), undefined);
        });
    });

    describe('toProjectIndex', () => {
        it('reads the symbols, references and namespace sites the daemon sent', () => {
            const index = projectIndex();

            assert.deepEqual(index.symbols['phel.html/escape-html'], {
                namespace: 'phel.html',
                name: 'escape-html',
                uri: '/project/src/phel/html.phel',
                line: 24,
                col: 15,
                kind: 'defn',
                signature: ['[s]'],
                docstring: 'Escapes HTML special characters to prevent XSS.',
                private: false,
                deprecated: '',
            });
            assert.equal(index.symbols['phel.http-client/key->string'].private, true);
            assert.equal(index.references['phel.html/escape-html'].length, 3);
            assert.deepEqual(index.namespaceLocations['phel.html'], {
                uri: '/project/src/phel/html.phel',
                line: 1,
                col: 5,
                endLine: 1,
                endCol: 14,
            });
        });

        it('keeps a definition in a file without an `ns` form, keyed by name alone', () => {
            const index = projectIndex();
            const definition = index.symbols['/to-php-array'];

            assert.equal(definition.namespace, '');
            assert.equal(definition.kind, 'def');
            assert.deepEqual(definition.signature, []);
            assert.equal(definition.deprecated, '0.51.0');
        });

        it('keeps a reference key spelled with the alias the source used', () => {
            // `s/includes?` is how two files write `phel.str/includes?`; the
            // index records that spelling, which is the only way to find them.
            const hits = projectIndex().references['s/includes?'];

            assert.equal(hits.length, 2);
            assert.deepEqual(
                hits.map((hit) => hit.uri),
                ['/project/src/phel/http-client.phel', '/project/src/phel/cli.phel']
            );
            assert.equal(hits[0].endLine, 0, 'a reference has no end position');
        });

        it('refuses anything that is not an index', () => {
            assert.equal(toProjectIndex(null), undefined);
            assert.equal(toProjectIndex([]), undefined);
            assert.equal(toProjectIndex({ namespaces: 0 }), undefined);
        });
    });

    describe('namespaceLocationFor', () => {
        it('finds a namespace written with either separator', () => {
            const index = projectIndex();

            assert.equal(namespaceLocationFor(index, 'phel.html')?.line, 1);
            assert.equal(
                namespaceLocationFor(index, 'phel\\html')?.uri,
                '/project/src/phel/html.phel'
            );
            assert.equal(namespaceLocationFor(index, 'phel.nope'), undefined);
        });
    });

    describe('definitionLocation', () => {
        it('maps the captured resolveSymbol answer onto an editor position', () => {
            const definition = toDefinition(responses.resolveSymbol);

            assert.deepEqual(definitionLocation(definition), {
                uri: '/project/src/phel/html.phel',
                line: 23,
                character: 14,
            });
        });

        it('reads the answer for an unknown symbol as no definition', () => {
            // The daemon answers `null` rather than an error.
            assert.equal(toDefinition(responses.resolveSymbolMissing), undefined);
            assert.equal(definitionLocation(undefined), undefined);
        });

        it('has no location for a definition the reader could not place', () => {
            const definition = toDefinition({ name: 'x', uri: '/a.phel', line: 0, col: 0 });

            assert.equal(definitionLocation(definition), undefined);
        });
    });

    describe('toLocations', () => {
        it('maps the captured findReferences answer', () => {
            const locations = toLocations(responses.findReferences);

            assert.deepEqual(
                locations.map((location) => toVscodePosition(location)),
                [
                    { line: 23, character: 14 },
                    { line: 93, character: 44 },
                    { line: 93, character: 73 },
                ]
            );
        });

        it('reads a symbol with no references as an empty list', () => {
            assert.deepEqual(toLocations([]), []);
            assert.deepEqual(toLocations(null), []);
        });
    });

    describe('daemonSymbolKey', () => {
        const aliases = new Map([['s', 'phel.str']]);

        it('anchors a bare name to the namespace of the file it is written in', () => {
            assert.deepEqual(daemonSymbolKey('greet', 'app.main', aliases), {
                namespace: 'app.main',
                symbol: 'greet',
            });
        });

        it('resolves an alias through the file’s `:require` entries', () => {
            assert.deepEqual(daemonSymbolKey('s/includes?', 'app.main', aliases), {
                namespace: 'phel.str',
                symbol: 'includes?',
            });
        });

        it('takes an unaliased prefix for the namespace it already is', () => {
            assert.deepEqual(daemonSymbolKey('phel.html/escape-html', 'app.main', aliases), {
                namespace: 'phel.html',
                symbol: 'escape-html',
            });
        });

        it('has no key for a token that cannot name a definition', () => {
            assert.equal(daemonSymbolKey('', 'app.main', aliases), undefined);
            assert.equal(daemonSymbolKey('str/', 'app.main', aliases), undefined);
            assert.equal(daemonSymbolKey('/join', 'app.main', aliases), undefined);
        });
    });

    describe('mergeReferences', () => {
        const hit = (file: string, line: number, character = 0): PhelReferencePosition => ({
            file,
            line,
            character,
        });

        it('adds what only the daemon saw to what the workspace scan found', () => {
            const merged = mergeReferences(
                [hit('file:///a.phel', 9)],
                [hit('file:///a.phel', 2)],
                new Set()
            );

            assert.deepEqual(
                merged.map((entry) => entry.line),
                [2, 9]
            );
        });

        it('reports a position found by both sides once', () => {
            const merged = mergeReferences(
                [hit('file:///a.phel', 2, 6)],
                [hit('file:///a.phel', 2, 6)],
                new Set()
            );

            assert.equal(merged.length, 1);
        });

        it('drops the daemon’s hits in a file with unsaved changes', () => {
            // The daemon read that file off disk, so every position it reports
            // in it is one edit behind what the buffer says.
            const merged = mergeReferences(
                [hit('file:///a.phel', 9), hit('file:///b.phel', 4)],
                [hit('file:///a.phel', 11)],
                new Set(['file:///a.phel'])
            );

            assert.deepEqual(
                merged.map((entry) => `${entry.file}:${entry.line}`),
                ['file:///a.phel:11', 'file:///b.phel:4']
            );
        });
    });
});
