# Troubleshooting

Common problems and fixes. If your issue isn't here, open one at [GitHub Issues](https://github.com/phel-lang/phel-vs-code-extension/issues).

## Highlighting

**No highlighting in `.phel` files.**
The extension activates on language `phel`. Confirm the file's language mode in the bottom-right status bar. If it says **Plain Text**, click it and pick *Phel*. If *Phel* isn't in the list, the extension didn't install - see [Installation](installation.md).

**Some forms render as plain symbols.**
The grammar tracks `phel-lang` `main`. If you're using a bleeding-edge form added after the last extension release, it may not be in the keyword list yet - file an issue with a code sample, or refresh the grammar yourself (see [CONTRIBUTING.md](CONTRIBUTING.md)).

**`#tag` literals show with a default colour.**
Tagged literals scope as `storage.type.tagged.phel`. Most themes don't style that scope explicitly. Add a rule in your settings:

```jsonc
"editor.tokenColorCustomizations": {
    "textMateRules": [
        { "scope": "storage.type.tagged.phel", "settings": { "foreground": "#c586c0" } }
    ]
}
```

## Completion

**No suggestions when I type.**
Confirm the language mode is `phel` (see above). Completion lives in `src/phelCompletionProvider.ts` and registers on the `phel` language ID - if the file isn't recognised as Phel, the provider doesn't fire.

**Suggestion list misses a function I just added in `phel-lang`.**
The list is a static snapshot. Refresh it via `npm run regen-docs` and rebuild - see [completion.md](completion.md).

## Debugging

**Breakpoints show as hollow circles.**
Phel hasn't compiled the file yet, or the cache directory is wrong. Run a Phel build first, then verify `phel.cacheDirectory` (or the `setTempDir(...)` call in `phel-config.php`).

**Adapter reports "no source map for X.php".**
The `.phel` file was compiled without source maps. Make sure your Phel build emits them.

**Steps land in Phel runtime files.**
Set `skipPhelInternals: true` (the default) and add additional globs to `skipFiles` if needed.

**Container debugging hangs.**
Missing `pathMappings`, or `xdebug.client_host` isn't set to the host's address from inside the container. On macOS / Windows use `host.docker.internal`. On Linux, the bridge IP (often `172.17.0.1`).

## Reporting issues

When filing a bug, include:

- VS Code version and OS
- Extension version (run **Phel Lang** in Extensions sidebar)
- A minimal `.phel` snippet that reproduces the problem
- What you expected vs. what happened (a screenshot helps for highlighting / completion bugs)
- Relevant settings (`phel.*`) and `launch.json` config (debugging issues)
