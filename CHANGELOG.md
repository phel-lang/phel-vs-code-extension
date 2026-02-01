# Change Log

All notable changes to the "phel-lang" extension will be documented in this file.

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
