# Change Log

All notable changes to the "phel-lang" extension will be documented in this file.

## [0.5.1] - 2026-05-06

### Changed

- Marketplace metadata: tighter `description` that frames the extension as **Phel language support** (highlighting / completion / snippets) with debugging as a secondary feature; expanded `keywords` (`phel-lang`, `.phel`, `clojure`, `syntax-highlighting`, `completion`, `snippets`); added `Snippets` to `categories`; set `qna: false` so questions go to GitHub Issues; added `galleryBanner` and `badges` so the listing renders consistently.
- Dependency hygiene: dropped unused `glob` / `@types/glob`; removed the duplicate `@vscode/debugadapter` from `devDependencies`; promoted `@vscode/debugprotocol` from `devDependencies` to runtime `dependencies` (it's imported at runtime in `phelDebugAdapter.ts`).
- Added `npm run package` and `npm run publish` shortcuts for `vsce`. `@vscode/vsce` is now a `devDependency` so the scripts work without `npx --yes`.
- Docs and snippets: namespaces now use the modern dot form (`phel.core`, `my-app.core`) instead of the legacy backslash form (`phel\core`). PHP class references in `catch` clauses keep their backslash (`\Throwable`).

## [0.5.0] - 2026-05-06

### Added

- **Tagged literals** (`#inst`, `#regex`, `#php`, custom `#money`, …) now highlight: `#` as `punctuation.definition.tag.phel`, the tag name as `storage.type.tagged.phel`, and the following form keeps its normal scopes.
- **Reader conditionals** `#?(:phel … :clj …)` and the splicing form `#?@(...)` now highlight: `#?` / `#?@` as `keyword.other.reader-conditional.phel`, the body wrapped in `meta.reader-conditional.phel` so editors can dim the inactive branch via theme rules.
- Sample (`scripts/sample.phel`) covers the new patterns; `npm run tokenize` verifies them.

## [0.4.0] - 2026-05-06

Sync with phel-lang `main` (commit `428c59f`).

### Added

- **Anonymous function syntax `#(...)`** with `%`, `%1`, `%2`, …, `%&` placeholders - the form Phel now ships as the default. The legacy `|(...)` form with `$`-placeholders continues to highlight for older code.
- **Preferred reader macros** `~` (unquote) and `~@` (unquote-splicing) now highlight as reader-macro punctuation alongside the legacy `,` and `,@`.
- **Deref `@x`** now highlights `@` as reader-macro punctuation (previously it was absorbed into the symbol). Mutable collection literals `@(...)`, `@[...]`, `@{...}` still parse via the existing collection patterns.
- `aset` macro added to grammar and completion (lives in `phel.core`'s `arrays.phel`).
- Numeric / comparison core fns added to completion: `+`, `-`, `*`, `**`, `/`, `%`, `<`, `<=`, `=`, `==`, `>`, `>=`.
- `npm run tokenize` and `scripts/tokenize-sample.mjs` - runs the same `vscode-textmate` engine VS Code uses to produce a token-by-token report for a sample `.phel` file. Used to verify highlighting changes without launching the editor.

### Fixed

- Set literals `#{...}`, anonymous functions `#(...)`, and inline form-comments `#_` were previously eaten by the line-comment pattern (`[#;]` matched any `#` first). The comment pattern now requires `#` to be followed by whitespace or end-of-line, so `#{`, `#(`, `#_`, `#|`, `#?`, and `#tag` literals all reach their proper patterns.

### Changed

- README "Debug Trace Mode" section replaced with a "Inspecting Values with Taps" section that uses the current `add-tap` / `tap>` / `remove-tap` API in `phel.core`. The previous `(phel.debug/enable-trace)` API no longer exists upstream.
- `CONTRIBUTING.md` and `scripts/regen-core-symbols.sh` now scope the `MACROS` and `CORE_FNS` extraction to `phel.core` only (`src/phel/core.phel` plus `src/phel/core/**/*.phel`). Library macros from `phel.test`, `phel.match`, `phel.repl`, `phel.html`, etc. remain in the curated list because they are commonly `:refer`'d unqualified.
- README documents the new anonymous function and comment syntax (`;` / `;;` preferred over the deprecated `#`).

## [0.3.0] - 2026-05-06

### Added

- **Code completion** for the full public Phel core: 382 functions, all special forms, and every public macro. Special forms and macros surface as `Keyword`; plain functions as `Function`.
- **Code snippets** for the most common forms - `ns`, `defn`, `defn-`, `def`, `fn`, `let`, `if`, `when`, `cond`, `case`, `doseq`, `for`, `loop`/`recur`, `try`/`catch`, `defmacro`, `defstruct`, `definterface`, `defprotocol`, `defexception`, `deftest`, `->`, `->>`, `comment`.
- **Expanded syntax highlighting** with the rest of the current core: `var`, `deref`, `new`, `conj`, `concat`, `list`, `vector`, `hash-map`, `load`, `use`, `reify*`, `unquote`, `unquote-splicing`, plus macros `defprotocol`, `defrecord`, `defmethod`, `defmulti`, `defspec`, `deftest`, `deftype`, `are`, `assert`, `async`, `cond->`, `cond->>`, `condp`, `delay`, `dir`, `doc`, `dotimes`, `explain-sym`, `extend-protocol`, `extend-type`, `future`, `future-fiber`, `html`, `if-some`, `instance?`, `is`, `letfn`, `match`, `pop`, `reify`, `require`, `source`, `symbol-info`, `testing`, `when-first`, `when-some`, `with-bindings`, `with-config`, `with-mock-wrapper`, `with-mocks`, `with-redefs`. Alternation is sorted longest-first so e.g. `defmacro-` wins over `defmacro` and `cond->>` over `cond`.

### Changed

- Bumped `mocha` to `^11.7.5` and added npm `overrides` for `serialize-javascript` (`^7.0.5`) and `diff` (`^9.0.0`); `npm audit` now reports zero vulnerabilities.

## [0.2.0] - 2025-02-01

### Added

- **Native Phel Debug Adapter** - Debug Phel code directly without needing PHP Debug extension
  - Automatic source map translation between .phel and compiled .php files
  - Breakpoints set in .phel files are translated to correct PHP lines
  - Stack traces show .phel file locations instead of compiled PHP
  - Variable display with Phel-friendly formatting (vectors, maps, keywords, etc.)
- **Commands**:
  - `Phel: Show Compiled PHP Location` - Shows where current Phel line maps to in PHP
  - `Phel: Clear Source Map Cache` - Clears cached source maps
- **Extension Settings**:
  - `phel.cacheDirectory` - Custom path to Phel cache directory
  - `phel.debug.enabled` - Enable/disable Phel debug adapter
- **Docker/Remote Debugging Support** - Path mappings for containerized environments
- **Step Filter** - Option to skip Phel runtime internals during stepping
- **Exception Breakpoints** - Break on all or uncaught PHP exceptions
- **Multi-breakpoint Support** - Handles multiple expressions on same Phel line
- Support for multiline comments `#| ... |#`
- Support for inline comment `#_` (comments out next form)
- Support for short anonymous function syntax `|(...)` with positional parameters (`$`, `$1`, `$2`, `$&`)
- Support for set literals `#{...}`
- Support for semicolon comments `;`
- Highlighting for threading macros: `->`, `->>`, `some->`, `some->>`, `as->`, `doto`
- Highlighting for additional keywords: `throw`, `in-ns`, `set-var`, `defexception`, `comment`, `or`, `and`, `doseq`, `lazy-seq`, `lazy-cat`, `binding`, `if-let`, `when-let`, `time`, `with-output-buffer`
- Support for `definterface*`, `defexception*`, `defstruct*` internal forms
- Word pattern configuration for better symbol selection
- Indentation rules for better auto-indent

### Changed

- Debug configurations now use native `phel` type instead of `php`
- Improved source map parsing with column-aware mapping
- Better executable line detection for breakpoint placement
- Updated VS Code engine requirement to `^1.75.0`
- Fixed typo: "brakets" → "brackets" in grammar
- Improved `readermac` patterns to properly handle unquote-splicing `,@`
- Better auto-closing pairs configuration

### Fixed

- Properly handle mutable collection syntax `@{`, `@[`, `@(`

## [0.0.1] - Initial Release

### Added
- Basic syntax highlighting for Phel language
- Support for comments, strings, numbers, keywords
- Highlighting for core special forms and macros
