# Code completion & snippets

## Completion

The extension ships a static `CompletionItemProvider` for the `phel` language. It suggests every public symbol from `phel.core`:

- **51 special forms** - `def`, `defonce`, `defenum*`, `fn`, `let`, `loop`, `recur`, `break`, `try` / `catch` / `finally`, `ns`, `quote`, `var`, `deref`, all `php/*` interop forms (incl. `php/ref`), etc. (kind: `Keyword`)
- **89 macros** - `defn`, `defmacro`, `defprotocol`, `defrecord`, `defenum`, `cond`, `when-some`, `while`, `with-redefs`, `with-open`, `dbg`, `deftrace`, `prefer-method`, `match`, `set!`, `defbench`, threading variants, etc. (kind: `Keyword`)
- **442 functions** - `assoc`, `map`, `mapv`, `filterv`, `reduce`, `reduce-kv`, `trampoline`, `swap!`, `re-find`, `parse-uuid`, `hydrate`, `bean`, `iterator-seq`, `php-invoke`, the full numeric tower (`+`, `-`, `*`, `**`, `/`, `%`, `<`, `<=`, `=`, `==`, `>`, `>=`, `quot`, `rem`, `mod`, `gcd`, `lcm`, `floor`, `ceil`, `round`, `sqrt`, …), and the rest of `phel.core`. (kind: `Function`)
- **6 core values** - the dynamic vars `*ns*`, `*file*`, `*argv*`, `*program*`, `*assert*`, and the constant `NAN`. (kind: `Variable`)
- **9 PHP superglobals** - `php/$_SERVER`, `php/$_GET`, `php/$_POST`, `php/$_FILES`, `php/$_COOKIE`, `php/$_SESSION`, `php/$_REQUEST`, `php/$_ENV`, `php/$GLOBALS`. Like the special forms these exist only in PHP, so no `.phel` file declares them; hover describes each one. (kind: `Variable`)

Eleven long-deprecated `phel.core` aliases went away in Phel 0.50. Calls to them
are flagged in the editor with the replacement to write — see
[Migrating to Phel 0.50](#migrating-to-phel-050).

`phel.core` bootstraps itself, and the macro, function and value counts have to
account for that: `defn`, `defmacro`, `declare` and `meta` are macros installed as
`(def defn {:macro true} (fn …))`, and the functions core needs before `defn`
exists (`first`, `next`, `with-meta`, …) are written the same way. The corpus
records `kind` from the defining operator, so all of them arrive as plain
`def`s, indistinguishable from a constant like `NAN` or from the fifteen
internal helpers core marks `:private` in a meta-map the corpus does not carry.
`CORE_DEF_FORMS` in `src/phelCoreSymbols.ts` restores that split by hand, the
way `SPECIAL_FORMS` is hand-kept, and `src/test/phelCoreSymbols.test.ts` fails
when a corpus regen brings a bootstrap `def` the table does not classify.

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

### PHP interop

The corpus above stops where PHP begins: no `.phel` file declares `strtoupper`, `DateTimeImmutable` or `format`. Those come from the compiler instead — the same long-lived `phel api-daemon` behind [live diagnostics](settings.md#live-diagnostics), which reflects over the classes your project can actually load and answers a second completion provider registered next to the bundled one. VS Code merges the two lists, so nothing that worked before goes away.

Seven positions are recognised, and they are the ones Phel's own `PhpInteropContextResolver` recognises:

| Typing | What you get |
|---|---|
| `(php/-> receiver metho…` | Public instance methods and properties of the receiver's class |
| `(php/:: Class metho…` and `\Class/metho…` | Public static methods, constants and `$`-prefixed static properties |
| `(.metho…` / `(.-fiel…`, receiver after the cursor | The same instance members, for the dot shorthands |
| `(php/new \Fo…` and a bare `\Fo…` | Class, interface, enum and trait names |
| `php/strto…` | PHP's global functions, with their signatures |
| `php/$_SE…` | The superglobals |

The receiver's class is resolved lexically: a `(php/new \Foo …)` binding, a `^{:tag \Foo}` or `^\Foo` annotation, a `(:use Foo\Bar)` import, or the return type of the method a `(php/-> x (get-thing) (…` chain hops through.

Two things follow from where this runs. It needs `phel.diagnostics.live` on and a Phel with the `api-daemon` command; without either, completion is exactly what it was. And it runs on the keystroke path, so the daemon gets **400 ms** — a busy or still-booting one costs the suggestion for that keystroke and nothing else, and the next keystroke asks again. Turn it off per folder with `phel.completion.phpInterop`.

The daemon has no signature-help method today, so a method's rendered signature is shown as the item's detail and repeated in its documentation popup: that popup is the only place it is readable.

### Bundled providers vs. the language server

These bundled providers are the zero-config default: they work offline, with no extra process or warmup, and cover ~80% of the daily friction.

For deeper, compiler-backed intelligence (namespace-aware completion, PHP-interop hover/signature help for `php/->` / `php/::` / `php/new`, and scoped rename/references) the extension can delegate to Phel's own language server, `phel lsp`. It is **opt-in** via `phel.lsp.enabled` (off by default): when enabled and the server is healthy the LSP serves these features; otherwise the bundled providers above are used. See the language-server bullet in the README.

### Why isn't symbol X suggested?

The list is scoped to **`phel.core`** only - symbols from `phel.test`, `phel.match`, `phel.repl`, `phel.html`, `phel.mock`, etc. are not in the function list because they are typically used qualified (`test/is`, `match/match`) after a `(:require ... :as ...)`. Macros from those namespaces *are* in the macro list because they are commonly `:refer`'d unqualified.

Tagged literals (`#inst`, `#regex`) and PHP class names are not in completion - they are handled by syntax highlighting instead.

### Refreshing after a phel-lang bump

The macro and function lists are projections of the symbol corpus in `assets/phel-core-docs.json`. Regenerate it from a phel-lang checkout:

```bash
npm run regen-docs -- /path/to/phel-lang --phel-version v0.50.0
```

`MACROS`, `CORE_FNS` and `CORE_VALUES` in `src/phelCoreSymbols.ts` follow automatically. `SPECIAL_FORMS` and `CORE_DEF_FORMS` are hand-curated in the same file (the compiler-engine forms live in PHP, not in any `.phel` source; the bootstrap `def`s are the ones described above) - add new entries there by hand. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full procedure.

## Parameter inlay hints

The same corpus that backs signature help can name the arguments *in place*, so
a call reads without moving the cursor into it:

```phel
(assoc ds: m key: :name value: "Phel")
(-> m (assoc key: :name value: "Phel"))
```

Opt-in — set `phel.inlayHints.parameterNames` to `true`. A wrong label is worse
than none, so every rule errs towards showing nothing:

- **Functions only.** A macro or special form does not bind its arguments
  positionally (`(let [x 1] …)`, `(if a b c)`), so its parameter names would
  describe a shape rather than a value.
- **No quoted data.** Inside `'(…)` or `` `(…) `` a list is data, not a call.
  An unquoted `~(…)` is code again and is labelled.
- **No shadowed head.** `(let [map (fn [x] x)] (map 1))` calls the local, so
  nothing is labelled — most short parameter names are also core functions.
- **Nothing past `& rest`.** The same label on every remaining argument says
  nothing the name did not.
- **No echo.** An argument already spelled like its parameter (`(assoc ds …)`)
  keeps its label to itself.
- **Threading follows the value.** Inside `->`, `some->`, `doto` and `cond->`
  the first parameter is the threaded one, so the written arguments start one
  index later. A `->>` / `some->>` / `cond->>` form is skipped whole: the value
  lands last, where a variadic tail makes the mapping guesswork.

Only the visible range is analysed, over the parse tree every other analyzer
shares, and the hint's tooltip is the arity it was read off — which is also how
you can tell *which* arity a multi-arity call matched.

## Snippets

`snippets/phel.code-snippets` ships 66 templates covering the everyday forms. Type the prefix, accept the suggestion, and tab through the placeholders.

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
| `defbench` | Benchmark with a `:revs` option map (`phel.bench`, Phel 0.50) |
| `.method`, `.-field`, `new`, `set!`, `php-invoke` | Clojure-style PHP interop: instance call, value member, constructor, assignment, dynamic method name |

Add or refine entries when a form is fiddly enough that scaffolding helps. Keep the `prefix` matching the form name so it composes with completion — `src/test/snippets.test.ts` fails the build when a prefix matches no form in the corpus, when two snippets share a prefix, or when a body's brackets do not balance.

## Migrating to Phel 0.50

Phel 0.50 removed eleven long-deprecated `phel.core` aliases and five pieces of
reader syntax, and deprecated four forms as *source* plus the `\` namespace
separator. The extension flags all of it as you type, so the change surfaces
before a compile — and in one case where the compiler never would.

**Removed** — these no longer resolve. The compiler reports an unresolvable
symbol, which cannot tell you what the name used to mean; the editor can, and
offers the rename as a quick fix:

| Removed | Write instead |
|---|---|
| `push` | `conj` |
| `put` | `assoc` |
| `unset` | `dissoc` |
| `put-in` | `assoc-in` |
| `unset-in` | `dissoc-in` |
| `values` | `vals` |
| `function?` | `fn?` |
| `hash-map?` | `map?` |
| `id` | `identical?` |
| `set-meta!` | `with-meta` |
| `str-contains?` | `phel.string/contains?` (needs a `:require`) |
| `phel.test/print-summary` | react to the `:summary` event |

**Deprecated as source** — still legal for every `1.x`, and still what the
Clojure-style spelling compiles to, so these are hints by default. They appear
struck through in completion and sort last:

| Deprecated | Write instead |
|---|---|
| `php/new` | `(new Foo arg)` or `(Foo. arg)` |
| `php/->` | `(.method obj arg)`, `(.-field obj)` |
| `php/::` | `(Foo/method arg)`, `Foo/CONST` |
| `set-var` | `(alter-var-root #'v f)`, or `(set! v x)` for the current binding frame |

Only the head of a list is considered, and a name the file defines itself or a
local binding shadows is left alone — `(defn f [values] (values))` is silent.
`php/new` and the eleven removals are plain head swaps, so they carry a quick
fix; `php/->`, `php/::` and `set-var` rearrange the call or depend on intent, so
they explain rather than rewrite.

**Removed reader syntax** — the grammar still highlights these so an old file
stays readable, but on 0.50 they no longer lex, and one of them fails silently:

| Removed | Write instead | Quick fix |
|---|---|---|
| `#\| … \|#` block comment | `;;` lines, or `#_` to skip one form | rewrites as `;;` lines when nothing follows the closer on its line |
| `# comment` (bare `#`) | `; comment` | `#` → `;` |
| `\|(+ $1 $2)` short function | `#(+ %1 %2)` | `\|(` → `#(` and every `$`, `$1`, `$&` → `%`, `%1`, `%&` (strings untouched) |
| `` `(let [v$ ,x] …) `` gensym `v$` | `v#` | `$` → `#` |
| `` `(f ,x ,@xs) `` unquote `,` | `` `(f ~x ~@xs) `` | `,` → `~` |
| `^:reference` parameter | `^:by-ref` | rename |

The comma is the one worth reading twice: `,` became plain whitespace, so
`` `(f ,x) `` still parses and quietly *quotes* `x` instead of unquoting it. No
error anywhere, only a wrong expansion. The extension flags a `,` immediately
followed by a form inside a syntax-quote; a `,` followed by a space, as in
`{:a 1, :b 2}`, is idiomatic and never reported. Likewise a trailing `$` is only
a gensym inside a syntax-quote — `$` stays the `:post` return value and an
ordinary character in a name everywhere else.

**Backslash namespace separator** — `\` still parses and is scheduled for
removal at the next major, which is why Phel announces it whether or not
`warn-deprecations` is on, and why it is a warning here for the same reason. It
comes with a quick fix that writes the
dotted form: `(ns my-app\core (:require phel\string))` → `my-app.core`,
`phel.string`; `\Phel\Lang\Keyword` → `Phel.Lang.Keyword` (the leading marker
retires with the separator); and a fully-qualified call site such as
`(phel\string/join "," xs)`, which the compiler does not detect. A lower-case
PHP namespace (`\phpDocumentor\Reflection\DocBlock`) cannot be spelled dotted
in place — that reads as a Phel namespace — so it is reported without a fix and
told to import the class with `(:use …)`. A root class (`\DateTime`) and char
literals (`\newline`, `\\`) are left alone.

**Your own `:deprecated` definitions** — a `def`/`defn` whose meta-map carries
`:deprecated` (a version string, a reason, or `true`) and optionally
`:superseded-by` gets the same treatment the compiler gives it under
`--warn-deprecations`: every call site in the workspace is a struck-through
hint (`` `old-parse` is deprecated (since 1.4.0). Use `parse-config` instead. ``),
the symbol is struck through in completion, and hover leads with the note. No
quick fix, since `:superseded-by` names a replacement without promising the
same arguments.

**Severity follows your project.** A deprecation is a hint until the project
turns `warn-deprecations` on in `phel-config.php`, at which point it becomes the
warning `phel build` already prints; removals, and the `\` separator Phel
announces without the flag, are warnings either way. The flag is read from the
Phel CLI, so a project without one keeps the hints. See
[what the project config decides](settings.md#what-the-project-config-decides).

Turn the whole check off with `phel.migration.enabled` when targeting a Phel
older than 0.50.
