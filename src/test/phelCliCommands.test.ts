import * as assert from 'node:assert/strict';
import { balanceArgs, benchArgs, buildArgs, parseTemplates } from '../phelCliCommands';

// Captured verbatim from `phel init --list-templates`.
const LIST_OUTPUT = [
    'Available templates:',
    '  http-json-api - Minimal HTTP JSON API (phel\\http routing, handlers, public/index.php)',
    '  todo-app - HTTP todo app with an in-memory store and route handlers',
    '  cli-wordcount - CLI word-count tool reading stdin or file arguments',
    '',
    'Scaffold one with: phel init my-app --template=<name>',
].join('\n');

describe('phelCliCommands.parseTemplates', () => {
    it('parses the real --list-templates output', () => {
        const templates = parseTemplates(LIST_OUTPUT);
        assert.deepEqual(
            templates.map((t) => t.name),
            ['http-json-api', 'todo-app', 'cli-wordcount']
        );
        assert.equal(
            templates[0].description,
            'Minimal HTTP JSON API (phel\\http routing, handlers, public/index.php)'
        );
        assert.equal(
            templates[2].description,
            'CLI word-count tool reading stdin or file arguments'
        );
    });

    it('ignores the heading and the usage footer', () => {
        const templates = parseTemplates(LIST_OUTPUT);
        assert.equal(templates.length, 3);
        assert.ok(!templates.some((t) => t.name.includes('Scaffold')));
        assert.ok(!templates.some((t) => t.name === 'Available'));
    });

    it('handles a bare template name with no description', () => {
        const templates = parseTemplates('Available templates:\n  minimal\n');
        assert.deepEqual(templates, [{ name: 'minimal', description: '' }]);
    });

    it('returns an empty array when nothing matches', () => {
        assert.deepEqual(parseTemplates(''), []);
        assert.deepEqual(parseTemplates('No templates found.'), []);
    });
});

describe('phelCliCommands.buildArgs', () => {
    it('returns just "build" with no options', () => {
        assert.deepEqual(buildArgs({}), ['build']);
    });

    it('adds -O with the optimization level', () => {
        assert.deepEqual(buildArgs({ optimizationLevel: '2' }), ['build', '-O', '2']);
        assert.deepEqual(buildArgs({ optimizationLevel: '0' }), ['build', '-O', '0']);
    });

    it('adds --report', () => {
        assert.deepEqual(buildArgs({ report: true }), ['build', '--report']);
    });

    it('combines optimization level and report', () => {
        assert.deepEqual(buildArgs({ optimizationLevel: '2', report: true }), [
            'build',
            '-O',
            '2',
            '--report',
        ]);
    });
});

describe('benchArgs', () => {
    it('runs every benchmark when nothing is set', () => {
        assert.deepEqual(benchArgs(), ['bench']);
        assert.deepEqual(benchArgs({}), ['bench']);
    });

    it('passes paths through before the options', () => {
        assert.deepEqual(benchArgs({ paths: ['tests/bench.phel'], filter: 'sum' }), [
            'bench',
            'tests/bench.phel',
            '--filter=sum',
        ]);
    });

    it('adds each measurement option', () => {
        assert.deepEqual(benchArgs({ revs: 1000, iterations: 5, warmup: 2 }), [
            'bench',
            '--revs=1000',
            '--iterations=5',
            '--warmup=2',
        ]);
    });

    it('adds the baseline options', () => {
        assert.deepEqual(benchArgs({ store: 'base.json', ref: 'base.json', tolerance: 10 }), [
            'bench',
            '--store=base.json',
            '--ref=base.json',
            '--tolerance=10',
        ]);
    });

    it('drops a blank filter rather than passing an empty value', () => {
        // Every bench option takes a value, so `--filter=` would swallow the
        // next argument. An empty input box means "no filter".
        assert.deepEqual(benchArgs({ filter: '' }), ['bench']);
        assert.deepEqual(benchArgs({ filter: '   ' }), ['bench']);
    });

    it('trims a filter typed with surrounding spaces', () => {
        assert.deepEqual(benchArgs({ filter: '  sum  ' }), ['bench', '--filter=sum']);
    });

    it('keeps a zero tolerance, which is not the same as unset', () => {
        assert.deepEqual(benchArgs({ tolerance: 0 }), ['bench', '--tolerance=0']);
    });
});

describe('balanceArgs', () => {
    it('reports without changing anything by default', () => {
        assert.deepEqual(balanceArgs(), ['balance']);
        assert.deepEqual(balanceArgs({ fix: false }), ['balance']);
    });

    it('adds --fix only when asked', () => {
        assert.deepEqual(balanceArgs({ fix: true }), ['balance', '--fix']);
    });

    it('passes paths through', () => {
        assert.deepEqual(balanceArgs({ paths: ['src', 'tests'], fix: true }), [
            'balance',
            'src',
            'tests',
            '--fix',
        ]);
    });
});
