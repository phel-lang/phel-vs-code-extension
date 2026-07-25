// The shape of a Phel symbol token, as the providers see it.
//
// `vscode.TextDocument.getWordRangeAtPosition` needs a regex describing what
// counts as one "word". Phel symbols are far wider than the editor default:
// they may start with punctuation (`->>`, `*ns*`, `+`), carry `?` / `!`
// suffixes (`blank?`, `swap!`), be namespace-qualified (`str/join`, `php/->`),
// and end in `#` (gensyms such as `x#`).
//
// Two known edges, both long-standing and pinned by tests so a change is a
// deliberate one:
//   * a leading `'` is part of the token, so the word at `'sym` is `'sym`;
//   * a trailing `'` is not, so `a'` yields `a`, even though the lexer accepts
//     the apostrophe as an atom character.
//
// Kept `vscode`-free and in one place: seven providers used to carry a
// byte-identical copy, so any change to what counts as a symbol had to be made
// seven times to stay consistent.

/**
 * One Phel symbol token. The first character class excludes the delimiters a
 * symbol can never start with; the tail additionally excludes whitespace and
 * the bracket / quote characters that end a token.
 */
export const PHEL_SYMBOL_RE = /[A-Za-z0-9_!?*+<>=/\-.':$&%][^\s(){}[\]"',`]*/;
