# Refactoring

## Go to Definition (`F12`)

Place the cursor on a symbol and press <kbd>F12</kbd>. The extension first checks the workspace index for a `defn` / `defmacro` / `def`, then falls back to the bundled core docs.

## Find All References (`shift+F12`)

Lists every standalone occurrence of the symbol across every indexed `.phel` file plus the active buffer. Strings, character literals, line comments, and block comments are skipped, so you don't get false positives in docstrings.

## Rename Symbol (`F2`)

Rewrites every occurrence of the symbol in the workspace via a single `WorkspaceEdit`. The new name is validated as a legal Phel symbol token before any edit is applied.

Same skipping rules as Find References - you can rename `foo` without touching the literal `"foo"` inside a string.

## Locals vs globals

Go to Definition, Find References, Rename, and document-highlight are **scope-aware**: when the symbol under the cursor is a local, they resolve to its binding site and stay inside its own scope, so a same-named global or a binding shadowed elsewhere is never touched.

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

Vector, `:keys` / `:syms` / `:strs`, and `:as` destructuring is followed in every one of them.

Anything else is treated as a global, deliberately: `with-redefs` rebinds *existing* vars rather than declaring locals, so renaming one there stays a workspace-wide rename. A form whose binding shape is not recognised yields no locals at all and falls back to the workspace-wide behaviour, so the analyzer never makes a rename narrower than it should be.

## Document Outline & Breadcrumbs

Every public form (`defn`, `defmacro`, `def`) shows up in the editor outline (`cmd+shift+O`) with its first arity signature as the detail.

## Go to Symbol in Workspace (`cmd+T`)

Type to filter the union of every `defn`/`defmacro`/`def` from every workspace file. Results show the namespace as the container so you can disambiguate between same-named symbols in different namespaces.

## Auto-import on completion

When you accept a completion for a workspace symbol whose namespace isn't already required by the current file, the extension also inserts (or extends) a matching `:require` entry in the file's `(ns ...)` form:

- No `:require` clause yet → adds `(:require [target.ns :refer [name]])`.
- `:require` exists, target ns missing → appends `[target.ns :refer [name]]`.
- Target ns required without `:refer` → adds `:refer [name]` to the entry.
- Target ns required with `:refer` → extends the existing vector.

`phel.core` and same-namespace symbols are skipped (no edit needed).
