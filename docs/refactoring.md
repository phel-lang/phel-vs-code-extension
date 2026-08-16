# Refactoring

## Go to Definition (`F12`)

Place the cursor on a symbol and press <kbd>F12</kbd>. A local binding resolves to its own binding site; otherwise the extension checks the workspace index for a `defn` / `defmacro` / `def`, then falls back to the bundled core docs.

With an analysis daemon running (see [below](#what-the-analysis-daemon-adds)) two more things work:

- **A namespace in `(:require …)`** jumps to the `(ns …)` form of the file that declares it. Nothing answers this without the daemon — a namespace is not a symbol in the workspace index.
- **A name is resolved within its namespace** rather than by name alone, so two definitions called `render` in different namespaces are told apart, and the jump lands on the name itself rather than on the `(` that opens the form.

## Find All References (`shift+F12`)

Lists every standalone occurrence of the symbol across every indexed `.phel` file plus the active buffer. Strings, character literals, line comments, and block comments are skipped, so you don't get false positives in docstrings.

The daemon's own reference sites are merged in on top of that. They are worth having because a scan for a token cannot see a namespace-qualified use — `s/includes?` is one token, and searching for `includes?` never matches inside it — while the daemon indexed it under exactly that spelling. A file with unsaved changes is the one place the daemon is ignored: it read the file off disk, so the buffer wins for its own hits.

## What the analysis daemon adds

Both features above use the same long-lived `phel api-daemon` that serves [live diagnostics](settings.md#live-diagnostics), so `phel.diagnostics.live` (default on) is the switch for all of it. There is one process per workspace folder, and it holds an index of the project built from the `src-dirs` and `test-dirs` of the [effective config](settings.md#what-the-project-config-decides) — `src` and `tests` when no CLI could say.

That index is rebuilt two seconds after each save, and never on a keystroke: walking a project costs a pass through PHP, so navigation asks a daemon that is already running and already has an index, and falls back to the workspace index whenever there is none.

**Staleness.** Between a save and the rebuild, and after the daemon has been restarted (which it is whenever a save invalidates what it had loaded), the daemon's index is behind or absent. Both cases degrade to the built-in workspace index rather than to a wrong answer, and the next save puts it back. **Phel: Restart Analysis Daemon** (`phel.diagnostics.restartDaemon`) drops the process if it ever looks stuck; the **Phel Analysis** output channel logs what it does.

**Without a Phel CLI**, or with one older than the `api-daemon` command, or with `phel.diagnostics.live` off, everything here keeps working exactly as it did before the daemon existed.

## Rename Symbol (`F2`)

Rewrites every occurrence of the symbol in the workspace via a single `WorkspaceEdit`. The new name is validated as a legal Phel symbol token before any edit is applied.

Same skipping rules as Find References - you can rename `foo` without touching the literal `"foo"` inside a string.

## Locals vs globals

Go to Definition, Find References, Rename, document-highlight, hover, and signature help are **scope-aware**: when the symbol under the cursor is a local, they resolve to its binding site and stay inside its own scope, so a same-named global or a binding shadowed elsewhere is never touched.

This matters more than it sounds: most short parameter names are also `phel.core` functions — `name`, `map`, `key`, `count`, `str`, `first`, `type`, `next`, `get`, `list`, `keys`, `vals`, `set`, `max`, `min`, `val`, `rest`, `last`, `apply`, `print`. Hovering the `name` in `(defn greet [name] …)` reports the parameter and its binding form, not `phel.core/name`. Signature help likewise stays silent for a local in callee position rather than describing an unrelated core function.

These forms introduce locals:

| Form | Binds |
| --- | --- |
| `fn`, `defn`, `defn-`, `defmacro`, `defmacro-` | parameters, plus a named `fn`'s self-name |
| `let`, `loop`, `binding`, `with-open` | every `name init` pair, sequentially |
| `if-let`, `when-let`, `if-some`, `when-some`, `when-first`, `dotimes` | the single binding pair |
| `for`, `doseq`, `dofor` | every `binding :verb expr` clause, each `:let` pair, and the `:reduce` accumulator |
| `foreach` | every element of the head except the trailing collection |
| `letfn` | each function name (visible across all specs and the body — they are mutually recursive) and each spec's own parameters |
| `as->` | the threading name |
| `catch` | the exception var |
| `defrecord`, `deftype`, `extend-type`, `extend-protocol`, `reify` | the parameters of each `(method [params] body…)` implementation in the tail |
| `defmethod` | the parameters after the dispatch value |

Vector, `:keys` / `:syms` / `:strs`, and `:as` destructuring is followed in every one of them.

Anything else is treated as a global, deliberately:

- `with-redefs` rebinds *existing* vars rather than declaring locals, so renaming one there stays a workspace-wide rename.
- A `defprotocol` / `definterface` method form is a **signature**, not an implementation. Its parameter names bind nothing — treating them as locals would report every one as unused.
- The field vector of `defrecord` / `deftype` holds struct keys, reached with `get` or destructuring, so the fields are not locals in the method bodies.

A form whose binding shape is not recognised yields no locals at all and falls back to the workspace-wide behaviour, so the analyzer never makes a rename narrower than it should be.

## Document Outline & Breadcrumbs

Every top-level defining form shows up in the editor outline (`cmd+shift+O`) with its first arity signature as the detail, and each gets an icon matching what it defines:

| Form | Icon |
|---|---|
| `defn`, `defn-`, `defmulti` | Function |
| `defmacro`, `defmacro-` | Method |
| `def`, `def-` | Variable |
| `defonce` | Constant |
| `defstruct`, `defrecord`, `deftype` | Struct |
| `defprotocol`, `definterface` | Interface |
| `defenum` | Enum |
| `defexception` | Class |
| `deftest` | Event |

The struct-like forms carry their field vector as a signature, because that vector *is* the positional constructor — `(defrecord Circle [r] …)` shows as `(Circle r)`.

`declare` is not listed: it forward-declares names that a real defining form supplies later in the same file, so indexing it would show every such symbol twice.

The same set drives "Go to Symbol in Workspace", cross-file completion, and go-to-definition — so a record or protocol defined in one file is now reachable from another.

## Go to Symbol in Workspace (`cmd+T`)

Type to filter the union of every `defn`/`defmacro`/`def` from every workspace file. Results show the namespace as the container so you can disambiguate between same-named symbols in different namespaces.

## Auto-import on completion

When you accept a completion for a workspace symbol whose namespace isn't already required by the current file, the extension also inserts (or extends) a matching `:require` entry in the file's `(ns ...)` form:

- No `:require` clause yet → adds `(:require [target.ns :refer [name]])`.
- `:require` exists, target ns missing → appends `[target.ns :refer [name]]`.
- Target ns required without `:refer` → adds `:refer [name]` to the entry.
- Target ns required with `:refer` → extends the existing vector.

`phel.core` and same-namespace symbols are skipped (no edit needed).
