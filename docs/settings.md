# Settings reference

All settings live under `phel.*` in VS Code's settings (user or workspace level). Set them via the Settings UI or by editing `settings.json`. Some of them can additionally be set per workspace folder, in that folder's `.vscode/settings.json` — see [per-folder settings](#per-folder-settings).

## Phel CLI location

The extension shells out to the Phel CLI for diagnostics, formatting, the test runner, and the REPL. By default it expects `vendor/bin/phel` (the path Composer installs to). Override it once with `phel.executablePath`, or per subsystem if a particular feature needs a different binary.

| Setting | Type | Default | Description |
|---|---|---|---|
| `phel.executablePath` | string | `vendor/bin/phel` | CLI path, workspace-wide or [per folder](#per-folder-settings). Used by all subsystems unless overridden. Relative paths resolve against the workspace folder; absolute paths are used as-is. |
| `phel.diagnostics.command` | string | `""` | Override `phel.executablePath` for `phel lint` / `phel analyze`. Empty string → fall back to `phel.executablePath`. |
| `phel.format.command` | string | `""` | Override `phel.executablePath` for `phel format`. Empty string → fall back to `phel.executablePath`. |
| `phel.test.command` | string | `""` | Override `phel.executablePath` for the test CodeLens / Test Explorer. Empty string → fall back to `phel.executablePath`. Benchmarks are not covered by it: `phel bench` has no per-command override anywhere. |
| `phel.repl.command` | string | `""` | Override `phel.executablePath` for the REPL terminal. Empty string → fall back to `phel.executablePath`. |
| `phel.repl.args` | string[] | `["repl"]` | Arguments passed to the Phel CLI when starting the REPL. |

**Resolution order** (per subsystem):

1. The per-subsystem setting (`phel.diagnostics.command`, `phel.format.command`, …) when set to a non-empty string.
2. `phel.executablePath`.
3. Built-in default `vendor/bin/phel`.

The `phel` [tasks](commands.md#tasks) resolve the same way, per subcommand: the `test` task through `phel.test.command`, `lint` through `phel.diagnostics.command`, `format` through `phel.format.command`, the rest through `phel.executablePath`.

### Example

```jsonc
// .vscode/settings.json
{
  // Relative to the workspace folder; an absolute path such as
  // "/usr/local/bin/phel" works the same way.
  "phel.executablePath": "bin/phel",

  // Optional: one subsystem needs a different binary.
  "phel.test.command": "scripts/phel-with-coverage.sh"
}
```

## Per-folder settings

In a multi-root workspace each project can carry its own CLI. The settings below are read against the workspace folder of the file being acted on, so a value in that folder's `.vscode/settings.json` wins over the workspace-wide and user ones:

| Setting | Read for |
|---|---|
| `phel.executablePath` | every subsystem, as the fallback |
| `phel.diagnostics.command`, `phel.format.command`, `phel.test.command`, `phel.repl.command`, `phel.lsp.command` | the subsystem that names them |
| `phel.repl.args`, `phel.repl.history.enabled` | the REPL terminal, per folder |
| `phel.lsp.args` | the language server |
| `phel.nrepl.reloadOnSave`, `phel.nrepl.hoverEval` | the nREPL connection, per folder |

```jsonc
// api/.vscode/settings.json — only this folder uses this binary
{
  "phel.executablePath": "tools/phel"
}
```

The language server is the exception the [known limitation](#language-server) below describes: one server per window, rooted at the first folder, so `phel.lsp.command` / `phel.lsp.args` are read from that folder and a value in the second one has no effect.

Everything else is window-scoped: VS Code greys it out in a folder's `settings.json` (*"This setting cannot be applied in this workspace folder"*). Either it decides at activation what the window registers — `phel.lsp.enabled`, `phel.debug.enabled`, `phel.paredit.enabled`, `phel.repl.enabled`, `phel.nrepl.enabled` — or the extension reads it once for the window rather than per file: the feature toggles (`phel.diagnostics.*`, `phel.format.enabled`, `phel.tests.codeLensEnabled`, `phel.migration.enabled`, `phel.inlayHints.parameterNames`, `phel.formHighlight.enabled`) and `phel.cacheDirectory`.

## Language server

Off by default. When enabled, completion, hover, signature help, definition, references, rename, symbols, formatting and diagnostics are served by Phel's own `phel lsp` instead of the bundled providers; the bundled ones take over again if the server never starts or keeps dying. See [completion](completion.md).

| Setting | Type | Default | Description |
|---|---|---|---|
| `phel.lsp.enabled` | boolean | `false` | Use `phel lsp` for the language features. Needs a reload. |
| `phel.lsp.command` | string | `""` | Override `phel.executablePath` for the language server. Empty string → fall back to `phel.executablePath`. |
| `phel.lsp.args` | string[] | `["lsp"]` | Arguments passed to the Phel CLI when starting the server. |

**Known limitation — multi-root workspaces.** The extension starts one server per window, rooted at the **first** workspace folder, and every `.phel` file in the window is served by it: `phel lsp` has no multi-root notion, and a server per folder would mean one compiler process and one cache per folder. Relative paths in `phel.lsp.command` / `phel.executablePath` and the server's own config therefore resolve against that first folder. Everything else — diagnostics, formatting, the test and benchmark runners, the REPL — resolves the folder from the file it acts on. If the second project needs its own server, open it in its own window.

## Feature toggles

| Setting | Type | Default | Description |
|---|---|---|---|
| `phel.diagnostics.enabled` | boolean | `true` | Run the diagnostics engine on open/save and surface inline diagnostics. |
| `phel.diagnostics.engine` | `auto` \| `lint` \| `analyze` | `auto` | Which CLI subcommand backs diagnostics. See [Diagnostics engine](#diagnostics-engine). |
| `phel.diagnostics.live` | boolean | `true` | Also report analyzer diagnostics as you type, through a long-lived `phel api-daemon`. The same daemon indexes the project for namespace-aware go-to-definition and cross-file references, so this switch turns those off too. See [Live diagnostics](#live-diagnostics) and [what the daemon adds to navigation](refactoring.md#what-the-analysis-daemon-adds). |
| `phel.format.enabled` | boolean | `true` | Use `phel format` as the document formatter. |
| `phel.tests.codeLensEnabled` | boolean | `true` | Show inline `▶ Run test` CodeLens above each `deftest`, and `▶ Run benchmark` above each `defbench`. |
| `phel.migration.enabled` | boolean | `true` | Flag what Phel 0.50 removed (core aliases, `#\| \|#`, bare `#` comments, `\|()` short fns, `foo$` gensyms, `,` unquote, `^:reference`) and deprecated (`php/new`, `php/->`, `php/::`, `set-var`, the `\` namespace separator), plus calls to your own `:deprecated` definitions, with a quick fix where the rewrite is mechanical. Turn off when targeting a Phel older than 0.50. Severity follows the project, see [below](#what-the-project-config-decides). See [Migrating to Phel 0.50](completion.md#migrating-to-phel-050). |
| `phel.paredit.enabled` | boolean | `true` | Register paredit commands (slurp / barf / raise / wrap). |
| `phel.repl.enabled` | boolean | `true` | Register REPL commands (start / eval form / eval selection / eval file). |
| `phel.repl.history.enabled` | boolean | `true` | Append every form sent to the REPL to `.vscode/phel-repl-history.phel`. |
| `phel.nrepl.enabled` | boolean | `true` | Register the nREPL commands (connect, structured eval, reload, run tests). |
| `phel.nrepl.reloadOnSave` | boolean | `false` | Reload changed namespaces on every save of a `.phel` file. Only when a connection is already open. |
| `phel.nrepl.hoverEval` | boolean | `true` | Hovering a symbol also shows what it evaluates to in the running program, as `=> value`. Symbols only, 2 s budget, and only while a connection is already open. See [Hover evaluation](repl-and-paredit.md#hover-evaluation-nrepl). |
| `phel.formHighlight.enabled` | boolean | `true` | Subtle background tint on the form enclosing the cursor. |
| `phel.inlayHints.parameterNames` | boolean | `false` | Show the parameter name before each argument at a call site: `(assoc ds: m key: :k value: v)`. Functions only, and dropped wherever it would mislead. See [Parameter inlay hints](completion.md#parameter-inlay-hints). |
| `phel.debug.enabled` | boolean | `true` | Enable the bundled Phel debug adapter. Disable to fall back to a raw PHP debug session. |

## What the project config decides

Some behaviour has no setting here on purpose: your `phel-config.php` already answers the question, and a second answer in VS Code could only disagree with it. The extension asks the CLI (`phel config --format=json`, which merges `phel-config-local.php` and applies the defaults) once per workspace folder, lazily and cached, and re-reads it when either config file is saved.

| From `phel-config.php` | What follows it |
|---|---|
| `warn-deprecations` | Migration severity. On → a call to a deprecated form is a **warning**, exactly what `phel build` reports. Off (the default) → a struck-through **hint**. Removed names and syntax are always warnings, and so is the `\` namespace separator, which Phel announces whether or not the flag is set. |
| `test-dirs` | What both Explorer trees scan, for `deftest` and for `defbench`. Without it, every `.phel` file in the folder except `vendor` and `node_modules`. |
| `cache-dir` | The `cacheDir` a Phel debug session defaults to (`<cache-dir>/compiled`), unless the launch configuration sets one. |

No Phel installed, or one too old to print its configuration? Every one of these falls back to what it did before, so a project without `vendor/bin/phel` behaves exactly as it always has.

## Other

| Setting | Type | Default | Description |
|---|---|---|---|
| `phel.cacheDirectory` | string | `""` | Path to the Phel cache directory (where compiled PHP files land). Empty → system temp directory (`${os.tmpdir()}/phel`). |

### Example: project-local cache

```jsonc
{
  "phel.cacheDirectory": "${workspaceFolder}/var/cache/phel"
}
```

### Example: disable the debug adapter

```jsonc
{
  "phel.debug.enabled": false
}
```

## Theming `meta.reader-conditional.phel`

Reader conditionals carry a `meta.reader-conditional.phel` scope so themes can dim the inactive branch:

```jsonc
"editor.tokenColorCustomizations": {
    "textMateRules": [
        { "scope": "meta.reader-conditional.phel", "settings": { "foreground": "#888" } }
    ]
}
```

The full scope vocabulary used by the grammar lives in [docs/syntax.md](syntax.md).

## Diagnostics engine

`phel lint` reports everything `phel analyze` does **plus** rule-based findings — unused bindings, shadowed bindings, arity problems, and whatever `phel-lint.phel` configures. On a file with one undefined symbol and one unused binding, `analyze` reports 1 diagnostic and `lint` reports 2.

`lint` arrived after `analyze`, so the default is `auto`: use `lint`, and if the CLI rejects the subcommand (an older Phel), fall back to `analyze` and remember that for the session. Changing the executable or this setting retries `lint`.

| Value | Behaviour |
|---|---|
| `auto` (default) | `phel lint`, falling back to `phel analyze` on an older CLI |
| `lint` | Always `phel lint --format=json` |
| `analyze` | Always `phel analyze` — semantic errors for the single file only |

A non-zero exit is expected from both: they exit 1 when they found errors and still print the diagnostics.

### Phel: Lint Workspace

`phel lint` also walks the configured source dirs, so the **Phel: Lint Workspace** command (`phel.lintWorkspace`) runs it over the whole project and populates the Problems panel for every file — including ones never opened in the editor. On-save diagnostics stay scoped to the file you saved.

The `phel: lint` [task](commands.md#tasks) does the same thing through the task system, with the `$phel-lint` problem matcher parsing the CLI's human-readable output. Use whichever fits: the command when you want it on a keystroke, the task when you want it in a task chain or bound to <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>.

## Live diagnostics

`phel.diagnostics.live` (default on) adds a second pass that runs **as you type**, 500 ms after you stop. It talks to `phel api-daemon`, a long-running process the extension starts on first use — one per workspace folder — and asks it to analyse the buffer you are editing, unsaved contents and all.

What it reports is the analyzer's findings only: unresolved symbols, arity errors, reader errors. The daemon has no access to the `phel lint` rule set (unused bindings, unused requires, comment style, everything `phel-lint.phel` configures), which is why the on-save pass stays as it was. Where the two overlap — `phel lint` republishes the analyzer's own findings under its rule codes — the live copy is dropped, so nothing is squiggled twice.

How it interacts with `phel.diagnostics.engine`:

| `engine` | On save | As you type |
|---|---|---|
| `auto` (default) | `phel lint`, one CLI run | daemon |
| `auto`, on a Phel without `lint` | daemon (no second process) | daemon |
| `lint` | `phel lint`, one CLI run | daemon |
| `analyze` | daemon (no second process) | daemon |

So whenever the effective engine is `analyze`, the save reuses the warm daemon instead of paying for a PHP start-up. `lint` always needs its own run: only the CLI has the rules.

Both settings are independent switches — `phel.diagnostics.live: false` leaves the on-save pass exactly as it was, and turning `phel.diagnostics.enabled` off turns both passes off.

**A Phel without `api-daemon`** (the command landed in 0.34) simply gets no live diagnostics: the extension notices the CLI rejecting the subcommand and stays quiet for the session, without a notification. Everything on save keeps working.

**Staleness.** The daemon evaluates a file's dependencies once per process, so an edit you save in *another* file is not picked up by a process that already loaded the old version. The extension restarts the daemon the first time you ask about a different file after a save, which covers the usual edit-save-switch loop. If diagnostics still look stale, **Phel: Restart Analysis Daemon** (`phel.diagnostics.restartDaemon`) drops the process; see [troubleshooting](troubleshooting.md#diagnostics).

**The same process also powers navigation.** Two seconds after each save it re-indexes the project, and go-to-definition and find-references read that index; see [what the analysis daemon adds](refactoring.md#what-the-analysis-daemon-adds).

Every other command the extension contributes is listed in the [commands reference](commands.md).
