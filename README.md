<p align="center">
  <img src="icon.png" alt="Phel" width="128" />
</p>

# Phel Lang for VS Code

[![CI](https://github.com/phel-lang/phel-vs-code-extension/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/phel-lang/phel-vs-code-extension/actions/workflows/ci.yml)
[![Marketplace](https://vsmarketplacebadges.dev/version-short/Phel-Lang.phel-lang.svg)](https://marketplace.visualstudio.com/items?itemName=Phel-Lang.phel-lang)
[![Installs](https://vsmarketplacebadges.dev/installs-short/Phel-Lang.phel-lang.svg)](https://marketplace.visualstudio.com/items?itemName=Phel-Lang.phel-lang)
[![Release](https://img.shields.io/github/v/release/phel-lang/phel-vs-code-extension?label=release)](https://github.com/phel-lang/phel-vs-code-extension/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

VS Code support for [Phel](https://phel-lang.org/), a functional Lisp that compiles to PHP.

## Features

- **Syntax highlighting** for every literal the Phel reader accepts — characters, regex literals, radix / BigInt / BigDecimal / ratio numbers, `##Inf` / `##NaN`, gensyms, tagged literals, reader conditionals, metadata tags — plus the Clojure-style PHP interop spellings (`(.method obj)`, `(.-field obj)`, `Class/CONST`, `Class/$prop`, `(Class. args)`).
- **Navigation that understands scope** — go-to-definition, find-references, rename, hover and signature help resolve a local to its own binding, so renaming a parameter never touches a same-named global.
- **Completion** over special forms, macros, core and workspace symbols, with docs and call snippets. Understands `alias/…` and the `(ns …)` form, and can auto-add a missing `:require`.
- **Outline & workspace symbols** for every defining form, each with a matching icon.
- **Diagnostics** via `phel lint`, **formatting** via `phel format`, both on save.
- **Refactorings** (`Ctrl+.`) — thread / unwind, cycle collection delimiters, add missing `:require`.
- **REPL and nREPL client**, with inline evaluation results and namespace reloading.
- **Test Explorer + CodeLens** for `deftest`, with per-test results and coverage; `▶ Run benchmark` for `defbench`. Run a file, its tests or its benchmarks from the right-click menu, the editor title bar or the Explorer.
- **Paredit** — slurp / barf / raise / wrap / drag / splice / kill, form-aware folding and expand-selection.
- **Debugger** with real breakpoints in `.phel` files, via Xdebug and source maps.
- **66 snippets**, plus semantic highlighting, unused-local hints, and [Phel 0.50 migration](docs/completion.md#migrating-to-phel-050) diagnostics with quick fixes.

Optionally delegates to Phel's own language server (`phel lsp`, off by default) for compiler-backed intelligence including PHP interop. See [settings](docs/settings.md).

## Install

Marketplace: https://marketplace.visualstudio.com/items?itemName=Phel-Lang.phel-lang

Open Extensions (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>), search **"Phel Lang"**, click Install. Or:

```bash
code --install-extension Phel-Lang.phel-lang
```

Requires VS Code **1.88+**.

## Configuration

The extension expects the Phel CLI at `vendor/bin/phel` (Composer default). For other layouts, set `phel.executablePath` once in `.vscode/settings.json`:

```jsonc
{ "phel.executablePath": "bin/phel" }
```

Per-subsystem overrides (`phel.diagnostics.command`, `phel.format.command`, `phel.test.command`, `phel.repl.command`) take precedence when set. Full settings reference: [docs/settings.md](docs/settings.md).

## Documentation

Full docs live in [docs/](docs/README.md) — [installation](docs/installation.md), [syntax](docs/syntax.md), [completion & snippets](docs/completion.md), [REPL & paredit](docs/repl-and-paredit.md), [refactoring](docs/refactoring.md), [debugging](docs/debugging.md), [taps](docs/taps.md), [commands](docs/commands.md), [settings](docs/settings.md), [troubleshooting](docs/troubleshooting.md).

Contributing: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md). Release history: [CHANGELOG.md](CHANGELOG.md).
