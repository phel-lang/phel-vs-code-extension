# Start a REPL

**Phel: Start REPL** opens an integrated terminal running `vendor/bin/phel repl`
(configurable through `phel.repl.command` and `phel.repl.args`). The terminal is
reused across evaluations.

From any `.phel` file:

| Shortcut | What it sends |
|---|---|
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Enter</kbd> | The top-level form under the cursor |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> | The selection, or the current line |

The extension tracks which namespace each terminal is in and sends
`(in-ns 'that.ns)` first when you eval from a different file, so a cross-file
eval never lands in the previous namespace.

For results rendered inline next to the form instead of in a terminal, connect
to an nREPL server with **Phel: Connect to nREPL Server**.
