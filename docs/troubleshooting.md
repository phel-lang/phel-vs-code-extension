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

## Diagnostics

**Nothing appears while I type, only when I save.**
As-you-type diagnostics need `phel api-daemon`, which arrived in Phel 0.34. On an older CLI the extension notices the rejected subcommand and stays quiet for the rest of the session — on-save diagnostics keep working. Check the **Phel Analysis** output channel (**View → Output**, then pick it from the dropdown): it names the command it started, and says so when the CLI has no `api-daemon`. `phel.diagnostics.live` also has to be on, and the file has to be saved on disk inside a workspace folder — the analyzer resolves a file's namespace and dependencies by reading it.

**A squiggle points at something I already fixed in another file.**
The daemon evaluates each dependency once per process; re-evaluating a namespace it already loaded throws inside Phel and is ignored, so a saved change in *another* file can stay invisible to a warm process. The extension restarts it the first time you ask about a different file after a save, which covers the usual loop. When it does not, run **Phel: Restart Analysis Daemon** (`phel.diagnostics.restartDaemon`): it stops the process and clears what it reported, and your next edit starts a fresh one.

**The same problem is listed twice.**
Shouldn't happen: the live pass drops any finding the on-save run already reports at the same position with the same message. If you do see a pair, one of them is a rule finding (`phel/…`) and the other is not, which means they are genuinely two findings. `phel.diagnostics.live: false` turns the live pass off.

**Problems from the `phel` task type point at a different copy of the file.**
Phel resolves symlinks in every path it prints, so on a workspace opened through one (`/var/…`, which is `/private/var/…` on macOS, or a symlinked `~/Code`) the CLI names a file differently than the editor does. Everything the extension reports itself — on-save and live diagnostics, go to definition, find all references, test coverage — is mapped back to the path you opened. A task's problems are not ours to map: VS Code builds those markers from the task's output before the extension ever sees them, so they show under the resolved path and open a second copy of the file. Opening the workspace at its resolved path avoids it entirely.

**Analysis stops after a while.**
A daemon that dies or hangs is restarted, up to five times a minute; past that the extension gives up for the session rather than spin up processes forever. The output channel logs each restart and the moment it gives up. Changing `phel.executablePath` (or the `phel.diagnostics.*` settings), or running the restart command, starts over with a clean budget.

## Debugging

**Breakpoints show as hollow circles.**
Phel hasn't compiled the file yet, or the cache directory is wrong. Run a Phel build first, then verify `phel.cacheDirectory` (or the `setTempDir(...)` call in `phel-config.php`).

**Adapter reports "no source map for X.php".**
The `.phel` file was compiled without source maps. Make sure your Phel build emits them.

**Steps land in Phel runtime files.**
Set `skipPhelInternals: true` (the default) and add additional globs to `skipFiles` if needed.

**Container debugging hangs.**
Missing `pathMappings`, or `xdebug.client_host` isn't set to the host's address from inside the container. On macOS / Windows use `host.docker.internal`. On Linux, the bridge IP (often `172.17.0.1`).

## Windows

**Nothing CLI-backed works: no diagnostics, no formatting, the REPL terminal closes at once.**
Every one of those runs the Phel CLI, and on Windows that needs `php` on the `PATH`. Check with `php -v` in a fresh terminal; if it isn't found, add your PHP directory to the user `PATH` and restart VS Code so it inherits the new environment.

Why `php`: `composer require phel-lang/phel` writes two proxies into `vendor\bin`. `vendor\bin\phel` is a PHP script - Windows cannot execute it directly - and `vendor\bin\phel.bat` is a batch file whose whole body is `php "%~dp0/phel" %*`. Node refuses to spawn a `.bat` or `.cmd` outright unless it is told to go through `cmd.exe`. So the extension does what the batch file does: it resolves `vendor\bin\phel`, and when that PHP proxy is on disk it runs `php vendor\bin\phel <args>` (see `src/phelInvocation.ts`). Arguments stay an argv array, so a workspace path with spaces needs no quoting.

**`phel.executablePath` points at a `.bat` / `.cmd`, or at `phel` on the `PATH`.**
Supported. A `.bat` whose extension-less PHP proxy sits next to it is run through `php` as above; anything else is started via `cmd.exe`, which is the only way to launch a batch file. A path with spaces is safest as the extension-less proxy or as an `.exe`.

**Find All References shows the saved text of a file I have open and edited.**
Open editors used to be matched by path, and the same file can be spelled with either drive-letter case (`C:\...` / `c:\...`), so a buffer could be missed and its file re-read from disk instead. Matching is by URI now - update the extension.

## Reporting issues

When filing a bug, include:

- VS Code version and OS
- Extension version (run **Phel Lang** in Extensions sidebar)
- A minimal `.phel` snippet that reproduces the problem
- What you expected vs. what happened (a screenshot helps for highlighting / completion bugs)
- Relevant settings (`phel.*`) and `launch.json` config (debugging issues)
