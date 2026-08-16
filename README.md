<p align="center">
  <img src="icon.png" alt="Phel" width="128" />
</p>

# Phel Lang for VS Code

[![CI](https://github.com/phel-lang/phel-vs-code-extension/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/phel-lang/phel-vs-code-extension/actions/workflows/ci.yml)
[![Marketplace](https://vsmarketplacebadges.dev/version-short/Phel-Lang.phel-lang.svg)](https://marketplace.visualstudio.com/items?itemName=Phel-Lang.phel-lang)
[![Installs](https://vsmarketplacebadges.dev/installs-short/Phel-Lang.phel-lang.svg)](https://marketplace.visualstudio.com/items?itemName=Phel-Lang.phel-lang)
[![Release](https://img.shields.io/github/v/release/phel-lang/phel-vs-code-extension?label=release)](https://github.com/phel-lang/phel-vs-code-extension/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

The complete editor for [Phel](https://phel-lang.org/), a functional Lisp that compiles to PHP: highlighting, completion, navigation, REPL, tests, debugger — all in one extension, tracking Phel **0.50**.

## Quick start

1. Install from the Marketplace (<kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> → **Phel Lang**), or `code --install-extension Phel-Lang.phel-lang`.
2. Open a project that has Phel installed (`composer require phel-lang/phel`). The CLI is expected at `vendor/bin/phel`; for another layout set one setting:
   ```jsonc
   // .vscode/settings.json
   { "phel.executablePath": "bin/phel" }
   ```
3. Open a `.phel` file. Everything below is on by default; run **Help: Get Started → Phel** for a guided tour, or **Phel: Doctor** to check the setup.

Requires VS Code 1.88+ and the PHP your Phel needs (8.4+ for Phel 0.50) on `PATH`. Works on macOS, Linux and Windows.

## What you get

**Writing code**
- Syntax highlighting for every reader form, incl. the Clojure-style PHP interop (`(.method obj)`, `Class/CONST`, `(Class. args)`), plus semantic tokens
- Completion for special forms, macros, core and workspace symbols with docs and call snippets — and in PHP-interop positions the compiler answers with the classes, methods and functions your project can load
- Indentation as you type that matches `phel format`, structural editing (paredit: slurp, barf, raise, wrap, drag, splice, kill), 66 snippets
- Format on save via `phel format`; unused locals, unused `:require`s and Phel 0.50 migration hints, each with a quick fix

**Understanding code**
- Go to definition, find references, rename, hover, signature help — all scope-aware (a local never rewrites a same-named global) and namespace-aware across files
- Outline, workspace symbols, folding, `N references` code lenses, optional parameter inlay hints
- Live diagnostics while typing (via `phel api-daemon`) and `phel lint` findings on save
- Searchable docs panel for the whole standard library; `php/…` hovers with the real PHP signature

**Running & testing**
- Test Explorer for `deftest` with per-test results, diffs, locations and coverage; a Benchmarks tree for `defbench`
- `▶ Run` / `Debug` code lenses, run-on-save, and everything reachable from the right-click menu, editor title bar or Explorer
- Tasks for `test`, `test --watch`, `lint`, `build`, `format`, `bench` with problem matchers into the Problems panel

**REPL & debugging**
- Integrated REPL and nREPL client: eval form/selection/file, inline `=> result`, evaluate-to-comment, evaluate-and-replace, hover evaluation, history — attaches to a running `phel nrepl` via `.nrepl-port` or starts its own
- Tests run through the live nREPL when connected (no PHP boot per run)
- Xdebug debugger with breakpoints in `.phel` files, conditional and hit-count breakpoints, logpoints, watch, and **Debug test** from a lens
- One status bar item shows daemon / nREPL / LSP state, with actions one click away

## Configuration

Everything works with zero configuration when Phel lives at `vendor/bin/phel`. When it does not, `phel.executablePath` (per workspace folder) is the only setting that matters. Per-subsystem overrides exist for lint, format, tests and REPL, and Phel's own language server (`phel lsp`) can be switched on for compiler-backed intelligence. Full reference: [docs/settings.md](docs/settings.md).

## Documentation

| Page | What it covers |
|---|---|
| [Installation](docs/installation.md) | Prerequisites, first project, doctor |
| [Syntax](docs/syntax.md) | What is highlighted and why |
| [Completion & snippets](docs/completion.md) | Symbol sources, PHP interop, inlay hints, migration to 0.50 |
| [Refactoring](docs/refactoring.md) | Navigation, rename, code actions, namespace hygiene |
| [REPL & paredit](docs/repl-and-paredit.md) | REPL, nREPL, evaluation, structural editing, indentation |
| [Debugging](docs/debugging.md) | Xdebug setup, breakpoints, debugging tests |
| [Commands](docs/commands.md) | Every command, menu entry, keybinding and task |
| [Settings](docs/settings.md) | Every `phel.*` setting, per-folder configuration |
| [Taps](docs/taps.md) | Ad-hoc inspection with `tap>` instead of a debug session |
| [Troubleshooting](docs/troubleshooting.md) | When something does not work |

Contributing: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) · Release history: [CHANGELOG.md](CHANGELOG.md)
