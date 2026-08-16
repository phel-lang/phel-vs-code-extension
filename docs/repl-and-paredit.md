# REPL & Paredit

## Integrated REPL

`Phel: Start REPL` (`phel.repl.start`) opens an integrated terminal running the configured Phel CLI (defaults to `vendor/bin/phel repl`). The terminal is reused across evaluations. Ids for every command below are in the [commands reference](commands.md).

| Command | Default key | What it does |
|---|---|---|
| `Phel: Eval Form Under Cursor` | `ctrl+enter` (`cmd+enter` on macOS) | Sends the top-level form containing the cursor. Multi-line forms are flattened to a single line. |
| `Phel: Eval Selection` | `ctrl+shift+enter` (`cmd+shift+enter`) | Sends the selection, or the current line if the selection is empty. |
| `Phel: Eval Next Form` | _unbound_ | Sends the next top-level form and advances the cursor. |
| `Phel: Eval File` | _unbound_ | Sends the entire buffer. |
| `Phel: Switch REPL to Current Namespace` | _unbound_ | Sends `(in-ns 'this.ns)` for the active file. |
| `Phel: REPL History` | _unbound_ | Picks a form you sent before out of the history file and sends it again. |

### Inline results (nREPL)

`Phel: nREPL Eval Form Inline` (`ctrl+alt+enter` / `cmd+alt+enter`) evaluates the
top-level form under the cursor over the nREPL connection and shows the value as
a dimmed `=> …` decoration at the end of the form's line (errors in the error
colour). The decoration clears as soon as you edit the buffer. The full value,
captured stdout, and stack traces still go to the **Phel nREPL** output channel.

### Results in the buffer (nREPL)

Two commands write the value where you can keep it:

- **`Phel: nREPL Evaluate to Comment`** (`ctrl+alt+c` / `cmd+alt+c`) puts it on
  the line under the form, as `;; => value`. Evaluating the same form again
  rewrites that block rather than stacking a second one under the first, so the
  comment follows the code as you edit it. A multi-line value gets one comment
  line each, padded so the value stays in one column — which is also how the
  block is recognised next time, so an ordinary `;; note` written under a result
  is left where it is. On macOS this shadows **Copy Path** inside `.phel` files.
- **`Phel: nREPL Evaluate and Replace Form`** swaps the form for its value. A
  form that errored is left exactly as it was (the error goes to the output
  channel): the form is the only copy of itself.

### The last result, in a document

`Phel: nREPL Show Last Result` opens `phel-result:last.phel` beside the editor —
a read-only document holding the value of the most recent evaluation, with Phel
highlighting because the value *is* Phel data. Every nREPL eval command refreshes
it, so leaving it pinned in a second column turns it into a result pane.

The value shown is the one the eval brought back. Phel's nREPL keeps a
per-session `*1`/`*2`/`*3` ring, but surfaces it as fields on the response
frame — those names are not bound in the namespace your code compiles in, so
nothing is re-read from the runtime to fill this document.

### Hover evaluation (nREPL)

While a connection is live for the folder, hovering a **symbol** also shows what
it evaluates to right now, as a `=> value` block under its documentation. It is
deliberately narrow:

- Only symbols, never the form around them — pointing at `(delete-everything!)`
  must not call it, while reading a var cannot have side effects.
- Locals, keywords, numbers, strings, literals, special forms and `php/…` names
  are skipped: the runtime has nothing to add to what you are already reading.
- It never opens a connection. Until you run `Phel: Connect to nREPL Server`
  (or another nREPL command does), hovering behaves exactly as before.
- An evaluation slower than 2 s is abandoned, the session is sent `interrupt`,
  and nothing is shown. Errors show nothing either — the value is the point.

Values longer than 300 characters are clipped; the full one is an eval away, in
the **Phel nREPL** output channel. Turn the whole thing off with
`phel.nrepl.hoverEval`.

### Tests through the REPL (nREPL)

While a connection is live for the folder, the Test Explorer's **Run** profile
uses it instead of spawning `phel test`: a run reloads changed namespaces once,
then asks the session for one `deftest` at a time. Each of those is
milliseconds — the runtime is already warm, so there is no PHP to boot per file
— and the verdict is exact, because the `run-tests` op answers a single test
with its own `{:pass :fail :error}` count. What the reporter printed becomes the
failure message, rendered as a **diff** where the assertion has two sides, and
anchored at the location the report named.

Two things follow from how the reporter works. It prints a file's *basename*, so
a message is only anchored when that name matches the file the item is in. And
it locates an assertion at the `(deftest …)` enclosing it, not at the `(is …)`:
the forms the macro rebuilds inherit the enclosing form's location, so every
failure in a test points at its first line.

Turn it off per folder with `phel.tests.preferNrepl`. It never opens a
connection — without one, and always for **Run with Coverage** (`run-tests`
collects none), the run is the `phel test --reporter=junit-xml` subprocess it
has always been.

`phel.tests.runOnSave` (off by default) closes the loop. Saving a `.phel` file
while a connection is live reloads and then runs, in this order:

1. the saved file's own `deftest`s, if it has any;
2. otherwise the test file its namespace maps to — `src/strings.phel` →
   `tests/strings_test.phel`, per the project's `src-dirs` / `test-dirs` — when
   the Explorer knows that file;
3. otherwise every test file whose `(ns …)` form `(:require`s the saved
   namespace.

Results land in the Testing view like any other run. Saving in the editor is
what triggers it: a file changed outside the editor is picked up by the next
reload, which the next run does anyway.

### Which server the nREPL commands talk to

The first nREPL command in a workspace folder looks for a `.nrepl-port` file at
the folder root. Since Phel 0.50 `phel nrepl` writes its bound port there while
it runs and removes it on exit, so a file whose port answers is a server you
started yourself — from a terminal, a `docker exec`, or another editor — and
the extension **attaches** to it instead of starting a second one. Without the
file (or when its port no longer answers, which usually means the server
crashed) the extension starts its own `phel nrepl --port=0` and reads the port
from its banner. `Phel: Disconnect from nREPL Server` (`phel.nrepl.disconnect`)
closes the socket either way, and only stops a server the extension started.

Add `.nrepl-port` to `.gitignore`; it is a per-machine, per-run file.

### The status bar

The item on the right of the status bar shows the namespace of the file you are
in (or `Phel` in a project without one open), followed by one icon per Phel
process that is up: `$(pulse)` the analysis daemon, `$(plug)` an nREPL
connection, `$(server)` the language server. The tooltip names all three with
their state, so `nREPL: attached` tells you the connection joined a server you
started. Clicking it opens **Phel: Status Actions** — start a REPL, connect or
disconnect the nREPL server, restart the analysis daemon or the language
server, show the **Phel Analysis** output, run doctor.

### Namespace tracking

Each REPL terminal remembers which namespace it last switched into. When you eval from a different file, the extension first sends `(in-ns 'that.ns)` so cross-file evals don't silently land in the previous namespace.

### History

Every form sent to the REPL is appended to `.vscode/phel-repl-history.phel` in the workspace, with a UTC timestamp comment above each entry. Toggle via `phel.repl.history.enabled`.

`Phel: REPL History` reads that file back as a picker: newest first, one row per
distinct form. Picking one sends it to the REPL terminal again; the **Eval in
nREPL** button on a row runs it over the nREPL connection instead, and only
appears while there is one — like hover evaluation, it never opens a connection.

### Settings

| Setting | Default | Purpose |
|---|---|---|
| `phel.repl.enabled` | `true` | Register REPL commands |
| `phel.repl.command` | `vendor/bin/phel` | CLI path (relative to the workspace folder) |
| `phel.repl.args` | `["repl"]` | Args passed to the CLI |
| `phel.repl.history.enabled` | `true` | Append sent forms to the history file |
| `phel.nrepl.enabled` | `true` | Register the nREPL commands |
| `phel.nrepl.reloadOnSave` | `false` | Reload changed namespaces on every save, when connected |
| `phel.nrepl.hoverEval` | `true` | Show `=> value` when hovering a symbol, when connected |
| `phel.tests.preferNrepl` | `true` | Run Test Explorer tests over the connection, when there is one |
| `phel.tests.runOnSave` | `false` | Re-run the tests a saved file affects, when connected |

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

### Indentation as you type

Pressing <kbd>Enter</kbd> puts the new line where `phel format` would put it,
and typing a closing bracket as the first character of a line re-places that
line. Nothing is asked of the CLI: the rules are the ones phel-lang's own
`IndentRule` applies, mirrored in the extension, so a save with format-on-save
has nothing left to move.

```text
(defn shape [xs]        ; a definition body: two spaces
  (let [n (count xs)]   ; so is a block form's body, once it starts a line
    (if (> n 1)
      (-> xs            ; everything else aligns under the first argument,
          (first)       ; which is what lines a `->` chain up under `xs`
          (str "!"))
      nil)))
```

Two deliberate differences from the CLI, both in your favour while typing:

- a comment on a fresh line gets the indentation the code around it has.
  `phel format` never re-indents a comment line, it keeps whatever indentation
  the comment already had — so what you get here is what it then preserves;
- a closing bracket left alone on its own line is indented rather than pulled
  up onto the previous line, which is what a save does with it.

Turn it off with `phel.format.onType`. It also needs `editor.formatOnType`,
which the extension [switches on for `.phel` files](settings.md#what-the-extension-sets-for-you).

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
