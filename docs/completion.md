# Code completion & snippets

## Completion

The extension ships a static `CompletionItemProvider` for the `phel` language. It suggests every public symbol from `phel.core`:

- **51 special forms** - `def`, `defonce`, `defenum*`, `fn`, `let`, `loop`, `recur`, `break`, `try` / `catch` / `finally`, `ns`, `quote`, `var`, `deref`, all `php/*` interop forms (incl. `php/ref`), etc. (kind: `Keyword`)
- **81 macros** - `defn`, `defmacro`, `defprotocol`, `defrecord`, `defenum`, `cond`, `when-some`, `while`, `with-redefs`, `with-open`, `dbg`, `deftrace`, `prefer-method`, `match`, threading variants, etc. (kind: `Keyword`)
- **444 functions** - `assoc`, `map`, `mapv`, `filterv`, `reduce`, `reduce-kv`, `trampoline`, `swap!`, `re-find`, `parse-uuid`, `hydrate`, `bean`, `iterator-seq`, the full numeric tower (`+`, `-`, `*`, `**`, `/`, `%`, `<`, `<=`, `=`, `==`, `>`, `>=`, `quot`, `rem`, `mod`, `gcd`, `lcm`, `floor`, `ceil`, `round`, `sqrt`, …), and the rest of `phel.core`. (kind: `Function`)

The provider respects the word range so `defn|` completes correctly without duplicating the prefix.

### Context-aware candidate lists

Two positions get their own, much smaller list instead of the flat core one:

**`alias/…`** — after `(:require [phel.string :as str])`, typing `str/` offers every public symbol of `phel.string`, labelled `str/blank?`, with its docstring. Both `:require` shapes are understood, and both namespace separators:

```phel
(:require [phel.string :as str])   ;; vector entry
(:require phel.string :as str)     ;; flat entry
(:require phel\string :as str)     ;; backslash separator, normalised to phel.string
```

**Inside `(ns …)`** — core symbols are noise there, so the provider offers:

| Position | Candidates |
|---|---|
| Directly inside `(ns …)` | `:require`, `:use`, `:require-file` |
| Inside `(:require …)` | Every namespace in the corpus or workspace, minus this file's own and the ones already required |
| Inside `(:use …)` | `:as` only — `:use` imports a **PHP class**, which the extension cannot enumerate, and the compiler rejects `:refer` there |
| Inside `(:require-file …)` | Nothing — it takes a path string |
| Inside a `[some.ns …]` entry | `:as`, `:refer` |
| Inside that entry's `:refer [ … ]` | Every public name of the namespace being required |

### Bundled providers vs. the language server

These bundled providers are the zero-config default: they work offline, with no extra process or warmup, and cover ~80% of the daily friction.

For deeper, compiler-backed intelligence (namespace-aware completion, PHP-interop hover/signature help for `php/->` / `php/::` / `php/new`, and scoped rename/references) the extension can delegate to Phel's own language server, `phel lsp`. It is **opt-in** via `phel.lsp.enabled` (off by default): when enabled and the server is healthy the LSP serves these features; otherwise the bundled providers above are used. See the language-server bullet in the README.

### Why isn't symbol X suggested?

The list is scoped to **`phel.core`** only - symbols from `phel.test`, `phel.match`, `phel.repl`, `phel.html`, `phel.mock`, etc. are not in the function list because they are typically used qualified (`test/is`, `match/match`) after a `(:require ... :as ...)`. Macros from those namespaces *are* in the macro list because they are commonly `:refer`'d unqualified.

Tagged literals (`#inst`, `#regex`) and PHP class names are not in completion - they are handled by syntax highlighting instead.

### Refreshing after a phel-lang bump

The macro and function lists are projections of the symbol corpus in `assets/phel-core-docs.json`. Regenerate it from a phel-lang checkout:

```bash
npm run regen-docs -- /path/to/phel-lang --phel-version v0.49.0
```

`MACROS` and `CORE_FNS` in `src/phelCoreSymbols.ts` follow automatically. `SPECIAL_FORMS` is hand-curated in the same file (the compiler-engine forms live in PHP, not in any `.phel` source) - add new entries there by hand. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full procedure.

## Snippets

`snippets/phel.code-snippets` ships 60 templates covering the everyday forms. Type the prefix, accept the suggestion, and tab through the placeholders.

| Prefix | Expands to |
|---|---|
| `ns` | `(ns my-app.core (:require ...))` |
| `defn`, `defn-` | Public / private function with docstring + args |
| `def`, `defonce`, `declare`, `fn`, `let` | Top-level binding, once-only binding, forward declaration, anonymous fn, local bindings |
| `if`, `if-not`, `when`, `when-not`, `cond`, `condp`, `case` | Conditionals |
| `if-let`, `when-let`, `if-some`, `when-some`, `when-first` | Bind-and-branch forms, with the binding vector already in place |
| `binding`, `letfn` | Dynamic rebinding, mutually recursive local fns |
| `doseq`, `for`, `foreach`, `dotimes`, `loop` | Iteration (`loop` with a `recur` skeleton) |
| `try` | `try` + `catch \Throwable e` |
| `defmacro`, `defstruct`, `defenum`, `definterface`, `defprotocol`, `defexception` | Definitions |
| `defrecord`, `deftype`, `reify`, `extend-type`, `extend-protocol` | Records / types / protocol implementations, with a method skeleton |
| `defmulti`, `defmethod` | Multimethod and one dispatch implementation |
| `deftest`, `testing`, `are`, `with-mocks` | Test case, labelled group, table-driven assertions, scoped mocks |
| `->`, `->>`, `as->`, `some->`, `some->>`, `cond->`, `cond->>`, `doto` | Threading skeletons |
| `match`, `lazy-seq` | Pattern match (`phel.match`), lazy sequence body |
| `comment` | Form-aware comment block |
| `while`, `with-open` | While loop, scoped resource cleanup |
| `dbg`, `deftrace` | Debug-print a value, traced fn (`phel.trace`) |

Add or refine entries when a form is fiddly enough that scaffolding helps. Keep the `prefix` matching the form name so it composes with completion — `src/test/snippets.test.ts` fails the build when a prefix matches no form in the corpus, when two snippets share a prefix, or when a body's brackets do not balance.
