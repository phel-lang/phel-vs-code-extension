# Phel Lang for VS Code

Syntax highlighting, code completion, snippets, and a native debug adapter for [Phel](https://phel-lang.org/) — a functional Lisp that compiles to PHP.

## Install

- **Marketplace** — Extensions sidebar → search **"Phel Lang"** → Install. Or `code --install-extension phel-lang.phel-lang`.
- **Pre-built `.vsix`** — grab the latest from the [releases page](https://github.com/phel-lang/phel-vs-code-extension/releases) and run `code --install-extension phel-lang-*.vsix` (or *Install from VSIX...* in the Extensions menu).
- **From source** — `git clone`, `npm install`, `npx @vscode/vsce package`, then install the resulting `.vsix`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full dev loop.

Requires VS Code **1.75+**.

## What you get

- **Syntax highlighting** for the full Phel core — special forms, ~70 macros, threading, interop (`php/...`), reader macros (`'`, `` ` ``, `~`, `~@`, `^`, `@`), tagged literals (`#inst`, `#regex`, `#php`, custom `#tag`), and reader conditionals (`#?(...)`, `#?@(...)`).
- **Code completion** for every public symbol in `phel\core` — 47 special forms, ~70 macros, 394 functions (`assoc`, `map`, `reduce`, `swap!`, `re-find`, `parse-uuid`, …).
- **Snippets** for the everyday forms — type `defn`, `let`, `cond`, `try`, `deftest`, `->` and tab through.
- **Debug adapter** with source-level breakpoints, Phel-friendly variable display, multi-expression line handling, exception breakpoints, and Docker / remote path mapping.
- Auto-closing pairs, smart Lisp indentation, and breakpoint gutters in `.phel` files.

Legacy syntax is still highlighted: `|(+ $1 $2)`, `,@xs`, `#` line comments, and `#| ... |#` block comments.

## Syntax at a glance

```phel
(ns my-app\core
  (:require phel\core :refer [filter map])
  (:require phel\test :refer [deftest is]))

(def ^:private answer 42)              ;; metadata + def

(defn greet [name]                     ;; public fn
  (str "Hello, " name "!"))

(defn- helper [x]                      ;; private fn
  (when (pos? x) (* x x)))

(->> [1 2 3 4 5]                       ;; threading + anon-fn
     (filter #(> % 2))
     (map #(* %1 %1)))

`(let [x# ~val] ~@body)                ;; quasiquote, unquote, splicing

(def t  #inst "2026-01-01T00:00:00Z")  ;; tagged literals
(def re #regex "\\d+")
(def now #?(:phel (php/time) :clj 0))  ;; reader conditional

;; preferred line comment
(println 1 #_ skip 3)                  ;; skip middle form
```

## Debugging Phel code

The bundled debug adapter (`type: "phel"`) translates between `.phel` source and the compiled PHP, so breakpoints, stack traces, and stepping all stay in your Phel files.

### Setup

1. Enable Xdebug in `php.ini`:
   ```ini
   [xdebug]
   zend_extension=xdebug
   xdebug.mode=debug
   xdebug.start_with_request=yes
   xdebug.client_port=9003
   ```
2. Add a launch config (`.vscode/launch.json`):
   ```json
   {
     "version": "0.2.0",
     "configurations": [
       {
         "type": "phel",
         "request": "launch",
         "name": "Debug Phel",
         "phpDebugPort": 9003
       }
     ]
   }
   ```
3. Set breakpoints in `.phel` files, press <kbd>F5</kbd>, run your app (e.g. `vendor/bin/phel run src/main.phel`).

### Configuration options

| Option | Default | Description |
|---|---|---|
| `phpDebugPort` | `9003` | Xdebug listen port |
| `cacheDir` | auto-detected | Phel cache directory |
| `pathMappings` | `{}` | Container / remote path mappings |
| `skipPhelInternals` | `true` | Skip stepping through Phel runtime |
| `skipFiles` | `[]` | Glob patterns to skip when stepping |

For Docker / remote work, add `pathMappings`:

```json
"pathMappings": { "/var/www/html": "${workspaceFolder}" }
```

### Commands

- **Phel: Show Compiled PHP Location** — jump from a `.phel` line to the compiled PHP.
- **Phel: Clear Source Map Cache** — drop cached source maps after a recompile.

## Inspecting values with taps

For ad-hoc tracing without a debugger, use the Clojure-style tap registry from `phel\core`:

```phel
(add-tap println)

(defn process [order]
  (tap> {:event :start :id (:id order)})
  (let [result (do-work order)]
    (tap> {:event :end :id (:id order) :result result})
    result))

(remove-tap println)
```

Taps run synchronously on the calling thread. Exceptions thrown by a tap handler are swallowed so a buggy tap can't take down the producer.

## Settings

| Setting | Default | Description |
|---|---|---|
| `phel.cacheDirectory` | `""` | Path to Phel cache directory. Empty → system temp dir. |
| `phel.debug.enabled` | `true` | Enable the Phel debug adapter. |

## Contributing

Bug reports, pull requests, and language-surface refreshes welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Changelog · License

History in [CHANGELOG.md](CHANGELOG.md). MIT — see [LICENSE](LICENSE).
