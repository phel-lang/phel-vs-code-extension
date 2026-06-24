# Change Log

## [Unreleased]

### Language server

- Delegate language intelligence to the Phel language server (`phel lsp`) when available (the default). Completion, hover, signature help, go-to-definition, find references, rename, document/workspace symbols, formatting, and diagnostics now come from the Phel compiler itself — adding PHP-interop intelligence (`php/->`, `php/::`, `php/new`) and semantically scoped rename/references that the bundled providers could not offer. New settings: `phel.lsp.enabled` (default `true`), `phel.lsp.command`, `phel.lsp.args`. When the server is disabled or the installed Phel is too old to provide `phel lsp`, the extension falls back to its bundled TypeScript providers.

### Language support

- Completion, hover, and signature help for the REPL workflow fns (`reload!`, `reload-all!`, `run-test`, `run-tests`), new core helpers (`clamp-int`, `defs->map`), and `phel.json` / `phel.string` / `phel.transit` / `phel.ai` additions.
- Add `php/callable` (first-class callable interop) to the `php/*` completion list.
- Rename `argv` → `*argv*`.

## [0.8.0] - 2026-06-05

### Language support

- Track phel-lang `main` (ahead of v0.41.0) for the unreleased interop work: corpus now covers `defenum`, `hydrate`, `bean`, `iterator-seq`, the reflect enum/attribute bridges (`enum->keyword`, `keyword->enum`, `enum-values`, `class-attributes`, `method-attributes`, `property-attributes`), and `html-response` / `json-response`.
- Add the `defenum` enum form: completion (`defenum*` special form), keyword highlighting, and a `defenum` snippet.
- Add `php/ref` (by-reference PHP interop) to the `php/*` special-form completion list; it already highlighted via the generic `php/` rule.

## [0.7.0] - 2026-06-05

### Language support

- Update the symbol corpus to Phel v0.41.0. Completion, hover, and signature help now cover everything added since v0.36: the numeric tower, the `phel\reflect`, `phel\edn`, and `phel\transit` namespaces, multimethod helpers, renamed runtime types, and `defonce`.
- Add `defonce` as a known special form, with keyword highlighting and a snippet.
- Highlight type/metadata tags (`^int`, `^:memoize`, …), the `#'sym` var-quote, and the `prefer-method` / `prefers` macros.

## [0.6.4] - 2026-05-08

### Diagnostics

- Fix off-by-one column shift: phel emits 0-based exclusive columns, the range converter was subtracting again and pushing every marker one column left.
- Run `phel analyze` with the workspace folder as `cwd` so `phel-config.php` and the autoloader resolve from the project root.
- Coalesce overlapping analyze runs per document; the latest save's content wins.
- Skip non-`file:` URIs (git diff views, untitled buffers).
- Drop diagnostics for documents closed mid-analysis.

## [0.6.3] - 2026-05-07

### Settings

- New `phel.executablePath` (default `vendor/bin/phel`) acts as a single workspace-wide pointer to the Phel CLI for diagnostics, format, test, and REPL. Existing per-subsystem settings (`phel.diagnostics.command`, `phel.format.command`, `phel.test.command`, `phel.repl.command`) still take precedence when set, but their defaults are now empty strings that fall back to `phel.executablePath`. Useful when the binary lives somewhere other than `vendor/bin/phel` (e.g. `bin/phel`, `/usr/local/bin/phel`).

### Docs

- README trimmed to features + install + docs index. Marketplace install link added.
- `docs/settings.md` rewritten with a Phel CLI location section, resolution order, and per-subsystem override examples.

## [0.6.2] - 2026-05-07

### Editor intelligence

- Resolve `alias/name` symbols via the file's `(:require [other.ns :as alias])` clause. Hover, go-to-definition, and signature help now light up for `r/render`-style references when `r` is aliased in the current file.

## [0.6.1] - 2026-05-07

### Build

- Move the 1300-entry symbol corpus out of the JS bundle into a sibling `dist/phel-core-docs.json` (~490 KB), lazy-loaded via a `Proxy` on first use. `dist/extension.js` shrinks from ~559 KB to ~97 KB; the bundle-size warning during `vsce package` no longer fires. Total vsix size is unchanged.

## [0.6.0] - 2026-05-07

Largest release since the initial cut. Brings the extension up to a modern
Lisp-IDE feature set: completion + hover + signature help backed by a
generated symbol DB, workspace-aware refactoring, paredit, an integrated
REPL, a Test Explorer, and inline debug values.

### Editor intelligence

- Generated symbol DB (`src/phelCoreDocs.ts`, 1317 entries across 30 namespaces; regenerate via `npm run regen-docs`).
- Hover docs with signature, docstring, example, see-also, and source link.
- Completion for every public `phel.core` symbol plus user `defn`/`defmacro`/`def` from anywhere in the workspace.
- Signature help with active-parameter highlighting.
- `Phel: Show Documentation` quick-pick command.
- Workspace indexer parses every `.phel` and powers go-to / find-refs / rename / outline / symbol search.
- **Go to Definition** (`F12`), **Find All References** (`shift+F12`), **Rename Symbol** (`F2`, validates the new name), document outline, and **Go to Symbol in Workspace** (`cmd+T`).
- **Auto-import** on completion: choosing a symbol from another namespace also patches the current file's `(ns ...)` form with `[that.ns :refer [name]]`. Skipped for `phel.core` and same-ns symbols.
- **Call-site snippets**: accepting a function in callee position inserts a `name ${1:arg1} ${2:arg2}` skeleton derived from the signature.
- **Document highlight**: cursor on a symbol underlines every occurrence in the file (skipping strings and comments).

### Structural editing

- Paredit: slurp / barf (forward + backward), raise, and wrap with `( )` / `[ ]` / `{ }`.
- Selection expand/shrink by sexp.
- Subtle background tint on the form enclosing the cursor.
- Bracket pair colorization for `.phel`; auto-close pair for `#(...)`.

### REPL

- `Phel: Start REPL` opens an integrated terminal running `phel repl`.
- Evaluate form under cursor, selection (or current line), next form, or whole file. Multi-line forms are flattened so the terminal REPL sees a single line.
- `(in-ns ...)` follow: cross-file evaluation switches the REPL into the source file's namespace automatically.
- Every sent form is appended to `.vscode/phel-repl-history.phel` (timestamped). Toggle off with `phel.repl.history.enabled`.
- `Phel: Switch REPL to Current Namespace` command.

### Diagnostics, format, tests

- Inline diagnostics on save via `phel analyze`.
- Format-on-save via `phel format`.
- CodeLens on `deftest`: `▶ Run test` / `▶ Run all tests in file`.
- **Test Explorer** integration: every `deftest` is a TestItem; running shells `phel test --filter ^name$` and reports pass/fail by exit code. Saving a file refreshes the tree.

### Debugging

- Inline values during paused debug sessions: visible symbol tokens get rendered with their live values. Unresolved names drop silently rather than rendering placeholders.

### Project & branding

- Status bar item: current `(ns ...)` while editing a `.phel` file, or a `Phel` badge when the workspace's `composer.json` requires `phel-lang/phel`. Click to start the REPL.
- Marketplace icon (256x256 PNG generated from the official `phel-lang/phel-lang` logo).
- Marketplace / Installs README badges switched from the retired shields.io endpoint to `vsmarketplacebadges.dev`.

### Build & release

- Bundle the runtime via esbuild into a single minified `dist/extension.js`. The published vsix drops from a directory tree to ~155 KB and activation is faster.
- New **Release** GitHub Actions workflow (`workflow_dispatch`): bumps version, packages the vsix, pushes the tag, creates the GitHub Release with the vsix attached. Marketplace publish is opt-in via the `publish_marketplace` toggle (requires the `VSCE_PAT` secret).
- `scripts/release.sh` defaults: GitHub Release on, Marketplace publish off. With no args, auto-bumps the minor of the current `package.json`; override with `--bump patch|minor|major` or pass an explicit semver. `--publish` opts into `vsce publish`.
- CI: PRs must keep at least one bullet under `## [Unreleased]` (`scripts/check-changelog.cjs`).
- Weekly scheduled workflow regenerates the docs DB from phel-lang `main` and opens a PR.
- GitHub Actions CI matrix on Node 20 + 22.

### Docs

- README rewritten with a feature tour (completion + auto-import, hover, REPL, paredit, refactoring, test explorer) and links to deeper pages under `docs/`.
- New pages: `docs/repl-and-paredit.md`, `docs/refactoring.md`.

### Changed

- `MACROS` / `CORE_FNS` derive from the generated `PHEL_DOCS` corpus.
- Default `lineComment` is now `;` (was `#`, deprecated upstream).

### Settings

| Setting | Default | Purpose |
|---|---|---|
| `phel.diagnostics.enabled` / `phel.diagnostics.command` | `true` / `vendor/bin/phel` | `phel analyze` integration. |
| `phel.format.enabled` / `phel.format.command` | `true` / `vendor/bin/phel` | `phel format` integration. |
| `phel.tests.codeLensEnabled` / `phel.test.command` | `true` / `vendor/bin/phel` | Run-test CodeLens + Test Explorer command. |
| `phel.paredit.enabled` | `true` | Register paredit commands. |
| `phel.repl.enabled` / `phel.repl.command` / `phel.repl.args` | `true` / `vendor/bin/phel` / `["repl"]` | REPL terminal launch. |
| `phel.repl.history.enabled` | `true` | Append every sent form to `.vscode/phel-repl-history.phel`. |
| `phel.formHighlight.enabled` | `true` | Subtle highlight on the enclosing form. |

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
