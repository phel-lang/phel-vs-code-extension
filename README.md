# Phel Lang for VS Code

[![Release](https://img.shields.io/github/v/release/phel-lang/phel-vs-code-extension?label=release)](https://github.com/phel-lang/phel-vs-code-extension/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

VS Code support for [Phel](https://phel-lang.org/) — a functional Lisp that compiles to PHP.

## Why this extension

Writing Phel without editor support means colourless code, no completion for the 400+ symbols in `phel\core`, and dropping back to PHP-level debugging. This extension fixes all three.

- **Highlighting** — full coverage of forms, macros, reader macros, tagged literals (`#inst`, `#regex`, `#php`, …) and reader conditionals (`#?(...)`).
- **Completion** for every public symbol in `phel\core` (47 special forms, ~70 macros, 394 functions).
- **Snippets** for everyday scaffolding — `defn`, `let`, `cond`, `try`, `deftest`, `->`, …
- **Native debug adapter** — set breakpoints in `.phel` files; the adapter translates between Phel and the compiled PHP via Xdebug.

## Install

```bash
code --install-extension phel-lang.phel-lang
```

Or grab a `.vsix` from the [releases page](https://github.com/phel-lang/phel-vs-code-extension/releases) and run `code --install-extension phel-lang-*.vsix`. Requires VS Code **1.75+**.

Other paths (build from source, symlink for live development): see [docs/installation.md](docs/installation.md).

## First steps

1. **Open any `.phel` file** — highlighting kicks in automatically.
2. **Try completion** — start typing `re-` or `swap` and accept a suggestion.
3. **Expand a snippet** — type `defn` <kbd>Tab</kbd> and tab through the placeholders.
4. **Set a breakpoint** in `.phel`, add a launch config (see [docs/debugging.md](docs/debugging.md)), press <kbd>F5</kbd>.

## Documentation

| Topic | Link |
|---|---|
| Installation paths | [docs/installation.md](docs/installation.md) |
| Syntax highlighting reference | [docs/syntax.md](docs/syntax.md) |
| Completion & snippets | [docs/completion.md](docs/completion.md) |
| Debugging with Xdebug | [docs/debugging.md](docs/debugging.md) |
| Tracing with `tap>` | [docs/taps.md](docs/taps.md) |
| Settings reference | [docs/settings.md](docs/settings.md) |
| Troubleshooting | [docs/troubleshooting.md](docs/troubleshooting.md) |

## Contributing · Changelog · License

[CONTRIBUTING.md](CONTRIBUTING.md) · [CHANGELOG.md](CHANGELOG.md) · [LICENSE](LICENSE) (MIT)
