# Commands reference

Every command the extension contributes, what it actually runs, and where it lives in the source.

The extension activates on `onLanguage:phel`, so the commands only show up in the Command Palette (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>) once a `.phel` file is open.

**Needs** is what has to be in place for the command to do anything:

| Value | Meaning |
|---|---|
| Phel CLI | Shells out to the Phel binary. The setting in the "What it runs" column decides which one; it falls back to `phel.executablePath`, then to `vendor/bin/phel`. See [settings](settings.md#phel-cli-location). |
| nREPL | Needs a `phel nrepl` server. The first nREPL command in a workspace folder attaches to one or starts one, so only **Disconnect** truly requires an existing connection. |
| nothing | Pure editor-side work; no CLI, no network. |

**Which folder a command runs in.** Anything invoked on a file — a CodeLens, one of the menus below, the Test Explorer — runs in the workspace folder that owns *that file*, with the file passed relative to it. The folder-wide commands (watch, build, init, balance, doctor, config, lint) run in the active file's folder; when the active file belongs to no folder and the workspace has more than one, VS Code asks which folder to use, and cancelling the pick cancels the command.

## Where to find them

The palette has all of them, but the ones you reach for while writing code also sit where the file is:

- **Right-click in a `.phel` editor → Phel** — a submenu with the three ways to evaluate (form under cursor, selection, nREPL inline — the selection entry only appears when there is one), the three ways to run the file (tests, benchmarks, the file itself), then **Show Documentation** and **Lint Workspace**.
- **The ▷ button in the editor title bar** — **Run File** and **Run All Tests in File**, on any open `.phel` file.
- **Right-click a `.phel` file in the Explorer** — **Run All Tests in File**, **Run Benchmarks in Current File**, **Run File**. These take the file you clicked, not the one you are looking at, so nothing has to be open first.

The palette hides what it cannot serve: **Run Benchmark** never appears there (it needs the name its CodeLens supplies), **Describe Runtime State** is a test seam with nothing to show a user, and the editor-only commands — paredit, eval, expand / shrink selection, show compiled location — only appear while a `.phel` file is focused.

## Tests & benchmarks

Registered by [`src/phelCliCommandsProvider.ts`](../src/phelCliCommandsProvider.ts) and [`src/extension.ts`](../src/extension.ts). The `▶` lenses come from [`src/phelTestCodeLensProvider.ts`](../src/phelTestCodeLensProvider.ts) and are toggled by `phel.tests.codeLensEnabled`.

| Command | Id | What it runs / does | Needs | Key |
|---|---|---|---|---|
| Phel: Run Test | `phel.runTest` | `phel test --filter '^<name>$' <file>` in the **Phel Tests** terminal. Uses `phel.test.command`. Takes `(uri, testName)` from the `▶ Run test` CodeLens; from the palette there is no name, so it degrades to running the whole active file. | Phel CLI | — |
| Phel: Run All Tests in File | `phel.runTestsInFile` | `phel test <file>` in the **Phel Tests** terminal, on the passed uri or the active editor. Uses `phel.test.command`. | Phel CLI | — |
| Phel: Watch Tests | `phel.test.watch` | `phel test --watch` in the **Phel Test (watch)** terminal, at the root of the active file's workspace folder (or the picked one). Uses `phel.test.command`. | Phel CLI | — |
| Phel: Run Benchmarks | `phel.bench` | Prompts for a `--filter` substring, then `phel bench [--filter=…]` in the **Phel Bench** terminal, at the active file's workspace-folder root. Uses `phel.executablePath`. | Phel CLI | — |
| Phel: Run Benchmarks in Current File | `phel.benchFile` | Same prompt, then `phel bench <file> [--filter=…]` in the folder owning that file, with `<file>` relative to it. Also backs the file-level `▶ Run all benchmarks in file` lens. | Phel CLI | — |
| Phel: Run Benchmark | `phel.runBenchmark` | `phel bench <file> --filter=<name>` in the folder owning that file. Takes `(uri, name)` from the `▶ Run benchmark` CodeLens — **not for the palette**: without a name it does nothing. `phel bench` has no per-name entry point, so the name goes through `--filter`, a substring match. | Phel CLI | — |

Neither Explorer tree is a command: each registers run profiles that the Testing view drives.

- **Phel** ([`src/phelTestController.ts`](../src/phelTestController.ts)) — one item per `deftest`, run through `phel test --reporter=junit-xml`, with a coverage profile.
- **Phel Benchmarks** ([`src/phelBenchController.ts`](../src/phelBenchController.ts)) — one item per `defbench`, run through `phel bench <file>` (plus `--filter=<name>` when a single benchmark was asked for) and read back from the table it prints, so each item's duration is that benchmark's mean and the whole table lands in the run output. A benchmark cannot fail, only take time: a row that comes back is passed, one the runner left out is skipped, and a run with no table at all is an error carrying what the CLI said. Kept apart from the tests so that "Run All Tests" never times a benchmark. Uses `phel.executablePath`.

## Project

| Command | Id | What it runs / does | Needs | Key |
|---|---|---|---|---|
| Phel: Build | `phel.build` | Two quick picks (optimization level, build report), then `phel build` in the **Phel Build** terminal — with `-O 0` / `-O 2` and `--report` added per the picks. Default level leaves it to `phel-config.php`. Uses `phel.executablePath`. | Phel CLI | — |
| Phel: Init Project | `phel.init` | Runs `phel init --list-templates` to fill a template picker, prompts for a project name, then `phel init [<name>] [--template=<t>]` in the **Phel Init** terminal. Uses `phel.executablePath`. | Phel CLI | — |
| Phel: Run File | `phel.runFile` | `phel run <file>` in the **Phel Run** terminal, on the passed uri or the active editor. The path goes in relative to the workspace folder that owns the file — not the active editor's — so running a file from the explorer of a multi-root workspace uses its own project root. Uses `phel.executablePath`. | Phel CLI | — |
| Phel: Check Balanced Delimiters | `phel.balance` | Quick pick between report-only and fix, then `phel balance [--fix]` in the **Phel Balance** terminal. `--fix` rewrites source on disk, so the pick is the confirmation. Uses `phel.executablePath`. | Phel CLI | — |
| Phel: Doctor (check project health) | `phel.doctor` | `phel doctor`, streamed into the **Phel Doctor** output channel, with the exit code appended. Uses `phel.executablePath`. | Phel CLI | — |
| Phel: Show Effective Configuration | `phel.showConfig` | `phel config --format=json`, opened pretty-printed in a JSON tab. Uses `phel.executablePath`. | Phel CLI | — |
| Phel: Lint Workspace | `phel.lintWorkspace` | `phel lint --format=json` over one workspace folder — the active file's, or the picked one — filling the Problems panel for every file it reports, including ones never opened. Uses `phel.diagnostics.command`. | Phel CLI | — |
| Phel: Restart Analysis Daemon | `phel.diagnostics.restartDaemon` | Stops the `phel api-daemon` process behind the as-you-type diagnostics (one per workspace folder) and clears what it reported; your next edit starts a fresh one. Reach for it when live diagnostics go stale after editing another file. Logs to the **Phel Analysis** output channel. | Phel CLI | — |

Sources: [`phelCliCommandsProvider.ts`](../src/phelCliCommandsProvider.ts) (build / init / run / balance), [`phelDoctorProvider.ts`](../src/phelDoctorProvider.ts) (doctor / config), [`phelDiagnosticsProvider.ts`](../src/phelDiagnosticsProvider.ts) (lint), [`phelDaemonDiagnosticsProvider.ts`](../src/phelDaemonDiagnosticsProvider.ts) (restart daemon).

Formatting has no command of its own: `phel format` runs through VS Code's own **Format Document**, gated by `phel.format.enabled` and pointed by `phel.format.command`. Per-file diagnostics run on open and save; the analyzer ones also run as you type, which is `phel.diagnostics.live`.

## Tasks

The commands above open a terminal and leave you to read it. The `phel` **task** type ([`src/phelTaskProvider.ts`](../src/phelTaskProvider.ts)) runs the same CLI through VS Code's task system instead, which buys two things a terminal cannot: a task can be bound to **Run Build Task** / **Run Test Task**, and its output can be parsed into the Problems panel while it runs.

**Terminal → Run Task… → phel** lists one set per workspace folder, each running in that folder's root and resolving the binary from that folder's settings:

| Task | Runs | Problem matcher | Executable setting |
|---|---|---|---|
| `phel: test` | `phel test` | — | `phel.test.command` |
| `phel: test --watch` | `phel test --watch` | `$phel-test-watch` | `phel.test.command` |
| `phel: lint` | `phel lint` | `$phel-lint` | `phel.diagnostics.command` |
| `phel: build` | `phel build` | — | `phel.executablePath` |
| `phel: format` | `phel format` | — | `phel.format.command` |
| `phel: bench` | `phel bench` | — | `phel.executablePath` |

`test` and `test --watch` are in the **test** group, `build` in the **build** group, so <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> and **Run Test Task** find them without any configuration.

### Writing your own

`command` is any `phel` subcommand out of `test`, `watch`, `build`, `bench`, `lint`, `format`, `run`; `args` is appended after it verbatim. In `.vscode/tasks.json`:

```jsonc
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "phel",
      "command": "test",
      "args": ["--watch", "--filter=greet"],
      "label": "phel: watch the greet tests",
      "isBackground": true,
      "problemMatcher": "$phel-test-watch",
      "presentation": { "reveal": "silent" }
    },
    {
      "type": "phel",
      "command": "lint",
      "args": ["src"],
      "label": "phel: lint src",
      "problemMatcher": "$phel-lint",
      "group": "build"
    }
  ]
}
```

The extension only fills in the executable and the cwd; `problemMatcher`, `isBackground`, `presentation` and `group` are yours, exactly as written above — which is why a hand-written task has to name its matcher even when the default task with the same command already has one.

### The two problem matchers

Both are contributed in `package.json` and can be used from any task, including a `shell` one:

- **`$phel-lint`** reads the human-readable `phel lint` format — `path:line:col [severity] code message` — so `[error]` / `[warning]` / `[info]` / `[hint]` land as the matching VS Code severity and the rule name (`phel/unused-binding`) becomes the problem code. Do **not** pass `--format=json` to a task using it; the JSON goes to the **Phel: Lint Workspace** command instead ([diagnostics](settings.md#diagnostics-engine)).
- **`$phel-test-watch`** is a background matcher keyed to the watch loop's own lines: it starts collecting at `Change detected, re-running tests...` and reports at `Watching for file changes...`, and it is active from the start because the first run happens before either is printed. It parses the reporter's failure headlines — `FAIL <name> ['<message>'] (<file>.phel:<line>)` and the `ERROR` equivalent — with `FAIL`/`ERROR` as the problem code. The reporter prints the file's basename, so the matcher searches the workspace folder (minus `vendor/`) for it.

## REPL

Registered by [`src/phelReplProvider.ts`](../src/phelReplProvider.ts) when `phel.repl.enabled` is on (the default). Every entry opens the **Phel REPL** terminal if it isn't already running, so none of them needs a separate connect step. The terminal remembers its namespace and gets an `(in-ns 'this.ns)` first when the form comes from another file.

| Command | Id | What it runs / does | Needs | Key |
|---|---|---|---|---|
| Phel: Start REPL | `phel.repl.start` | Opens a terminal running `phel.repl.command` with `phel.repl.args` (default `vendor/bin/phel repl`), at the root of the active file's workspace folder. | Phel CLI | — |
| Phel: Eval Form Under Cursor | `phel.repl.evalForm` | Sends the top-level form containing the cursor, flattened to one line. | Phel CLI | `ctrl+enter` (`cmd+enter`) |
| Phel: Eval Selection | `phel.repl.evalSelection` | Sends the selection, or the current line when the selection is empty. | Phel CLI | `ctrl+shift+enter` (`cmd+shift+enter`) |
| Phel: Eval Next Form | `phel.repl.evalNextForm` | Sends the next top-level form and moves the cursor past it. | Phel CLI | — |
| Phel: Eval File | `phel.repl.evalFile` | Sends the whole buffer. | Phel CLI | — |
| Phel: Switch REPL to Current Namespace | `phel.repl.switchNs` | Sends `(in-ns 'this.ns)` for the active file's `(ns …)` form. | Phel CLI | — |

Everything sent is appended to `.vscode/phel-repl-history.phel` while `phel.repl.history.enabled` is on.

## nREPL

Registered by [`src/phelNreplProvider.ts`](../src/phelNreplProvider.ts) when `phel.nrepl.enabled` is on (the default). Ops are bencode-over-TCP; results go to the **Phel nREPL** output channel. The first command in a workspace folder attaches to the server advertised by `.nrepl-port`, or starts `phel nrepl --port=0` using `phel.repl.command` — see [which server the nREPL commands talk to](repl-and-paredit.md#which-server-the-nrepl-commands-talk-to).

| Command | Id | What it runs / does | Needs | Key |
|---|---|---|---|---|
| Phel: Connect to nREPL Server | `phel.nrepl.connect` | Attaches or starts a server, clones a session, and reports which of the two happened. | Phel CLI | — |
| Phel: Disconnect from nREPL Server | `phel.nrepl.disconnect` | Closes the socket for the active file's folder (all of them when no folder matches). Only stops a server the extension started itself. | nREPL | — |
| Phel: nREPL Eval Form Under Cursor | `phel.nrepl.eval` | `eval` op on the top-level form at the cursor, prefixed with an `(in-ns …)` for the file's namespace. | nREPL | — |
| Phel: nREPL Eval Form Inline | `phel.nrepl.evalInline` | Same `eval`, plus a dimmed `=> …` decoration after the form. Clears on the next edit. | nREPL | `ctrl+alt+enter` (`cmd+alt+enter`) |
| Phel: nREPL Eval Selection | `phel.nrepl.evalSelection` | `eval` op on the selection, or the current line when the selection is empty. | nREPL | — |
| Phel: nREPL Load File | `phel.nrepl.loadFile` | `load-file` op carrying the buffer contents and its path (the path shows up in compile-error locations). | nREPL | — |
| Phel: nREPL Reload Changed Namespaces | `phel.nrepl.reload` | `reload` op with `all=0`. Also fired on save when `phel.nrepl.reloadOnSave` is on **and** a connection already exists — saving never starts one. | nREPL | — |
| Phel: nREPL Reload All Namespaces | `phel.nrepl.reloadAll` | `reload` op with `all=1`. | nREPL | — |
| Phel: nREPL Run Tests in Namespace | `phel.nrepl.runTestsInNs` | `run-tests` op for the active file's `(ns …)`. | nREPL | — |
| Phel: nREPL Run Test Under Cursor | `phel.nrepl.runTestUnderCursor` | `run-tests` op with `var` set to the enclosing `(deftest …)` name. | nREPL | — |

## Paredit & selection

Paredit lives in [`src/phelPareditProvider.ts`](../src/phelPareditProvider.ts) (gated by `phel.paredit.enabled`), expand / shrink in [`src/phelSelectionProvider.ts`](../src/phelSelectionProvider.ts). Each one reads the buffer and the cursor, runs a pure operation, and applies a single edit. All keybindings are scoped to `editorTextFocus && editorLangId == phel`.

| Command | Id | What it runs / does | Needs | Key |
|---|---|---|---|---|
| Phel: Slurp Forward | `phel.paredit.slurpForward` | Pulls the next sibling form into the current one. | nothing | `ctrl+shift+]` (`cmd+shift+]`) |
| Phel: Barf Forward | `phel.paredit.barfForward` | Pushes the last child out of the current form. | nothing | `ctrl+shift+[` (`cmd+shift+[`) |
| Phel: Slurp Backward | `phel.paredit.slurpBackward` | Pulls the previous sibling form in. | nothing | `ctrl+shift+9` (`cmd+shift+9`) |
| Phel: Barf Backward | `phel.paredit.barfBackward` | Pushes the first child out. | nothing | `ctrl+shift+0` (`cmd+shift+0`) |
| Phel: Raise Form | `phel.paredit.raise` | Replaces the enclosing form with the form at the cursor. | nothing | `ctrl+shift+r` (`cmd+shift+r`) |
| Phel: Wrap with ( ) | `phel.paredit.wrapRound` | Wraps the form at the cursor in `( )`. | nothing | `alt+w` |
| Phel: Wrap with [ ] | `phel.paredit.wrapSquare` | Wraps the form at the cursor in `[ ]`. | nothing | — |
| Phel: Wrap with { } | `phel.paredit.wrapCurly` | Wraps the form at the cursor in `{ }`. | nothing | — |
| Phel: Drag Form Forward | `phel.paredit.dragForward` | Swaps the form at the cursor with its next sibling. | nothing | `ctrl+shift+.` (`cmd+shift+.`) |
| Phel: Drag Form Backward | `phel.paredit.dragBackward` | Swaps it with its previous sibling. | nothing | `ctrl+shift+,` (`cmd+shift+,`) |
| Phel: Splice Form | `phel.paredit.splice` | Removes the enclosing delimiters, keeping the children. | nothing | `alt+shift+s` |
| Phel: Kill Form | `phel.paredit.kill` | Deletes the form at the cursor. | nothing | `alt+shift+k` |
| Phel: Expand Selection | `phel.selection.expand` | Grows the selection to the next enclosing form, pushing onto a per-editor stack. | nothing | `ctrl+shift+space` (`cmd+shift+space`) |
| Phel: Shrink Selection | `phel.selection.shrink` | Pops that stack, undoing the last expansion. | nothing | `ctrl+shift+alt+space` (`cmd+shift+alt+space`) |

Worked examples for each operation are in [REPL & paredit](repl-and-paredit.md#paredit).

## Debug & source maps

The debug session itself is started from a launch configuration of type `phel`, not from a command — see [debugging](debugging.md). These two work on the source maps behind it, and are registered in [`src/extension.ts`](../src/extension.ts).

| Command | Id | What it runs / does | Needs | Key |
|---|---|---|---|---|
| Phel: Show Compiled PHP Location | `phel.showCompiledLocation` | Maps the cursor line of the active `.phel` file to `<compiled>.php:<line>` and offers **Open PHP File** / **Copy Path**. Needs the file to have been compiled with source maps. | nothing | — |
| Phel: Clear Source Map Cache | `phel.clearSourceMapCache` | Drops the in-memory source-map cache, so the next lookup re-reads from `phel.cacheDirectory`. | nothing | — |

## Docs & navigation

| Command | Id | What it runs / does | Needs | Key |
|---|---|---|---|---|
| Phel: Show Documentation | `phel.showDoc` | Resolves the symbol from its argument, the word at the cursor, or a quick pick over the bundled corpus, then opens the rendered doc in a Markdown preview. Reads `assets/phel-core-docs.json`. | nothing | — |

Go to definition, find references, rename, outline and code actions are language-feature providers rather than commands; they answer VS Code's own entries (<kbd>F12</kbd>, <kbd>Shift</kbd>+<kbd>F12</kbd>, <kbd>F2</kbd>, <kbd>Ctrl</kbd>+<kbd>.</kbd>). See [refactoring](refactoring.md).

## Status bar

Registered by [`src/phelStatusBar.ts`](../src/phelStatusBar.ts). The item on the right shows the namespace of the `.phel` file you are in, followed by one icon per Phel process that is up — `$(pulse)` the analysis daemon, `$(plug)` an nREPL connection, `$(server)` the language server — and its tooltip spells the three out. See [the status bar](repl-and-paredit.md#the-status-bar).

| Command | Id | What it runs / does | Needs | Key |
|---|---|---|---|---|
| Phel: Status Actions | `phel.status.actions` | What clicking the status-bar item opens: a quick pick over **Start REPL**, **Connect** / **Disconnect** the nREPL server (whichever the current state allows), **Restart the analysis daemon**, **Restart the language server** (only while `phel.lsp.enabled` is on), **Show the Phel Analysis output**, and **Run doctor**. | nothing | — |
| Phel: Describe Runtime State | `phel.status.describe` | Returns the state behind those icons — daemon, nREPL and language server, per workspace folder — as a plain object. Hidden from the palette: it exists so the integration suite can read what the status bar renders, which `StatusBarItem` does not expose. | nothing | — |

## Rebinding

Any of these can be rebound in **Preferences: Open Keyboard Shortcuts**, or in `keybindings.json` by id:

```jsonc
[
  { "key": "ctrl+alt+r", "command": "phel.repl.evalForm", "when": "editorTextFocus && editorLangId == phel" }
]
```

The defaults ship in `contributes.keybindings` in `package.json`; `src/test/docsCommands.test.ts` keeps the id column above in sync with `contributes.commands`.
