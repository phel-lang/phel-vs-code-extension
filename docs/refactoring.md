# Refactoring

## Go to Definition (`F12`)

Place the cursor on a symbol and press <kbd>F12</kbd>. The extension first checks the workspace index for a `defn` / `defmacro` / `def`, then falls back to the bundled core docs.

## Find All References (`shift+F12`)

Lists every standalone occurrence of the symbol across every indexed `.phel` file plus the active buffer. Strings, character literals, line comments, and block comments are skipped, so you don't get false positives in docstrings.

## Rename Symbol (`F2`)

Rewrites every occurrence of the symbol in the workspace via a single `WorkspaceEdit`. The new name is validated as a legal Phel symbol token before any edit is applied.

Same skipping rules as Find References - you can rename `foo` without touching the literal `"foo"` inside a string.

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
