# Change Log

## [Unreleased]

### Added

- Symbol metadata DB (`src/phelCoreDocs.ts`): 1317 entries across 30 namespaces, regen via `npm run regen-docs`.
- Hover docs: signature, doc, example, see-also, source link.
- Completion items carry full Markdown documentation.
- Signature help with active-param highlight.
- `Phel: Show Documentation` command.
- Diagnostics on save via `phel analyze`.
- Format-on-save via `phel format`.
- CodeLens on `deftest`: ▶ Run test / ▶ Run all tests in file.
- GitHub Actions CI on Node 20 + 22.
- Bracket pair colorization for `.phel`.
- Auto-close pair for `#(...)`.
- Weekly scheduled workflow that regenerates the docs DB from phel-lang `main` and opens a PR.
- Workspace indexer: parses every `.phel` in the workspace and surfaces user `defn`/`defmacro`/`def` forms in completion / hover / signature help.
- Go-to-definition: jumps from a symbol to its workspace `defn`.
- Paredit commands: slurp/barf forward and backward, raise, and wrap with `( )` / `[ ]` / `{ }`. Default keys for `.phel`: `ctrl+shift+]` / `ctrl+shift+[` (slurp/barf forward), `ctrl+shift+9` / `ctrl+shift+0` (slurp/barf backward), `ctrl+shift+r` (raise), `alt+w` (wrap).
- REPL integration: `Phel: Start REPL` opens a terminal running `phel repl`; `ctrl+enter` evals the form under the cursor, `ctrl+shift+enter` evals the selection. Commands also include eval next form and eval file.
- Find-all-references (`shift+F12`) across every indexed `.phel` file.
- Document outline + Go to Symbol in Workspace (`cmd+T`).
- Rename refactor (`F2`): renames the symbol in every workspace file; rejects invalid names.
- Selection expand/shrink by sexp: `ctrl+shift+space` grows the selection to the enclosing form, `ctrl+shift+alt+space` undoes the last grow.
- Auto-import: completing a workspace symbol from another namespace also inserts the matching `:require` entry into the current file's `(ns ...)` form (`:refer [name]`). Skipped for `phel.core` and same-ns symbols.

### Changed

- `MACROS` / `CORE_FNS` derive from `PHEL_DOCS`.
- Default `lineComment` is now `;` (was `#`, deprecated upstream).

### Settings

- `phel.diagnostics.enabled`, `phel.diagnostics.command`
- `phel.format.enabled`, `phel.format.command`
- `phel.tests.codeLensEnabled`, `phel.test.command`
- `phel.paredit.enabled`
- `phel.repl.enabled`, `phel.repl.command`, `phel.repl.args`

## [0.5.1] - 2026-05-06

### Changed

- Marketplace metadata: language-first description, more keywords, `Snippets` category, `qna: false`, gallery banner, badges.
- Deps: drop unused `glob` / `@types/glob`; move `@vscode/debugprotocol` to runtime; remove duplicate `@vscode/debugadapter` from dev deps; add `@vscode/vsce`.
- Scripts: `npm run package` / `npm run publish`.
- Docs / snippets: modern `phel.core` namespaces (was `phel\core`); strip em-dashes.

## [0.5.0] - 2026-05-06

### Added

- Tagged literals (`#inst`, `#regex`, `#php`, custom `#tag`) highlight.
- Reader conditionals `#?(...)` and `#?@(...)` highlight as `meta.reader-conditional.phel`.

## [0.4.0] - 2026-05-06

Sync with phel-lang `main` (`428c59f`).

### Added

- Anonymous fn `#(...)` with `%`, `%1`, `%&`. Legacy `|(...)` still works.
- Reader macros `~`, `~@`. Legacy `,`, `,@` still work.
- Deref `@x` highlights `@` as reader-macro punctuation.
- `aset` macro + numeric/comparison fns (`+`, `-`, `*`, `**`, `/`, `%`, `<`, `<=`, `=`, `==`, `>`, `>=`) in completion.
- `npm run tokenize` for grammar verification.

### Fixed

- `#{`, `#(`, `#_`, `#|`, `#?`, `#tag` were being eaten by the line-comment pattern. Comment now requires `#` followed by whitespace.

### Changed

- README: replaced obsolete `phel.debug/enable-trace` with `add-tap` / `tap>` / `remove-tap`.
- `regen-core-symbols.sh` scoped to `phel.core` only.

## [0.3.0] - 2026-05-06

### Added

- Code completion: 382 core fns, all special forms, every public macro.
- Code snippets for common forms (`defn`, `let`, `cond`, `try`, `deftest`, `->`, ...).
- Grammar coverage for the rest of the current core (added ~40 special forms and macros, sorted longest-first).

### Changed

- `mocha` to `^11.7.5`; npm overrides for `serialize-javascript` and `diff`. `npm audit` clean.

## [0.2.0] - 2025-02-01

### Added

- Native Phel debug adapter: source maps, breakpoints, stack traces, Phel-friendly variable display.
- Commands: *Show Compiled PHP Location*, *Clear Source Map Cache*.
- Settings: `phel.cacheDirectory`, `phel.debug.enabled`.
- Docker / remote path mappings, step filter, exception breakpoints, multi-expression line handling.
- Multiline `#| ... |#` and inline `#_` comments.
- Short anonymous fn `|(...)` with `$`, `$1`, `$&`.
- Set literals `#{...}`; `;` line comments.
- Threading macros (`->`, `->>`, `some->`, `some->>`, `as->`, `doto`).
- More keywords: `throw`, `in-ns`, `set-var`, `defexception`, `comment`, `or`, `and`, `doseq`, `lazy-seq`, `lazy-cat`, `binding`, `if-let`, `when-let`, `time`, `with-output-buffer`.
- `definterface*`, `defexception*`, `defstruct*`.
- Word pattern + indentation rules.

### Changed

- Debug configs use `phel` type (was `php`).
- Column-aware source map parsing.
- VS Code engine `^1.75.0`.
- Grammar typo: `brakets` -> `brackets`.

### Fixed

- Mutable collection syntax `@{`, `@[`, `@(`.

## [0.0.1] - Initial release

- Basic syntax highlighting for Phel.
- Comments, strings, numbers, keywords.
- Core special forms and macros.
