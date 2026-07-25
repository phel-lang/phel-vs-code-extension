// Small shared pieces every language provider needs — kept here so a change
// lands once rather than in five copies.

import * as vscode from 'vscode';
import { PHEL_DOCS } from './phelCoreDocs';
import type { PhelDoc } from './phelDocs';
import { combineDocs } from './phelWorkspaceIndex';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';

/**
 * Workspace symbols layered over the bundled core corpus, or just the corpus
 * when no indexer is running.
 */
export function mergedDocs(indexer?: PhelWorkspaceIndexer): PhelDoc[] {
    return indexer ? combineDocs(indexer.index.allDocs(), PHEL_DOCS) : [...PHEL_DOCS];
}

/**
 * Markdown for a hover / completion popup, with command links and raw HTML
 * disabled — docstrings come from user source and are not trusted input.
 */
export function plainMarkdown(text: string): vscode.MarkdownString {
    const md = new vscode.MarkdownString(text);
    md.isTrusted = false;
    md.supportHtml = false;
    return md;
}
