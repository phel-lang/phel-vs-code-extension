# Settings reference

All settings live under `phel.*` in VS Code's settings (workspace or user level). Set them via the Settings UI, by editing `settings.json`, or per-folder in `.vscode/settings.json`.

| Setting | Type | Default | Description |
|---|---|---|---|
| `phel.cacheDirectory` | string | `""` | Path to the Phel cache directory (where compiled PHP files land). Empty value → the system temp directory (`${os.tmpdir()}/phel`). |
| `phel.debug.enabled` | boolean | `true` | Enable the bundled Phel debug adapter for source-level debugging. Disable if you want to fall back to a vanilla PHP debug session. |

## Examples

**Project-local cache** (`.vscode/settings.json`):

```jsonc
{
  "phel.cacheDirectory": "${workspaceFolder}/var/cache/phel"
}
```

**Disable the debug adapter** for a project that doesn't need it:

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
