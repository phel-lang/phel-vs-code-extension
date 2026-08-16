# Debugging Phel code

The extension bundles a native debug adapter (`type: "phel"`) that translates between `.phel` source and the compiled PHP. Breakpoints, stack traces, and stepping all stay in your Phel files.

## Prerequisites

Install and configure **Xdebug** in your PHP installation. The adapter speaks Xdebug's DBGP protocol over TCP - no PHP Debug extension required.

## Setup

1. **Enable Xdebug** in `php.ini`:
   ```ini
   [xdebug]
   zend_extension=xdebug
   xdebug.mode=debug
   xdebug.start_with_request=yes
   xdebug.client_port=9003
   ```

2. **Add a launch configuration** (`.vscode/launch.json`):
   ```json
   {
     "version": "0.2.0",
     "configurations": [
       {
         "type": "phel",
         "request": "launch",
         "name": "Debug Phel (Listen for Xdebug)",
         "phpDebugPort": 9003
       }
     ]
   }
   ```

3. **Set breakpoints** in `.phel` files (click in the gutter).

4. **Start debugging**:
   - Press <kbd>F5</kbd> or **Run → Start Debugging**.
   - Run your Phel application - e.g. `vendor/bin/phel run src/main.phel`.
   - Breakpoints hit and show your Phel source code.

## Configuration options

| Option | Default | Description |
|---|---|---|
| `phpDebugPort` | `9003` | Xdebug listen port |
| `cacheDir` | auto-detected from `phel-config.php` | Phel cache directory (where compiled PHP lands) |
| `pathMappings` | `{}` | Container / remote path mappings |
| `skipPhelInternals` | `true` | Skip stepping through Phel runtime code |
| `skipFiles` | `[]` | Glob patterns for files to skip |

`cacheDir` is auto-detected from the `setTempDir(...)` call in `phel-config.php`. If you use `sys_get_temp_dir()`, the adapter resolves it to `${os.tmpdir()}/phel`.

## Docker / remote debugging

Mount your project inside the container and add `pathMappings` so the adapter can map container paths back to your workstation:

```json
{
  "type": "phel",
  "request": "launch",
  "name": "Debug Phel (Docker)",
  "phpDebugPort": 9003,
  "pathMappings": {
    "/var/www/html": "${workspaceFolder}"
  }
}
```

In the container, set `xdebug.client_host=host.docker.internal` (macOS / Windows) or the host's bridge IP (Linux).

## What you get

- **Source-level breakpoints** - set them in `.phel`, hit them with the original Phel line + column.
- **Phel-friendly variables** - vectors render as `[3 items]`, hash maps as `{:k v}`, keywords as `:name`. Internal Phel runtime structures stay collapsed unless you opt in.
- **Whole-symbol hover** - hovering while paused evaluates the entire Phel name under the pointer (`add-item`, `blank?`, `str/join`), not the fragment the editor's own word pattern would cut out of it (`item`, `blank`, `join`).
- **Multi-expression line handling** - when a single Phel line compiles to several PHP statements, the adapter consolidates breakpoints so the line behaves as one unit.
- **Exception breakpoints** - break on all PHP exceptions or just uncaught ones (configure in the Run & Debug sidebar).
- **Step filter** - `skipPhelInternals: true` (default) keeps stepping inside *your* code, not Phel's runtime.

## Commands

- **Phel: Show Compiled PHP Location** - jump from the current `.phel` line to its compiled PHP equivalent.
- **Phel: Clear Source Map Cache** - drop cached source maps after a Phel rebuild.

## Why the session connects twice

Phel re-executes its own PHP process on startup to enable the opcache file cache
(`Phel\Shared\Performance\OpcacheReexec`). Under a debugger that means **two
Xdebug connections per run**, and the output channel says so:

```
Xdebug connected!
Request completed. Waiting for next connection...
Xdebug connected!
```

The first connection belongs to the launcher, which exits before running any of
your code. The second is the process that actually executes it, and that is
where breakpoints are hit. The adapter handles this: after a connection closes
it returns to listening and re-applies every breakpoint to the new one.

So "Request completed. Waiting for next connection..." partway through a run is
normal, not a failure. Traced against a live session, a breakpoint on
`lib/util.phel:3` is set on connection 1, discarded with it, re-applied on
connection 2, and hit there:

```
--- connection #1 ---
  init, breakpoint_set, closed
--- connection #2 ---
  init, breakpoint_set, run -> break at demo.util__a5b0ac5e.php:29
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Breakpoints show as hollow circles | Phel hasn't been compiled yet, or the cache directory is wrong |
| The session appears to disconnect mid-run | Expected: Phel re-execs for the opcache, so there are two connections. See [above](#why-the-session-connects-twice) |
| Adapter reports "no source map for `X.php`" | The `.phel` file was not compiled with source maps enabled |
| Steps land in unexpected files | `skipPhelInternals` is false, or `skipFiles` is empty - add globs |
| Container debugging hangs | Missing `pathMappings`, or `xdebug.client_host` not set inside the container |

For ad-hoc tracing without setting up a full debug session, see [Tracing with taps](taps.md).
