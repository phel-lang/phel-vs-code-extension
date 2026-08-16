# Settings reference

All settings live under `phel.*` in VS Code's settings (workspace or user level). Set them via the Settings UI, by editing `settings.json`, or per-folder in `.vscode/settings.json`.

## Phel CLI location

The extension shells out to the Phel CLI for diagnostics, formatting, the test runner, and the REPL. By default it expects `vendor/bin/phel` (the path Composer installs to). Override it once with `phel.executablePath`, or per subsystem if a particular feature needs a different binary.

| Setting | Type | Default | Description |
|---|---|---|---|
| `phel.executablePath` | string | `vendor/bin/phel` | Workspace-wide CLI path. Used by all subsystems unless overridden. Relative paths resolve against the workspace folder; absolute paths are used as-is. |
| `phel.diagnostics.command` | string | `""` | Override `phel.executablePath` for `phel lint` / `phel analyze`. Empty string → fall back to `phel.executablePath`. |
| `phel.format.command` | string | `""` | Override `phel.executablePath` for `phel format`. Empty string → fall back to `phel.executablePath`. |
| `phel.test.command` | string | `""` | Override `phel.executablePath` for the test CodeLens / Test Explorer. Empty string → fall back to `phel.executablePath`. |
| `phel.repl.command` | string | `""` | Override `phel.executablePath` for the REPL terminal. Empty string → fall back to `phel.executablePath`. |
| `phel.repl.args` | string[] | `["repl"]` | Arguments passed to the Phel CLI when starting the REPL. |

**Resolution order** (per subsystem):

1. The per-subsystem setting (`phel.diagnostics.command`, `phel.format.command`, …) when set to a non-empty string.
2. `phel.executablePath`.
3. Built-in default `vendor/bin/phel`.

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
| `phel.format.enabled` | boolean | `true` | Use `phel format` as the document formatter. |
| `phel.tests.codeLensEnabled` | boolean | `true` | Show inline `▶ Run test` CodeLens above each `deftest`, and `▶ Run benchmark` above each `defbench`. |
| `phel.migration.enabled` | boolean | `true` | Flag what Phel 0.50 removed (core aliases, `#\| \|#`, bare `#` comments, `\|()` short fns, `foo$` gensyms, `,` unquote, `^:reference`) and deprecated (`php/new`, `php/->`, `php/::`, `set-var`, the `\` namespace separator), plus calls to your own `:deprecated` definitions, with a quick fix where the rewrite is mechanical. Turn off when targeting a Phel older than 0.50. See [Migrating to Phel 0.50](completion.md#migrating-to-phel-050). |
| `phel.paredit.enabled` | boolean | `true` | Register paredit commands (slurp / barf / raise / wrap). |
| `phel.repl.enabled` | boolean | `true` | Register REPL commands (start / eval form / eval selection / eval file). |
| `phel.repl.history.enabled` | boolean | `true` | Append every form sent to the REPL to `.vscode/phel-repl-history.phel`. |
| `phel.formHighlight.enabled` | boolean | `true` | Subtle background tint on the form enclosing the cursor. |
| `phel.inlayHints.parameterNames` | boolean | `false` | Show the parameter name before each argument at a call site: `(assoc ds: m key: :k value: v)`. Functions only, and dropped wherever it would mislead. See [Parameter inlay hints](completion.md#parameter-inlay-hints). |
| `phel.debug.enabled` | boolean | `true` | Enable the bundled Phel debug adapter. Disable to fall back to a raw PHP debug session. |

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

Every other command the extension contributes is listed in the [commands reference](commands.md).
