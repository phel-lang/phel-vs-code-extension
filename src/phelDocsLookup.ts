// Pure helpers that turn `PhelDoc` records into the things providers need:
// resolve a typed symbol to a doc, and render a doc as Markdown for hover /
// completion popups. Kept free of `vscode` imports so they can be unit-tested
// without booting the editor.

import type { PhelDoc } from './phelDocs';

/**
 * Find the best `PhelDoc` for a typed symbol.
 *
 * - An exact `<ns>/<name>` match always wins.
 * - When `aliases` is provided and `symbol` is `alias/name`, the alias is
 *   resolved to its target namespace before looking up `<ns>/<name>`.
 * - Otherwise look for a public symbol with that bare `name`. Prefer
 *   `phel.core` (the auto-imported namespace), then any other public
 *   namespace, then private definitions as a last resort.
 *
 * Returns `undefined` if nothing matches.
 */
export function lookupSymbol(
    symbol: string,
    docs: readonly PhelDoc[],
    aliases?: ReadonlyMap<string, string>
): PhelDoc | undefined {
    if (!symbol) {
        return undefined;
    }

    if (aliases && symbol.includes('/')) {
        const slash = symbol.indexOf('/');
        const alias = symbol.slice(0, slash);
        const name = symbol.slice(slash + 1);
        const targetNs = aliases.get(alias);
        if (targetNs) {
            const qualified = `${targetNs}/${name}`;
            const aliased = docs.find((d) => d.qualifiedName === qualified);
            if (aliased) {
                return aliased;
            }
        }
    }

    const exact = docs.find((d) => d.qualifiedName === symbol);
    if (exact) {
        return exact;
    }

    const matches = docs.filter((d) => d.name === symbol);
    if (matches.length === 0) {
        return undefined;
    }

    const publicCore = matches.find((d) => !d.private && d.ns === 'phel.core');
    if (publicCore) {
        return publicCore;
    }

    const anyPublic = matches.find((d) => !d.private);
    if (anyPublic) {
        return anyPublic;
    }

    return matches[0];
}

/**
 * Render a `PhelDoc` as a Markdown string suitable for hover popups and
 * completion-item documentation. Each section is omitted if absent.
 */
export function renderDocMarkdown(doc: PhelDoc): string {
    const lines: string[] = [];

    const kindLabel = describeKind(doc);
    lines.push(`**\`${doc.qualifiedName}\`** _${kindLabel}_`);
    lines.push('');

    if (doc.signature) {
        lines.push('```phel');
        lines.push(doc.signature);
        if (doc.arities && doc.arities.length > 1) {
            for (const arity of doc.arities.slice(1)) {
                lines.push(arity);
            }
        }
        lines.push('```');
        lines.push('');
    }

    if (doc.doc) {
        lines.push(doc.doc.trim());
        lines.push('');
    }

    if (doc.example) {
        lines.push('**Example**');
        lines.push('');
        lines.push('```phel');
        lines.push(doc.example.trim());
        lines.push('```');
        lines.push('');
    }

    if (doc.seeAlso && doc.seeAlso.length > 0) {
        lines.push('**See also:** ' + doc.seeAlso.map((s) => `\`${s}\``).join(', '));
        lines.push('');
    }

    if (doc.sourceUrl) {
        lines.push(`[View source](${doc.sourceUrl})`);
    }

    return lines.join('\n').trimEnd();
}

/**
 * Render a hover for a *local* binding. Locals have no doc record, and looking
 * one up by name would surface an unrelated core symbol — most common
 * parameter names (`name`, `map`, `key`, `count`, `str`, …) are also
 * `phel.core` functions.
 *
 * `declLine` is the source line the binding was declared on, trimmed; it gives
 * the reader the binding form without needing a doc record.
 */
export function renderLocalMarkdown(
    binding: { name: string; param?: boolean },
    declLine?: string
): string {
    const lines: string[] = [];
    lines.push(`**\`${binding.name}\`** _${binding.param ? 'parameter' : 'local binding'}_`);
    const trimmed = declLine?.trim();
    if (trimmed) {
        lines.push('');
        lines.push('```phel');
        lines.push(trimmed);
        lines.push('```');
    }
    return lines.join('\n').trimEnd();
}

/**
 * Render a hover for a PHP superglobal (`php/$_SERVER`). No `.phel` file
 * declares one, so there is no doc record to fall back on.
 */
export function renderSuperglobalMarkdown(name: string, description: string): string {
    return [`**\`${name}\`** _PHP superglobal_`, '', description].join('\n');
}

/**
 * Render a hover for a form Phel 0.50 deprecated as source. It still compiles —
 * it is the target the Clojure-style shorthand expands to — so the note says
 * what to write instead rather than claiming the form is broken.
 */
export function renderSupersededMarkdown(name: string, detail: string): string {
    return [
        `**\`${name}\`** _deprecated as source since Phel 0.50_`,
        '',
        `Still compiles — it is what the Clojure-style form expands to — but ${detail}.`,
    ].join('\n');
}

function describeKind(doc: PhelDoc): string {
    const visibility = doc.private ? 'private ' : '';
    switch (doc.kind) {
        case 'fn':
            return `${visibility}function`;
        case 'macro':
            return `${visibility}macro`;
        case 'def':
            return `${visibility}def`;
    }
}
