// Hover for a `php/<fn>` call - `(php/strtoupper text)`, `(php/array_map f a)`.
//
// Two things can be said about a PHP function without guessing, and this module
// is both of them: the signature *this* PHP has for it, which the analysis
// daemon reflects (`completeAtPoint`), and where the manual documents it.
//
// Not the prose. php.net's descriptions are CC-BY, so shipping a copy is a
// licensing obligation, and they move with every PHP release, so the copy would
// be a snapshot that rots. A hand-curated list of the popular few is the same
// treadmill with worse coverage. A reflected signature, by contrast, comes from
// the interpreter that will actually run the code - including the extensions
// this project loads - which no bundled corpus could get right.

import { SPECIAL_FORMS } from './phelCoreSymbols';

/** The `php/…` special forms: interop syntax, not functions on php.net. */
const INTEROP_FORMS = new Set(SPECIAL_FORMS.filter((form) => form.startsWith('php/')));

/** `php/` followed by a PHP function name. Superglobals (`php/$_GET`) are not one. */
const PHP_FUNCTION_TOKEN = /^php\/([A-Za-z_][A-Za-z0-9_]*)$/;

/**
 * The PHP function `token` names, or `undefined` when it names something else
 * (a special form, a superglobal, a Phel symbol).
 */
export function phpFunctionName(token: string): string | undefined {
    if (INTEROP_FORMS.has(token)) {
        return undefined;
    }
    return PHP_FUNCTION_TOKEN.exec(token)?.[1];
}

/**
 * Where php.net documents `name`. The manual spells a function page with
 * hyphens where the name has underscores (`mb_strlen` → `function.mb-strlen`),
 * and the language segment is left out on purpose: php.net redirects to the
 * reader's own language, which a hard-coded `/en/` would override.
 */
export function phpNetUrl(name: string): string {
    return `https://www.php.net/manual/function.${name.toLowerCase().replace(/_/g, '-')}.php`;
}

/** The hover body: the reflected signature when there is one, and the link. */
export function renderPhpFunctionHover(name: string, signature?: string): string {
    const lines = [`**\`php/${name}\`** _PHP function_`, ''];
    if (signature) {
        lines.push('```php', signature, '```', '');
    }
    lines.push(`[${name} on php.net](${phpNetUrl(name)})`);
    return lines.join('\n');
}
