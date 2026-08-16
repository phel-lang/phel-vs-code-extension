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

## Namespace hygiene

### Unused requires

A `(:require …)` entry nothing in the file uses is faded, the way an unused local is, with a **Remove unused require '…'** quick fix (<kbd>Ctrl</kbd>+<kbd>.</kbd>) on it. Applying it drops the entry, and takes the whole `(:require …)` clause with it when that was the last one.

An entry is unused when neither the alias it binds nor any of its `:refer` names occurs outside the `(ns …)` form. The alias is whatever `:as` says, or - exactly as the compiler decides it - the last segment of the namespace, so `(:require phel.json)` is used by `(json/encode x)` and by nothing else.

Two things are deliberate:

- **A single dead `:refer` gets its own hint.** `phel lint` reports the entry or nothing, because a lint rule can only point at a form; the quick fix here can edit text, so `[app.core :refer [greet shout]]` where only `greet` is called offers **Remove unused refer 'shout'** and leaves the entry alone. Dropping the last name in a vector drops the empty `:refer` with it.
- **A use inside a syntax-quoted macro template counts.** The template is not the code that runs, but its expansion is, and that expansion does reach the namespace. Erring towards "used" costs a require that stays; erring the other way offers to break the build.

This is the same rule as `phel lint`'s `phel/unused-require`, computed in the editor so it arrives while you type. Once a save has run the CLI, its warning replaces the hint on the same entry - the CLI saw the whole project, and it is what CI runs. The quick fix works on either.

### Sort requires

**Source Action → Sort requires** orders the `(:require …)` entries by namespace. Only the entries move: the whitespace between them stays where you put it, so a clause with one entry per line keeps one entry per line. It is idempotent, which makes it safe to run on save:

```jsonc
"[phel]": {
  "editor.codeActionsOnSave": { "source.organizeImports": "explicit" }
}
```

### Go to Test / Source File

`phel.ns.goToTest` opens the other half of the namespace you are in, following [Phel's own test convention](https://github.com/phel-lang/phel-lang/blob/main/src/php/Run/Domain/Init/ProjectTemplateGenerator.php): `demo.strings` in `src/strings.phel` pairs with `demo.strings-test` in `tests/strings_test.phel`, and a `-` in a namespace segment is a `_` in the file name. The directories come from the project's `src-dirs` and `test-dirs`, defaulting to `src` and `tests`.

When the test file does not exist yet, the command offers to create it with a `(ns …)` header and one `deftest` to replace. The other direction never scaffolds: a test says what it wants to call, not what the file under it should hold.

### `(ns …)` in a new file

Create an empty `.phel` file and it gets its `(ns …)` form, derived from the files around it. That indirection is necessary: `phel config` does not print the project's main namespace, so `src/strings.phel` could be `demo.strings` or `app.strings` and only the neighbours know which. A sibling declaring `demo.strings` in `src/strings.phel` says "drop `src`, prepend `demo`", and the nearest sibling in the tree wins. With no sibling to learn from, the path is used as-is with a leading `src` / `tests` removed.

Only a genuinely empty buffer is touched, and `phel.ns.autoInsert` turns it off.
