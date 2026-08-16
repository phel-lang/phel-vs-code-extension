import * as vscode from 'vscode';
import {
    lookupSymbol,
    renderDocMarkdown,
    renderLocalMarkdown,
    renderSuperglobalMarkdown,
    renderSupersededMarkdown,
} from './phelDocsLookup';
import { PHP_SUPERGLOBALS } from './phelCoreSymbols';
import { MIGRATIONS } from './phelMigration';
import { aliasMapFromSource } from './phelNsAnalyzer';
import { phpFunctionName, renderPhpFunctionHover } from './phelPhpFunctionHover';
import { resolveLocalAt } from './phelScope';
import type { PhelDaemonSource, PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';
import { folderForDocument } from './phelWorkspace';
import { PHEL_SYMBOL_RE } from './phelSymbolToken';
import { mergedDocs, plainMarkdown } from './phelProviderSupport';

/** The forms deprecated as source in 0.50, keyed by name. */
const SUPERSEDED = new Map(
    MIGRATIONS.filter((e) => e.status === 'deprecated').map((e) => [e.name, e.detail])
);

/** How long a hover waits for the daemon to reflect a PHP signature. */
const SIGNATURE_BUDGET_MS = 400;

export class PhelHoverProvider implements vscode.HoverProvider {
    /**
     * Reflected PHP signatures, by function name. A running PHP cannot change
     * what `strtoupper` takes, so the second hover on one is free - and it is
     * how the first hover's answer arrives at all, when the request that paid
     * for the PHP boot lands after this hover has already been shown.
     */
    private readonly phpSignatures = new Map<string, string>();

    constructor(
        private readonly indexer?: PhelWorkspaceIndexer,
        private readonly daemons?: PhelDaemonSource
    ) {}

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.Hover> {
        const range = document.getWordRangeAtPosition(position, PHEL_SYMBOL_RE);
        if (!range) {
            return null;
        }
        const word = document.getText(range);
        const src = document.getText();

        // A local shadows any global of the same name, and most short parameter
        // names (`name`, `map`, `key`, `count`, …) are also `phel.core`
        // functions — showing those docs here would be plainly wrong.
        const local = resolveLocalAt(src, document.offsetAt(range.start));
        if (local) {
            const declLine = document.lineAt(document.positionAt(local.declStart).line).text;
            const md = plainMarkdown(renderLocalMarkdown(local, declLine));
            return new vscode.Hover(md, range);
        }

        // Neither a superglobal nor a special form is declared in any `.phel`
        // file, so both are checked before the corpus rather than through it.
        const superglobal = PHP_SUPERGLOBALS.get(word);
        if (superglobal) {
            const md = plainMarkdown(renderSuperglobalMarkdown(word, superglobal));
            return new vscode.Hover(md, range);
        }
        const superseded = SUPERSEDED.get(word);
        if (superseded) {
            const md = plainMarkdown(renderSupersededMarkdown(word, superseded));
            return new vscode.Hover(md, range);
        }

        // `php/strtoupper` names a PHP function, which no corpus of ours
        // describes and no `.phel` file declares. The daemon can reflect what
        // this PHP has for it; the manual link is what we can always offer.
        const phpFunction = phpFunctionName(word);
        if (phpFunction) {
            return this.phpFunctionHover(phpFunction, document, range);
        }

        const merged = mergedDocs(this.indexer);
        const aliases = aliasMapFromSource(src);
        const doc = lookupSymbol(word, merged, aliases);
        if (!doc) {
            return null;
        }
        const md = plainMarkdown(renderDocMarkdown(doc));
        return new vscode.Hover(md, range);
    }

    private async phpFunctionHover(
        name: string,
        document: vscode.TextDocument,
        range: vscode.Range
    ): Promise<vscode.Hover> {
        const signature =
            this.phpSignatures.get(name) ??
            (await this.reflectSignature(name, document, range.end));
        return new vscode.Hover(plainMarkdown(renderPhpFunctionHover(name, signature)), range);
    }

    /**
     * The daemon's signature for `name`, if it can be had in
     * `SIGNATURE_BUDGET_MS`. A hover has to appear now, so a daemon that still
     * has to boot PHP loses the race — but the request runs on and fills the
     * cache, so hovering the same call again shows what it found.
     */
    private reflectSignature(
        name: string,
        document: vscode.TextDocument,
        end: vscode.Position
    ): Promise<string | undefined> {
        const folder = folderForDocument(document);
        const client = folder ? this.daemons?.daemonFor(folder) : undefined;
        if (!client) {
            return Promise.resolve(undefined);
        }
        // Completing at the end of the token asks about `php/<name>` with the
        // whole name as the prefix, so the daemon's own reflection decides what
        // it is; the exact label among the answers is this function.
        const wanted = name.toLowerCase();
        const reflected = client
            .completeAtPoint(
                document.getText(),
                end.line + 1,
                end.character + 1,
                `phpHover:${document.uri.toString()}`
            )
            .then((completions) => {
                const detail = completions.find((c) => c.label.toLowerCase() === wanted)?.detail;
                if (detail) {
                    this.phpSignatures.set(name, detail);
                }
                return detail || undefined;
            })
            .catch(() => undefined);
        return withBudget(reflected, SIGNATURE_BUDGET_MS);
    }
}

/** `promise`, or `undefined` once `ms` have passed — whichever comes first. */
function withBudget<T>(promise: Promise<T | undefined>, ms: number): Promise<T | undefined> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(undefined), ms);
        timer.unref?.();
        void promise.then((value) => {
            clearTimeout(timer);
            resolve(value);
        });
    });
}
