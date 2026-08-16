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

## Debugging one test

**Phel: Debug Test**, the `$(debug-alt) Debug test` CodeLens above every
`deftest`, and the **Debug** profile in the Testing view all do the same two
things in the same order:

1. start a `phel` debug session listening on a free port (or the `phpDebugPort`
   of a `phel` configuration in the folder's `launch.json`, when there is one);
2. open the **Phel Debug Test** terminal running `phel test --filter '/^<name>$/'
   <file>` with

   ```
   XDEBUG_MODE=debug XDEBUG_SESSION=1 XDEBUG_CONFIG=client_port=<port>
   ```

   so that run - and only that run - dials back into the session just started.

Nothing has to be configured for this: `XDEBUG_MODE` turns the debugger on for
that one process, so `php.ini` can stay as it is. Xdebug does have to be
*installed* in the PHP that runs the tests (`php -v` mentions it).

The order matters, and is why the listener is opened first: a PHP process that
finds nothing on the port runs straight through, and the run looks like it
simply passed.

The Testing view's Debug profile cannot report pass / fail - a debugged run
prints into its terminal rather than writing the JUnit report the Run profile
parses - so its items end in the skipped state. Use **Run** for results and
**Debug** for breakpoints.

## Conditions, hit counts, and logpoints

Right-click a breakpoint in the gutter → **Edit Breakpoint…** for all three.

### Conditions

A condition is evaluated **by Xdebug, as PHP**, in the frame it is about to stop
in - so it names the variable the *compiler* emitted, not the Phel binding. The
adapter translates for you:

| You write | Xdebug evaluates |
|---|---|
| `item-count > 3` | `$item_count > 3` |
| `blank?` | `$blank_QMARK_` |
| `x != nil` | `$x != null` |
| `state == :done` | `$state == \Phel\Lang\Keyword::create("done")` |
| `count(xs) > 2` | `count($xs) > 2` |
| `$already_php` | unchanged |

The spelling comes from `Munge` in phel-lang (`src/php/Shared/Munge.php`): `-`
becomes `_`, and every other special character a spelled-out token (`?` →
`_QMARK_`, `!` → `_BANG_`, `*` → `_STAR_`, …). Anything that already looks like
PHP - a `$variable`, a call, a string, `Class::CONST` - is passed through
untouched, so a condition can always be written in plain PHP instead.

Two things to know:

- **`let` bindings carry a suffix.** A function parameter compiles to its munged
  name, but every `let` / `loop` binding is shadowed with a counter
  (`$total_1234`), which no condition can predict. Pause once and read the real
  name off the **Variables** view, then use it verbatim.
- **A broken condition fails silently.** Xdebug takes the expression when the
  breakpoint is installed and only evaluates it later, so a condition that is
  not valid PHP - or names something not in scope - is accepted and then simply
  never becomes true. Traced against Xdebug 3.4: `$i === === 3` comes back with
  a breakpoint id and no error, and never fires. A breakpoint the engine does
  refuse outright is shown unverified, carrying what it said. When a condition
  never seems to hit, drop it and check the plain breakpoint stops at all.

### Hit counts

`3`, `>= 3`, `== 3`, `% 3` and `> 3` are understood (a bare number means "from
the 3rd hit on"; `%` means "every 3rd"). Anything else is ignored, and the
breakpoint is installed without a hit count rather than being refused wholesale.

One caveat: a Phel line that compiles to several PHP expressions gets a
breakpoint per expression, each counting its own hits - so a hit count on such a
line counts stops, which can be more than one per pass.

### Logpoints

A breakpoint with a **Log Message** never stops: it prints, then continues.
`{...}` interpolates, with the same translation as a condition:

```
n is {n}, xs has {count(xs)} items
```

Each `{expression}` is evaluated in the paused frame and the result goes to the
Debug Console. `\{` and `\}` print a literal brace; an expression that cannot be
evaluated prints its reason inline rather than losing the whole line.

## Watch and hover

The **Watch** panel and hovering over a name while paused both evaluate the
whole Phel symbol under the pointer (`add-item`, `blank?`, `str/join`), with the
translation above. A watch expression that is not in scope in the current frame
shows `<not available>` rather than a PHP error - watches are evaluated on every
step, so most of them are out of scope most of the time. The **Debug Console**
does show the error, because there you asked.

## What you get

- **Source-level breakpoints** - set them in `.phel`, hit them with the original Phel line + column.
- **Conditional breakpoints, hit counts, logpoints** - see [above](#conditions-hit-counts-and-logpoints).
- **Phel-friendly variables** - vectors render as `[3 items]`, hash maps as `{:k v}`, keywords as `:name`. Internal Phel runtime structures stay collapsed unless you opt in.
- **Whole-symbol hover** - hovering while paused evaluates the entire Phel name under the pointer (`add-item`, `blank?`, `str/join`), not the fragment the editor's own word pattern would cut out of it (`item`, `blank`, `join`).
- **Multi-expression line handling** - when a single Phel line compiles to several PHP statements, the adapter consolidates breakpoints so the line behaves as one unit.
- **Exception breakpoints** - **All Exceptions** in the Run & Debug sidebar, off by default. DBGp breaks where an exception is *thrown* and cannot say whether it will be caught, so this stops on caught ones too - useful for finding where something originates, noisy for anything else. There is deliberately no "uncaught only" checkbox: Xdebug cannot express it (an uncaught exception with no exception breakpoint set does not stop at all), and the one that used to be there stopped every `phel` run inside the console component's own caught exceptions.
- **Step filter** - `skipPhelInternals: true` (default) keeps stepping inside *your* code, not Phel's runtime.

## Commands

- **Phel: Debug Test** - start a session and run one `deftest` (or a whole file) against it.
- **Phel: Show Compiled PHP Location** - jump from the current `.phel` line to its compiled PHP equivalent.
- **Phel: Clear Source Map Cache** - drop cached source maps after a Phel rebuild.

## Checking a breakpoint by hand

Whether a breakpoint is *hit* is the one thing no test in this repo can observe:
it needs a PHP with Xdebug, a compiled project, and a process that connects
back. The automated suites go as far as the wiring - that the session listens,
that the run is started with the right environment, that the right DBGp command
goes on the wire. The rest is this five-minute checklist, worth walking after
touching the adapter:

1. `php -v` mentions Xdebug (any 3.x).
2. Open a project with a `deftest`, put a breakpoint on a line inside the tested
   function, and click **Debug test** above the `deftest`.
3. The Debug Console says `Phel debugger listening on port …`, then
   `Xdebug connected!` **twice** (see [above](#why-the-session-connects-twice)),
   then `🛑 Breakpoint hit!`, and the editor stops on your **Phel** line.
4. **Variables** shows Phel-shaped values (`[3 items]`, `:keyword`), and hovering
   a name shows its value.
5. Add a condition that is false (`x == -1`) and re-run: no stop. Make it true:
   stop.
6. Set a hit count of `>= 2` on a line inside a loop: the first pass does not
   stop, the second does.
7. Replace the condition with a log message (`n is {n}`): the run finishes
   without stopping and the Debug Console has one line per pass.
8. While paused, add a nonsense watch expression: it reads `<not available>`,
   not an error dump.

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
| A conditional breakpoint never fires | The condition names a `let` binding (whose PHP variable carries a counter suffix - read the real name off the Variables view), or it is not valid PHP once translated. Xdebug accepts a condition it later cannot evaluate and just never breaks |
| A breakpoint says "Xdebug rejected the breakpoint" | The engine refused it outright; the message is what it said |
| **Debug Test** runs but nothing ever connects | Xdebug isn't installed in the PHP running the tests (`php -v`) |
| The session appears to disconnect mid-run | Expected: Phel re-execs for the opcache, so there are two connections. See [above](#why-the-session-connects-twice) |
| Adapter reports "no source map for `X.php`" | The `.phel` file was not compiled with source maps enabled |
| Steps land in unexpected files | `skipPhelInternals` is false, or `skipFiles` is empty - add globs |
| Container debugging hangs | Missing `pathMappings`, or `xdebug.client_host` not set inside the container |

For ad-hoc tracing without setting up a full debug session, see [Tracing with taps](taps.md).
