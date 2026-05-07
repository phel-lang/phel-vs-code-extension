# Settings reference

All settings live under `phel.*` in VS Code's settings (workspace or user level). Set them via the Settings UI, by editing `settings.json`, or per-folder in `.vscode/settings.json`.

## Phel CLI location

The extension shells out to the Phel CLI for diagnostics, formatting, the test runner, and the REPL. By default it expects `vendor/bin/phel` (the path Composer installs to). Override it once with `phel.executablePath`, or per subsystem if a particular feature needs a different binary.

| Setting | Type | Default | Description |
|---|---|---|---|
| `phel.executablePath` | string | `vendor/bin/phel` | Workspace-wide CLI path. Used by all subsystems unless overridden. Relative paths resolve against the workspace folder; absolute paths are used as-is. |
| `phel.diagnostics.command` | string | `""` | Override `phel.executablePath` for `phel analyze`. Empty string → fall back to `phel.executablePath`. |
| `phel.format.command` | string | `""` | Override `phel.executablePath` for `phel format`. Empty string → fall back to `phel.executablePath`. |
| `phel.test.command` | string | `""` | Override `phel.executablePath` for the test CodeLens / Test Explorer. Empty string → fall back to `phel.executablePath`. |
| `phel.repl.command` | string | `""` | Override `phel.executablePath` for the REPL terminal. Empty string → fall back to `phel.executablePath`. |
| `phel.repl.args` | string[] | `["repl"]` | Arguments passed to the Phel CLI when starting the REPL. |

**Resolution order** (per subsystem):

1. The per-subsystem setting (`phel.diagnostics.command`, `phel.format.command`, …) when set to a non-empty string.
2. `phel.executablePath`.
3. Built-in default `vendor/bin/phel`.

### Example: binary in `bin/phel`

```jsonc
// .vscode/settings.json
{
  "phel.executablePath": "bin/phel"
}
```

### Example: absolute path

```jsonc
{
  "phel.executablePath": "/usr/local/bin/phel"
}
```

### Example: per-subsystem override

The default CLI for everything is `bin/phel`, but the test runner uses a wrapper script:

```jsonc
{
  "phel.executablePath": "bin/phel",
  "phel.test.command": "scripts/phel-with-coverage.sh"
}
```

## Feature toggles

| Setting | Type | Default | Description |
|---|---|---|---|
| `phel.diagnostics.enabled` | boolean | `true` | Run `phel analyze` on save and surface inline diagnostics. |
| `phel.format.enabled` | boolean | `true` | Use `phel format` as the document formatter. |
| `phel.tests.codeLensEnabled` | boolean | `true` | Show inline `▶ Run test` CodeLens above each `deftest`. |
| `phel.paredit.enabled` | boolean | `true` | Register paredit commands (slurp / barf / raise / wrap). |
| `phel.repl.enabled` | boolean | `true` | Register REPL commands (start / eval form / eval selection / eval file). |
| `phel.repl.history.enabled` | boolean | `true` | Append every form sent to the REPL to `.vscode/phel-repl-history.phel`. |
| `phel.formHighlight.enabled` | boolean | `true` | Subtle background tint on the form enclosing the cursor. |
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
