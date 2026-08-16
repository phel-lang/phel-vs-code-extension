# Point at your CLI

`phel.executablePath` is the one setting most projects ever touch. It defaults
to `vendor/bin/phel` — the path Composer installs to — and every subsystem
(diagnostics, formatting, tests, REPL) uses it unless overridden.

Change it when your binary lives elsewhere:

```jsonc
// .vscode/settings.json
{
  // Relative paths resolve against the workspace folder; an absolute path
  // such as "/usr/local/bin/phel" works the same way.
  "phel.executablePath": "bin/phel"
}
```

One subsystem can be sent to a different binary with `phel.diagnostics.command`,
`phel.format.command`, `phel.test.command`, or `phel.repl.command`. Each falls
back to `phel.executablePath` while it is an empty string.
