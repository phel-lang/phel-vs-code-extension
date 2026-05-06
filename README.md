# Phel Lang Support for VS Code

This VS Code extension provides syntax highlighting and language support for [Phel](https://phel-lang.org/), a functional programming language that compiles to PHP.

## Features

- **Syntax highlighting** for the full Phel core:
  - Special forms: `def`, `defn`, `fn`, `let`, `if`, `loop`, `recur`, `var`, `deref`, `new`, `quote`, `try`/`catch`/`finally`, all `php/*` interop forms, etc.
  - Macros: `when`, `cond`, `cond->`, `cond->>`, `condp`, `case`, `->`, `->>`, `some->`, `some->>`, `as->`, `for`, `doseq`, `dotimes`, `match`, `defprotocol`, `defrecord`, `deftype`, `deftest`, `extend-type`, `extend-protocol`, `with-redefs`, etc.
  - Literals: keywords (`:keyword`), strings, numbers, booleans, `nil`
  - Collections: vectors `[]`, maps `{}`, sets `#{}`, lists `'()`
  - Short anonymous functions: `#(+ %1 %2)` (and the deprecated `|(+ $1 $2)`)
  - Reader macros: quote `'`, quasiquote `` ` ``, unquote `~`, unquote-splicing `~@`, deref `@`, metadata `^` (legacy `,` / `,@` still highlighted)
  - Tagged literals: `#inst "..."`, `#regex "..."`, `#php/...`, custom tags via `register-tag`
  - Reader conditionals: `#?(:phel ... :clj ...)` and splicing form `#?@(...)`

- **Code completion** for every public symbol shipped with phel-lang core:
  - All special forms and macros (suggested as keywords)
  - 394 public functions from `phel\core` (`assoc`, `map`, `reduce`, `swap!`, `re-find`, `parse-uuid`, …) suggested as functions

- **Code snippets** for common scaffolding — type `defn`, `let`, `cond`, `try`, `deftest`, `->`, … and tab through the placeholders.

- **Comment support**:
  - Line comments: `;` or `;;` (legacy `#` still highlighted)
  - Inline comments: `#_` (comments out next form)
  - Block comments: `#| ... |#` (deprecated upstream — kept for legacy code)

- **Breakpoint support**: Set breakpoints on Phel files for debugging

- **Auto-closing pairs** for brackets, quotes, and comments

- **Smart indentation** for Lisp-style code

## Supported Syntax

### Keywords and Special Forms

```phel
(ns my-app\core)

(defn greet [name]
  (str "Hello, " name "!"))

(def users [{:name "Alice"} {:name "Bob"}])

(->> users
     (filter #(> (count (:name %)) 3))
     (map :name))
```

### Short Anonymous Functions

```phel
#(+ %1 %2)        ;; Two args: %1, %2
#(* % %)          ;; Single arg: % is shorthand for %1
#(apply str %&)   ;; %& captures rest args
```

The legacy `|(...)` form with `$1`, `$2`, `$&` is still recognised for older code:

```phel
|(+ $1 $2)        ;; Deprecated — prefer #(+ %1 %2)
```

### Comments

```phel
;; Standalone comment (preferred)
;  Single-semi line comment

(println 1 #_ 2 3)  ;; Prints: 1 3 (2 is commented out)

#| Multiline comment — deprecated upstream, still highlighted. |#
```

### Reader Macros

```phel
'symbol            ;; Quote
`(1 ~x ~@xs)       ;; Quasiquote with unquote and unquote-splicing
^:private          ;; Metadata
@my-atom           ;; Deref
```

### Tagged Literals and Reader Conditionals

```phel
(def t #inst "2026-01-01T00:00:00Z")    ;; Tagged literal
(def re #regex "\\d+")                  ;; Built-in regex tag
(def m #money "10.00 EUR")              ;; Custom tag (via register-tag)

(def now #?(:phel (php/time) :clj 0))           ;; Reader conditional
(def xs [1 2 #?@(:phel [3 4] :clj [99])])       ;; Splicing form
```

## Debugging Phel Code

This extension includes a **native Phel debug adapter** that provides source-level debugging for Phel code. It automatically translates between your `.phel` source files and the compiled PHP code.

### Prerequisites

1. Install and configure **Xdebug** in your PHP installation

### Setting Up Debugging

1. **Enable Xdebug** in your `php.ini`:
   ```ini
   [xdebug]
   zend_extension=xdebug
   xdebug.mode=debug
   xdebug.start_with_request=yes
   xdebug.client_port=9003
   ```

2. **Create a launch configuration** (`.vscode/launch.json`):
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

3. **Set breakpoints** in your `.phel` files (click in the gutter)

4. **Start debugging**:
   - Press F5 or select "Run > Start Debugging"
   - Run your Phel application (e.g., `vendor/bin/phel run src/main.phel`)
   - Breakpoints will hit and show your Phel source code

### Debug Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `phpDebugPort` | Xdebug port to listen on | `9003` |
| `cacheDir` | Path to Phel cache directory | Auto-detected |
| `pathMappings` | Path mappings for Docker/remote debugging | `{}` |
| `skipPhelInternals` | Skip stepping through Phel runtime code | `true` |
| `skipFiles` | Glob patterns for files to skip | `[]` |

### Docker/Remote Debugging

For containerized environments, add path mappings:

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

### Commands

- **Phel: Show Compiled PHP Location** - Shows where the current Phel line maps to in compiled PHP
- **Phel: Clear Source Map Cache** - Clears cached source maps (useful after recompiling)

### Features

- **Source-level debugging**: Breakpoints and stack traces show Phel source locations
- **Phel-friendly variables**: Collections display as `[3 items]`, keywords as `:name`, etc.
- **Multi-expression lines**: Correctly handles multiple expressions on one Phel line
- **Exception breakpoints**: Break on all or uncaught PHP exceptions

### Inspecting Values with Taps

For ad-hoc tracing without a debugger, Phel ships a Clojure-style tap registry in `phel\core`. Register a handler with `add-tap`, send values with `tap>`:

```phel
(ns my-app\core)

;; Print every tapped value (or push to a logger, atom, etc.).
(add-tap println)

(defn process [order]
  (tap> {:event :process-start :id (:id order)})
  (let [result (do-work order)]
    (tap> {:event :process-end :id (:id order) :result result})
    result))

;; Cleanup when done
(remove-tap println)
```

Taps run synchronously on the calling thread; exceptions thrown by a tap handler are swallowed so a buggy tap can't take down the producer.

## Installation

### Option 1 — VS Code Marketplace

Open the Extensions sidebar (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>), search for **"Phel Lang"**, and click **Install**. Or from the terminal:

```bash
code --install-extension phel-lang.phel-lang
```

### Option 2 — Pre-built `.vsix`

Download the latest `.vsix` from the [releases page](https://github.com/phel-lang/phel-vs-code-extension/releases) and install it:

- **CLI:** `code --install-extension phel-lang-0.5.0.vsix`
- **GUI:** Extensions sidebar → "..." menu → *Install from VSIX...*

### Option 3 — Build from source

For the very latest changes on `main` (or to develop the extension), build the `.vsix` yourself:

```bash
git clone https://github.com/phel-lang/phel-vs-code-extension.git
cd phel-vs-code-extension
npm install
npm run compile
npx @vscode/vsce package      # produces phel-lang-<version>.vsix
code --install-extension phel-lang-*.vsix
```

### Option 4 — Symlink for live development

Iterate on grammar / TypeScript without rebuilding the `.vsix` each time:

**macOS / Linux**
```bash
cd ~/.vscode/extensions
ln -s /absolute/path/to/phel-vs-code-extension phel-lang.phel-lang-0.5.0
```

**Windows** (PowerShell, Administrator)
```powershell
cd $env:USERPROFILE\.vscode\extensions
New-Item -ItemType SymbolicLink `
    -Target "C:\absolute\path\to\phel-vs-code-extension" `
    -Path "phel-lang.phel-lang-0.5.0"
```

Restart VS Code (or use *Developer: Reload Window*) and changes to `syntaxes/`, `snippets/`, and the compiled `out/` directory take effect.

> Press <kbd>F5</kbd> inside the cloned repo to launch an Extension Development Host with the extension loaded and source-mapped — the recommended setup when developing.

## Requirements

- VS Code 1.75.0 or higher

## Extension Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `phel.cacheDirectory` | Path to Phel cache directory. If empty, uses system temp directory. | `""` |
| `phel.debug.enabled` | Enable Phel debug adapter for source-level debugging | `true` |

## Known Issues

None at this time.

## Development

### Setup

```bash
git clone https://github.com/phel-lang/phel-vs-code-extension.git
cd phel-vs-code-extension
npm install
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile TypeScript to JavaScript |
| `npm run watch` | Watch for changes and recompile |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fix |
| `npm run format` | Format code with Prettier |
| `npm test` | Run tests |

### Testing

Press F5 in VS Code to launch an Extension Development Host with the extension loaded.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions, and how to refresh the language surface (grammar, completion, snippets) when phel-lang core changes. Issues and pull requests are welcome at [GitHub](https://github.com/phel-lang/phel-vs-code-extension).

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

MIT License - see [LICENSE](LICENSE) for details.
