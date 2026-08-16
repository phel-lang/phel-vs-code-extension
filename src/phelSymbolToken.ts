// The shape of a Phel symbol token, as the providers see it.
//
// `vscode.TextDocument.getWordRangeAtPosition` needs a regex describing what
// counts as one "word". Phel symbols are far wider than the editor default:
// they may start with punctuation (`->>`, `*ns*`, `+`), carry `?` / `!`
// suffixes (`blank?`, `swap!`), be namespace-qualified (`str/join`, `php/->`),
// and end in `#` (gensyms such as `x#`).
//
// The apostrophe is the awkward one, and the lexer settles it: leading, it is
// the quote reader macro, so `'sym` is a quote followed by the symbol `sym`;
// mid or trailing, it stays inside the atom, so `a'` and `foo''` are single
// symbols. The pattern excludes `'` from the first character and allows it in
// the tail.
//
// Kept `vscode`-free and in one place: seven providers used to carry a
// byte-identical copy, so any change to what counts as a symbol had to be made
// seven times to stay consistent.

/**
 * One Phel symbol token. The first character class excludes the delimiters a
 * symbol can never start with; the tail additionally excludes whitespace and
 * the bracket / quote characters that end a token.
 */
export const PHEL_SYMBOL_RE = /[A-Za-z0-9_!?*+<>=/\-.:$&%][^\s(){}[\]"`,]*/;

/**
 * The symbol token covering column `character` of `lineText`, as a `[start,
 * end)` pair, or `undefined` when that column sits outside any token.
 *
 * `TextDocument.getWordRangeAtPosition` does this for an open buffer; this does
 * it for text read off disk. Both are needed because the analysis daemon
 * reports a reference as the position its token *starts* at and says nothing
 * about how far it runs: assuming the length of the name that was searched for
 * spans `s/sho` of an `s/shout` written in a file nobody has open.
 */
export function symbolTokenAt(
    lineText: string,
    character: number
): { start: number; end: number } | undefined {
    const scanner = new RegExp(PHEL_SYMBOL_RE.source, 'g');
    for (let match = scanner.exec(lineText); match; match = scanner.exec(lineText)) {
        const start = match.index;
        const end = start + match[0].length;
        if (character >= start && character < end) {
            return { start, end };
        }
        if (start > character) {
            return undefined;
        }
    }
    return undefined;
}
