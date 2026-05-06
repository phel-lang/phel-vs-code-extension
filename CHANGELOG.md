# Change Log

All notable changes to the "phel-lang" extension will be documented in this file.

## [0.3.0] - 2026-05-06

### Added

- **Code completion** for the full public Phel core: 382 functions, all special forms, and every public macro. Special forms and macros surface as `Keyword`; plain functions as `Function`.
- **Code snippets** for the most common forms — `ns`, `defn`, `defn-`, `def`, `fn`, `let`, `if`, `when`, `cond`, `case`, `doseq`, `for`, `loop`/`recur`, `try`/`catch`, `defmacro`, `defstruct`, `definterface`, `defprotocol`, `defexception`, `deftest`, `->`, `->>`, `comment`.
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
