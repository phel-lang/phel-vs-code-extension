import * as assert from 'node:assert/strict';
import { phpFunctionName, phpNetUrl, renderPhpFunctionHover } from '../phelPhpFunctionHover';

describe('phpFunctionName', function () {
    it('reads the function out of a `php/<fn>` token', function () {
        assert.equal(phpFunctionName('php/strtoupper'), 'strtoupper');
        assert.equal(phpFunctionName('php/array_key_exists'), 'array_key_exists');
        assert.equal(phpFunctionName('php/_underscore1'), '_underscore1');
    });

    it('is not fooled by the interop special forms', function () {
        for (const form of [
            'php/new',
            'php/aget',
            'php/aset',
            'php/apush',
            'php/ref',
            'php/oset',
        ]) {
            assert.equal(phpFunctionName(form), undefined, form);
        }
    });

    it('leaves superglobals, member access and Phel symbols alone', function () {
        for (const token of ['php/$_SERVER', 'php/->', 'php/::', 'php/', 'map', 'str/join']) {
            assert.equal(phpFunctionName(token), undefined, token);
        }
    });
});

describe('phpNetUrl', function () {
    it('spells a function page the way the manual does', function () {
        assert.equal(phpNetUrl('strtoupper'), 'https://www.php.net/manual/function.strtoupper.php');
        assert.equal(
            phpNetUrl('str_replace'),
            'https://www.php.net/manual/function.str-replace.php'
        );
        assert.equal(phpNetUrl('mb_strlen'), 'https://www.php.net/manual/function.mb-strlen.php');
        assert.equal(
            phpNetUrl('array_key_exists'),
            'https://www.php.net/manual/function.array-key-exists.php'
        );
    });

    it('lowercases, since PHP function names are case-insensitive', function () {
        assert.equal(phpNetUrl('STRtoUPPER'), 'https://www.php.net/manual/function.strtoupper.php');
    });
});

describe('renderPhpFunctionHover', function () {
    it('leads with the reflected signature when there is one', function () {
        const hover = renderPhpFunctionHover('strtoupper', 'strtoupper(string $string): string');

        assert.equal(
            hover,
            [
                '**`php/strtoupper`** _PHP function_',
                '',
                '```php',
                'strtoupper(string $string): string',
                '```',
                '',
                '[strtoupper on php.net](https://www.php.net/manual/function.strtoupper.php)',
            ].join('\n')
        );
    });

    it('is just the link when no daemon could reflect one', function () {
        const hover = renderPhpFunctionHover('str_replace');

        assert.equal(hover.includes('```'), false);
        assert.match(hover, /\*\*`php\/str_replace`\*\* _PHP function_/);
        assert.match(hover, /https:\/\/www\.php\.net\/manual\/function\.str-replace\.php/);
    });
});
