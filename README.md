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

- **Highlighting** for every literal the Phel reader accepts — characters (`\A`, `\space`, `\u00e9`), regex literals (`#"…"`), radix / BigInt / BigDecimal / ratio numbers (`16rFF`, `123N`, `1.5M`, `3/4`), symbolic numbers (`##Inf`, `##NaN`), gensyms (`x#`), prime-suffixed names (`a'`), tagged literals including namespaced ones (`#my.app/Person`), reader conditionals, and metadata tags.
- **Scope-aware navigation.** Go-to-definition, find-references, rename, document-highlight, hover and signature help resolve a *local* to its own binding, so renaming a parameter never touches a same-named global. Covers `fn` / `let` / `loop` / `binding` / `for` / `doseq` / `foreach` / `letfn` / `as->` / `catch`, destructuring, and protocol-method parameters.
- **Semantic highlighting** of parameters and locals, plus faded **unused-local** hints.
- **Completion** over special forms, macros, core functions, and workspace symbols, with docs and call snippets. Understands `alias/…` after a `:require`, and the `(ns …)` form itself — clause heads, requirable namespaces, `:as` / `:refer`, and the names inside a `:refer` vector. Accepting a workspace symbol can auto-add its `:require`.
- **Outline & workspace symbols** for every defining form — `defn`, `def`, `defmacro`, `defstruct`, `defrecord`, `deftype`, `defprotocol`, `definterface`, `defenum`, `defexception`, `defmulti`, `defonce`, `deftest` — each with a matching icon.
- **Refactorings** (`Ctrl+.`): thread first / last, unwind thread, cycle collection delimiters, and add a missing `:require`.
- **Diagnostics** backed by `phel lint` (falling back to `phel analyze` on older CLIs), plus a **Lint Workspace** command that fills the Problems panel for the whole project. **Format** on save via `phel format`.
- **Language server** (`phel lsp`, opt-in via `phel.lsp.enabled`): the same features straight from the Phel compiler, including PHP-interop intelligence for `php/->`, `php/::`, and `php/new`. Off by default; enable it once your Phel ships a stable server (older `phel lsp` builds exit on idle, in which case the extension falls back to its bundled providers).
- **REPL** in an integrated terminal with `(in-ns)` follow and history.
- **nREPL client** (`phel nrepl`): structured eval results, inline `=> …` results at the end of the form, reload changed namespaces, and run a namespace's tests or the test under the cursor against the live runtime.
- **Test Explorer + CodeLens** for `deftest`, with per-test results and a **Run with Coverage** profile (`phel test --coverage=clover`, VS Code 1.88+).
- **Paredit**: slurp / barf / raise / wrap, drag / splice / kill form, form-aware folding, and native expand-selection (`Shift+Alt+→`).
- **Native debug adapter** with breakpoints in `.phel` files.
- **CLI commands**: Doctor (`phel doctor`), Show Effective Configuration (`phel config`), Watch Tests, Build, and Init Project (with a template picker).
- **60 snippets** covering the binding, conditional, threading, protocol, and test forms.

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
