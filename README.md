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

- **Highlighting** for forms, macros, reader macros, tagged literals, and reader conditionals.
- **Completion, hover, signature help** for every public `phel.core` symbol and workspace `defn`/`defmacro`/`def`. Cross-namespace accepts auto-add the `:require`.
- **Go to / Find / Rename** (`F12`, `shift+F12`, `F2`, `cmd+T`).
- **Diagnostics** on save (`phel analyze`), **format** on save (`phel format`).
- **REPL** in an integrated terminal with `(in-ns)` follow and history.
- **Test Explorer + CodeLens** for `deftest`.
- **Paredit**: slurp / barf / raise / wrap, sexp selection.
- **Native debug adapter** with breakpoints in `.phel` files.
- **Snippets** for `defn`, `let`, `cond`, `try`, `deftest`, `->`, …

## Install

Marketplace: https://marketplace.visualstudio.com/items?itemName=Phel-Lang.phel-lang

Open Extensions (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>), search **"Phel Lang"**, click Install. Or:

```bash
code --install-extension Phel-Lang.phel-lang
```

Requires VS Code **1.75+**.

## Configuration

The extension expects the Phel CLI at `vendor/bin/phel` (Composer default). For other layouts, set `phel.executablePath` once in `.vscode/settings.json`:

```jsonc
{ "phel.executablePath": "bin/phel" }
```

Per-subsystem overrides (`phel.diagnostics.command`, `phel.format.command`, `phel.test.command`, `phel.repl.command`) take precedence when set. Full settings reference: [docs/settings.md](docs/settings.md).

## Documentation

| Topic | Link |
|---|---|
| Installation paths | [docs/installation.md](docs/installation.md) |
| Syntax highlighting | [docs/syntax.md](docs/syntax.md) |
| Completion & snippets | [docs/completion.md](docs/completion.md) |
| REPL & paredit | [docs/repl-and-paredit.md](docs/repl-and-paredit.md) |
| Refactoring | [docs/refactoring.md](docs/refactoring.md) |
| Debugging with Xdebug | [docs/debugging.md](docs/debugging.md) |
| Tracing with `tap>` | [docs/taps.md](docs/taps.md) |
| Settings | [docs/settings.md](docs/settings.md) |
| Troubleshooting | [docs/troubleshooting.md](docs/troubleshooting.md) |
