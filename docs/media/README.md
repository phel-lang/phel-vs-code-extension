# Marketplace media

The Marketplace listing shows the extension's `icon.png` and whatever images the
README references. It currently references none: the three shots described below
have to be taken by hand, and this file is the recipe for taking them so that two
people a year apart produce the same picture.

**Why by hand.** There is no screenshot API in the extension host, so nothing in
`src/test/integration/` can photograph itself, and every interesting frame is a
transient overlay — the completion widget, a hover, a CodeLens mid-run — that
only exists while a real editor has focus. Driving a downloaded VS Code under a
virtual display gets the pixels but not the state: the widgets close as soon as
the automation lets go of focus, and the font rendering is not what a reader
would see. So these are captured on a real desktop, and reproducibility comes
from pinning the window, the theme and the project instead of from a script.

## Where the files go

Committed as `docs/media/<name>.png`, referenced from the repo README with a
relative path. `.vscodeignore` excludes `docs/**`, so they never enter the vsix —
`vsce` rewrites every relative image `src` in the README to
`https://github.com/phel-lang/phel-vs-code-extension/raw/HEAD/<path>`, which is
what the Marketplace page loads. Adding an image therefore means committing and
pushing it *before* the release that should show it; a path the default branch
does not have renders as a broken image on the listing.

`src/test/packageManifest.test.ts` asserts that every image the README names
exists in the repo, so a rename or a typo fails the unit suite rather than the
listing.

## Setting up the window

Same for every shot:

| What | Value | How |
|---|---|---|
| Window size | 1280×800 | VS Code has no `--window-size` flag. Resize by hand, or on macOS `osascript -e 'tell application "System Events" to tell process "Code" to set size of front window to {1280, 800}'` (needs Accessibility permission) |
| Theme | **Dark Modern** | <kbd>Cmd/Ctrl</kbd>+<kbd>K</kbd> <kbd>Cmd/Ctrl</kbd>+<kbd>T</kbd> — it matches `galleryBanner.color` (`#1e1e1e`), so the image does not float on a differently-coloured page |
| Zoom | 1 (100%) | **View → Appearance → Reset Zoom**; anything else changes the ratio between the font and the chrome |
| Profile | a throwaway one | `npx @vscode/vsce package` then `code --profile phel-shots --install-extension phel-lang-<version>.vsix` — no other extension's status-bar item, no personal settings, and the bundle a user would get |
| Chrome | minimal | Close the panel (<kbd>Cmd/Ctrl</kbd>+<kbd>J</kbd>) and the secondary side bar; leave the activity bar |
| Font | default | Do not set a personal `editor.fontFamily`; the shot should look like a fresh install |

Take the shot of the **window**, not the screen: on macOS
`screencapture -i -w -o -x <file>.png` (`-w` allows only window selection, `-o`
drops the drop shadow, `-x` the shutter sound — then click the window); on Linux
`import -window "$(xdotool selectwindow)" <file>.png`; on Windows
<kbd>Alt</kbd>+<kbd>PrtScn</kbd>.

An overlay closes the moment the window loses focus, so a shot of the completion
popup cannot be taken by clicking. Use the delay instead: `screencapture -T 5 -x
<file>.png`, then go back to the editor and open the popup within the five
seconds. That captures the whole screen, so crop to the window afterwards.

## The three shots

Two projects are used. `test-fixtures/workspace/` is checked in and has **no**
Phel CLI, which is enough for anything the extension answers on its own.
Anything that needs a running Phel — the analysis daemon, the Test Explorer, the
nREPL — uses the throwaway project that
`scripts/make-real-cli-fixture.sh --phel /path/to/phel-lang` prints the path of.

### `completion.png` — completion and hover

Project: `test-fixtures/workspace/`.

1. Open `src/app/main.phel`.
2. Inside `welcome`, on a new line in the `let` body, type `(str pre` — the
   popup then shows the local `prefix` above the core symbols, which is the one
   thing a screenshot can say about scope-aware completion.
3. The shot wants the popup **and** its documentation pane. Press
   <kbd>Ctrl</kbd>+<kbd>Space</kbd> again if the pane is collapsed.

Alternative, for the interop story (needs the real-CLI project and a warm
daemon — open a file and wait for the first diagnostics to land first): type
`(php/-> (php/new \DateTimeImmutable) ` and let the daemon answer with the
class's methods.

### `tests.png` — Test Explorer and the CodeLenses

Project: the real-CLI fixture (the Test Explorer needs a CLI to run anything).

1. Open the Testing view (**View → Testing**, or the beaker in the activity
   bar). Both controllers have to be expanded: **Phel** with `demo.failing-test`
   run (one green, one red, the failure diff in the peek) and **Phel
   Benchmarks** showing `bench-shout` with its mean as the duration — two
   controllers rather than one is the point of the shot.
2. Open `tests/failing_test.phel` beside it, so the `▶ Run test | Debug test`
   CodeLens above a `deftest` is in the same frame.
3. Run the tests **before** the shot, not during: a run in flight draws spinners
   that date the image to one version's icon set.

### `repl.png` — nREPL inline evaluation

Project: the real-CLI fixture, with a live nREPL connection (`Phel: Connect to
nREPL Server`, which starts one when there is none).

1. Open `src/repl_target.phel`.
2. Put the cursor in `(def answer 42)` and run **Phel: nREPL Eval Form Inline**
   (<kbd>Ctrl/Cmd</kbd>+<kbd>Alt</kbd>+<kbd>Enter</kbd>) — the `=> …`
   decoration appears at the end of the line and stays until the buffer changes.
3. Add a second form, e.g. `(* answer 2)`, and run **Phel: nREPL Evaluate to
   Comment** (<kbd>Ctrl/Cmd</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd>) on it, so the
   frame shows both the transient decoration and the `;; => 84` it writes.
4. The status bar has to be visible: `$(plug)` is what says the connection is
   live, and it is half of what the shot is about.

## Turning frames into a GIF

`scripts/make-gif.sh` assembles a directory of PNG frames into an optimised GIF
(two-pass palette, which is the difference between 900 KB and 6 MB):

```bash
scripts/make-gif.sh --fps 8 --width 1280 frames/ docs/media/repl.gif
```

Capture the frames however the platform makes easiest — `ffmpeg -f avfoundation`
on macOS, `ffmpeg -f x11grab` on Linux, or a screen recorder's export — then let
the script do the palette work. It only needs `ffmpeg` on `PATH`.

A GIF is worth it only for something that moves: a REPL round trip, a paredit
slurp, a test run turning green. Everything else reads better, loads faster and
survives a theme change better as a PNG.
