// The docs panel is one HTML document built at runtime from the shipped
// corpus, so two things are worth pinning: that a docstring can never become
// markup (they come from `.phel` sources, ours and the user's), and that the
// payload the page carries stays small enough to be worth carrying.

import * as assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { PHEL_DOCS } from '../phelCoreDocs';
import type { PhelDoc } from '../phelDocs';
import {
    buildDocsPayload,
    markdownLiteToHtml,
    referenceUrl,
    renderDetailHtml,
    renderDocsPanelHtml,
} from '../phelDocsPanel';

const NONCE = 'test-nonce-0123';

/** A doc whose every free-text field tries to close the document. */
const hostile: PhelDoc = {
    name: 'evil',
    ns: 'demo.evil',
    qualifiedName: 'demo.evil/evil',
    kind: 'fn',
    private: false,
    signature: '(evil <script>alert(1)</script>)',
    doc: 'Ends the page: </script><img src=x onerror="alert(1)"> & "quoted".',
    example: '(evil "</script>")',
};

const map: PhelDoc = {
    name: 'map',
    ns: 'phel.core',
    qualifiedName: 'phel.core/map',
    kind: 'fn',
    private: false,
    signature: '(map f & xs)',
    doc: 'Returns an array consisting of the result of applying `f`.',
    sourceUrl: 'https://github.com/phel-lang/phel-lang/blob/v0.50.0/src/phel/core.phel#L1',
};

describe('buildDocsPayload', function () {
    it('carries one entry per public symbol, in quick-pick order', function () {
        const payload = buildDocsPayload([map, { ...map, name: 'hidden', private: true }]);

        assert.deepEqual(payload, [
            {
                qualifiedName: 'phel.core/map',
                name: 'map',
                ns: 'phel.core',
                signature: '(map f & xs)',
                docFirstLine: 'Returns an array consisting of the result of applying `f`.',
            },
        ]);
    });

    it('keeps only the first docstring line, and copes without one', function () {
        const payload = buildDocsPayload([
            { ...map, doc: 'First line.\nSecond line.' },
            { ...map, qualifiedName: 'phel.core/zap', name: 'zap', doc: undefined },
        ]);

        assert.deepEqual(
            payload.map((entry) => entry.docFirstLine),
            ['First line.', '']
        );
    });

    it('stays well under 300 KB over the real corpus', function () {
        const bytes = Buffer.byteLength(JSON.stringify(buildDocsPayload(PHEL_DOCS)), 'utf-8');

        assert.ok(bytes > 0, 'the corpus produced no payload at all');
        assert.ok(bytes < 300_000, `the search payload is ${bytes} bytes`);
    });
});

describe('renderDocsPanelHtml', function () {
    const html = renderDocsPanelHtml(
        { query: 'ma"p', results: buildDocsPayload([map, hostile]), selected: map },
        NONCE
    );

    it('locks the page down to the nonce it was rendered with', function () {
        assert.match(
            html,
            /content="default-src 'none'; style-src 'nonce-test-nonce-0123'; script-src 'nonce-test-nonce-0123';"/
        );
        assert.match(html, /<style nonce="test-nonce-0123">/);
        assert.match(html, /<script nonce="test-nonce-0123">/);
        // Every `<script>` in the document carries the nonce; a bare one would
        // be silently dropped by the policy above, so it is a bug, not a risk.
        for (const tag of html.match(/<script[^>]*>/g) ?? []) {
            assert.match(tag, /nonce="test-nonce-0123"/, `script tag without a nonce: ${tag}`);
        }
    });

    it('loads nothing from anywhere: no src, no href but the corpus links', function () {
        assert.equal(html.includes('src="'), false);
        for (const href of html.match(/href="[^"]*"/g) ?? []) {
            assert.match(href, /^href="https:\/\//, `local resource in the page: ${href}`);
        }
    });

    it('escapes the query it prefills the search box with', function () {
        assert.match(html, /value="ma&quot;p"/);
    });

    it('cannot have its JSON payload close the script block', function () {
        const payload = html.slice(html.indexOf('id="payload"'));
        assert.equal(payload.slice(0, payload.indexOf('</script>')).includes('</scr'), false);
        assert.ok(payload.includes('\\u003cscript'), 'the hostile signature was not escaped');
    });

    it('renders the selected symbol into the initial detail pane', function () {
        assert.match(html, /data-selected="phel\.core\/map"/);
        assert.match(html, /<code>phel\.core\/map<\/code>/);
    });

    it('ships a script that parses, and stays small enough to inline', function () {
        const script = html.slice(html.lastIndexOf('<script nonce'));
        const source = script.slice(script.indexOf('>') + 1, script.indexOf('</script>'));

        // Nothing else can catch a typo in it: a webview reports its own syntax
        // errors to a console no test can read.
        assert.doesNotThrow(() => new Script(source), 'the panel script does not parse');
        assert.ok(Buffer.byteLength(source, 'utf-8') < 6_000, 'the panel script grew past 6 KB');
    });
});

describe('markdownLiteToHtml', function () {
    it('renders the four things renderDocMarkdown emits', function () {
        const html = markdownLiteToHtml(
            ['**`phel.core/map`** _function_', '', '```phel', '(map f & xs)', '```', ''].join('\n')
        );

        assert.equal(
            html,
            '<p><strong><code>phel.core/map</code></strong> <em>function</em></p>\n' +
                '<pre><code class="lang-phel">(map f &amp; xs)</code></pre>'
        );
    });

    it('links only http(s) targets, and escapes anything else that looks like one', function () {
        assert.equal(
            markdownLiteToHtml('[View source](https://example.test/a.phel#L1)'),
            '<p><a href="https://example.test/a.phel#L1">View source</a></p>'
        );
        assert.equal(
            markdownLiteToHtml('[click](javascript:alert(1))'),
            '<p>[click](javascript:alert(1))</p>'
        );
    });

    it('escapes markup in prose, inline code and fenced code alike', function () {
        const html = markdownLiteToHtml(
            ['<img src=x onerror="alert(1)"> and `<b>`', '', '```php', '<?php echo 1;', '```'].join(
                '\n'
            )
        );

        assert.equal(html.includes('<img'), false);
        assert.equal(html.includes('<b>'), false);
        assert.equal(html.includes('<?php'), false);
        assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
        assert.match(html, /<code>&lt;b&gt;<\/code>/);
    });

    it('leaves emphasis inside a code span alone', function () {
        assert.equal(markdownLiteToHtml('`a_b_c`'), '<p><code>a_b_c</code></p>');
    });
});

describe('renderDetailHtml', function () {
    it('adds the phel-lang.org page for the symbol’s namespace', function () {
        const html = renderDetailHtml(map);

        assert.match(html, /href="https:\/\/phel-lang\.org\/documentation\/reference\/api\/core\//);
        assert.match(html, /href="https:\/\/github\.com\/phel-lang\/phel-lang\/blob\//);
    });

    it('escapes a hostile docstring rather than rendering it', function () {
        const html = renderDetailHtml(hostile);

        assert.equal(html.includes('<img'), false);
        assert.equal(html.includes('</script>'), false);
        assert.match(html, /&lt;\/script&gt;/);
    });

    it('offers no reference link for a namespace the site does not publish', function () {
        assert.equal(renderDetailHtml(hostile).includes('phel-lang.org'), false);
    });
});

describe('referenceUrl', function () {
    it('maps a shipped namespace to its api page', function () {
        assert.equal(
            referenceUrl('phel.core'),
            'https://phel-lang.org/documentation/reference/api/core/'
        );
        assert.equal(
            referenceUrl('phel.test.gen'),
            'https://phel-lang.org/documentation/reference/api/test-gen/'
        );
    });

    it('has nothing to offer for a workspace namespace', function () {
        assert.equal(referenceUrl('demo.strings'), undefined);
        assert.equal(referenceUrl('phel'), undefined);
    });
});
