# Code completion & snippets

## Completion

The extension ships a static `CompletionItemProvider` for the `phel` language. It suggests every public symbol from `phel.core`:

- **49 special forms** - `def`, `defonce`, `defenum*`, `fn`, `let`, `loop`, `recur`, `try` / `catch` / `finally`, `ns`, `quote`, `var`, `deref`, all `php/*` interop forms (incl. `php/ref`), etc. (kind: `Keyword`)
- **~76 macros** - `defn`, `defmacro`, `defprotocol`, `defrecord`, `defenum`, `cond`, `when-some`, `with-redefs`, `prefer-method`, `match`, threading variants, etc. (kind: `Keyword`)
- **409 functions** - `assoc`, `map`, `reduce`, `swap!`, `re-find`, `parse-uuid`, `hydrate`, `bean`, `iterator-seq`, the full numeric tower (`+`, `-`, `*`, `**`, `/`, `%`, `<`, `<=`, `=`, `==`, `>`, `>=`, `quot`, `rem`, `mod`, `floor`, `ceil`, `round`, `sqrt`, …), and the rest of `phel.core`. (kind: `Function`)

The provider respects the word range so `defn|` completes correctly without duplicating the prefix.

### Why not a language server?

A real LSP (hover docs, go-to-def, namespace-aware suggestions) is the long-term answer and is on the roadmap. The static list covers ~80% of the daily friction with zero runtime cost - works offline, no extra processes, no warmup latency.

### Why isn't symbol X suggested?

The list is scoped to **`phel.core`** only - symbols from `phel.test`, `phel.match`, `phel.repl`, `phel.html`, `phel.mock`, etc. are not in the function list because they are typically used qualified (`test/is`, `match/match`) after a `(:require ... :as ...)`. Macros from those namespaces *are* in the macro list because they are commonly `:refer`'d unqualified.

Tagged literals (`#inst`, `#regex`) and PHP class names are not in completion - they are handled by syntax highlighting instead.

### Refreshing after a phel-lang bump

The macro and function lists are projections of the symbol corpus in `assets/phel-core-docs.json`. Regenerate it from a phel-lang checkout:

```bash
npm run regen-docs -- /path/to/phel-lang --phel-version v0.45.1
```

`MACROS` and `CORE_FNS` in `src/phelCoreSymbols.ts` follow automatically. `SPECIAL_FORMS` is hand-curated in the same file (the compiler-engine forms live in PHP, not in any `.phel` source) - add new entries there by hand. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full procedure.

## Snippets

`snippets/phel.code-snippets` ships templates for the everyday forms. Type the prefix, accept the suggestion, and tab through the placeholders.

| Prefix | Expands to |
|---|---|
| `ns` | `(ns my-app.core (:require ...))` |
| `defn`, `defn-` | Public / private function with docstring + args |
| `def`, `defonce`, `fn`, `let` | Top-level binding, once-only binding, anonymous fn, local bindings |
| `if`, `when`, `cond`, `case` | Conditionals |
| `doseq`, `for`, `loop` | Iteration (with `recur` skeleton) |
| `try` | `try` + `catch \Throwable e` |
| `defmacro`, `defstruct`, `defenum`, `definterface`, `defprotocol`, `defexception` | Definitions |
| `deftest` | Test case with `(is ...)` |
| `->`, `->>` | Threading skeletons |
| `comment` | Form-aware comment block |

Add or refine entries when a form is fiddly enough that scaffolding helps. Keep the `prefix` matching the form name so it composes with completion.
