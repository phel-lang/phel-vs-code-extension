import * as assert from 'node:assert/strict';
import { buildArgs, parseTemplates, shellQuote } from '../phelCliCommands';

describe('phelCliCommands.shellQuote', () => {
    it('leaves simple tokens unquoted', () => {
        assert.equal(shellQuote('test'), 'test');
        assert.equal(shellQuote('vendor/bin/phel'), 'vendor/bin/phel');
        assert.equal(shellQuote('--filter'), '--filter');
    });

    it('quotes arguments containing spaces', () => {
        assert.equal(shellQuote('my test'), "'my test'");
        assert.equal(shellQuote('/path with spaces/phel'), "'/path with spaces/phel'");
    });

    it('quotes shell-significant characters', () => {
        assert.equal(shellQuote('a$b'), "'a$b'");
        assert.equal(shellQuote('a`b'), "'a`b'");
        assert.equal(shellQuote('a"b'), "'a\"b'");
        assert.equal(shellQuote('a\\b'), "'a\\b'");
    });

    it('escapes embedded single quotes', () => {
        assert.equal(shellQuote("it's"), "'it'\\''s'");
    });
});

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
