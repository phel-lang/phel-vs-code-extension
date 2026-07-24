# REPL & Paredit

## Integrated REPL

`Phel: Start REPL` opens an integrated terminal running the configured Phel CLI (defaults to `vendor/bin/phel repl`). The terminal is reused across evaluations.

| Command | Default key | What it does |
|---|---|---|
| `Phel: Eval Form Under Cursor` | `ctrl+enter` (`cmd+enter` on macOS) | Sends the top-level form containing the cursor. Multi-line forms are flattened to a single line. |
| `Phel: Eval Selection` | `ctrl+shift+enter` (`cmd+shift+enter`) | Sends the selection, or the current line if the selection is empty. |
| `Phel: Eval Next Form` | _unbound_ | Sends the next top-level form and advances the cursor. |
| `Phel: Eval File` | _unbound_ | Sends the entire buffer. |
| `Phel: Switch REPL to Current Namespace` | _unbound_ | Sends `(in-ns 'this.ns)` for the active file. |

### Namespace tracking

Each REPL terminal remembers which namespace it last switched into. When you eval from a different file, the extension first sends `(in-ns 'that.ns)` so cross-file evals don't silently land in the previous namespace.

### History

Every form sent to the REPL is appended to `.vscode/phel-repl-history.phel` in the workspace, with a UTC timestamp comment above each entry. Toggle via `phel.repl.history.enabled`.

### Settings

| Setting | Default | Purpose |
|---|---|---|
| `phel.repl.enabled` | `true` | Register REPL commands |
| `phel.repl.command` | `vendor/bin/phel` | CLI path (relative to the workspace folder) |
| `phel.repl.args` | `["repl"]` | Args passed to the CLI |
| `phel.repl.history.enabled` | `true` | Append sent forms to the history file |

## Paredit

Structural editing for Phel forms. All commands are scoped to `editorLangId == phel`.

| Command | Default key |
|---|---|
| Slurp forward | `ctrl+shift+]` (`cmd+shift+]`) |
| Barf forward | `ctrl+shift+[` (`cmd+shift+[`) |
| Slurp backward | `ctrl+shift+9` (`cmd+shift+9`) |
| Barf backward | `ctrl+shift+0` (`cmd+shift+0`) |
| Raise form | `ctrl+shift+r` (`cmd+shift+r`) |
| Wrap with `( )` | `alt+w` |
| Wrap with `[ ]` / `{ }` | _unbound_ (commands `phel.paredit.wrapSquare`, `phel.paredit.wrapCurly`) |
| Drag form forward | `ctrl+shift+.` (`cmd+shift+.`) |
| Drag form backward | `ctrl+shift+,` (`cmd+shift+,`) |
| Splice form | `alt+shift+s` |
| Kill form | `alt+shift+k` |
| Expand selection | `ctrl+shift+space` (`cmd+shift+space`) |
| Shrink selection | `ctrl+shift+alt+space` (`cmd+shift+alt+space`) |

Native **expand/shrink** (`Shift+Alt+→` / `Shift+Alt+←`) is also form-aware via a
selection-range provider, and code **folding** follows the actual form structure
(every multi-line form folds, plus runs of `;` line comments).

### Examples

```text
(a) b              ; cursor in (a), slurp-forward → (a b)
(a b c)            ; cursor inside, barf-forward  → (a b) c
a (b c)            ; cursor in (b c), slurp-back  → (a b c)
(foo (bar baz))    ; cursor on bar, raise         → (foo bar)
foo                ; cursor on foo, wrap-round    → (foo)
(a b c)            ; cursor on b, drag-forward    → (a c b)
(a (b c) d)        ; cursor in (b c), splice      → (a b c d)
(a b c)            ; cursor on b, kill-form       → (a c)
```
