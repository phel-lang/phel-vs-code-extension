# Syntax highlighting

Coverage tracks [phel-lang](https://github.com/phel-lang/phel-lang) `main` (v0.41.0 plus the unreleased interop work: `defenum`, `php/ref`, ...). Legacy forms are still recognised so older codebases keep highlighting.

## Special forms

`def`, `def-`, `defonce`, `defenum*`, `defn`, `defn-`, `defmacro`, `defmacro-`, `definterface*`, `defexception*`, `defstruct*`, `reify*`, `fn`, `let`, `loop`, `recur`, `if`, `do`, `quote`, `var`, `deref`, `new`, `apply`, `concat`, `conj`, `list`, `vector`, `hash-map`, `ns`, `in-ns`, `use`, `load`, `set-var`, `try`/`catch`/`finally`, `throw`, `foreach`, `unquote`, `unquote-splicing`, plus the `php/` interop family (`php/->`, `php/::`, `php/aget`, `php/aset`, `php/apush`, `php/aunset`, `php/new`, `php/oset`, `php/ref`, and `*-in` variants).

## Macros (~70)

Threading: `->`, `->>`, `some->`, `some->>`, `as->`, `cond->`, `cond->>`.
Conditionals: `if-let`, `if-not`, `if-some`, `when`, `when-let`, `when-not`, `when-some`, `when-first`, `cond`, `condp`, `case`.
Iteration: `for`, `doseq`, `dofor`, `dotimes`, `doto`.
Bindings: `binding`, `letfn`, `with-bindings`, `with-redefs`, `with-output-buffer`.
Definitions: `defprotocol`, `defrecord`, `defmethod`, `defmulti`, `prefer-method`, `prefers`, `defspec`, `defstruct`, `defenum`, `definterface`, `defexception`, `deftype`, `declare`.
Testing: `deftest`, `is`, `are`, `testing`, `assert`, `with-mocks`, `with-mock-wrapper`.
REPL helpers: `dir`, `doc`, `source`, `require`, `symbol-info`, `explain-sym`.
Other: `comment`, `time`, `lazy-seq`, `lazy-cat`, `match`, `instance?`, `pop`, `reify`, `delay`, `future`, `future-fiber`, `extend-protocol`, `extend-type`, `html`, `with-config`, `async`.

## Literals

- Keywords: `:keyword`, `::auto-resolved`
- Numbers: `42`, `3.14`, `2e-3`, `0xff`, `0b1010`, `1_000`
- Booleans / nil: `true`, `false`, `nil`
- Strings: `"hello"` with `\\` escapes
- Collections: `[1 2]`, `{:a 1}`, `#{1 2}`, `'(a b)`

## Anonymous functions

```phel
#(+ %1 %2)        ;; preferred - Clojure-style
#(* % %)          ;; % is shorthand for %1
#(apply str %&)   ;; %& captures rest

|(+ $1 $2)        ;; legacy - deprecated upstream, still highlighted
```

## Comments

```phel
;; preferred line comment
; also a line comment
# legacy line comment - deprecated, still highlighted

#| legacy block comment |#
;; (deprecated, still highlighted)

(println 1 #_ skipped 3)   ;; #_ comments out the next form
```

## Reader macros

```phel
'symbol            ;; quote
#'symbol           ;; var-quote
`(1 ~x ~@xs)       ;; quasiquote, unquote, unquote-splicing
^:private          ;; metadata
^int  ^"?int"      ;; type tags
^:memoize ^:async  ;; metadata flags
@my-atom           ;; deref
,form  ,@xs        ;; legacy unquote / splicing - still highlighted
```

Type and metadata tags (`^int`, `^"?int"`, `^:memoize`, `^:async`, any `^:keyword` or `^Type`) highlight their tag as `storage.type.tagged.phel` and the `^` as `punctuation.definition.tag.phel`.

## Tagged literals

```phel
#inst "2026-01-01T00:00:00Z"
#regex "\\d+"
#php/Foo\Bar
#money "10.00 EUR"            ;; custom tag via register-tag
```

`#` highlights as `punctuation.definition.tag.phel`; the tag name as `storage.type.tagged.phel`.

## Reader conditionals

```phel
#?(:phel (php/time) :clj 0)
[1 2 #?@(:phel [3 4] :clj [99])]
```

`#?` / `#?@` scope as `keyword.other.reader-conditional.phel` and the body wraps as `meta.reader-conditional.phel`, so themes can dim the inactive branch with a rule like:

```jsonc
"editor.tokenColorCustomizations": {
    "textMateRules": [
        { "scope": "meta.reader-conditional.phel", "settings": { "foreground": "#888" } }
    ]
}
```

## Verifying highlighting changes

The grammar is verified end-to-end with the same engine VS Code ships:

```bash
npm run tokenize
```

That tokenises `scripts/sample.phel` against `syntaxes/phel.tmLanguage.json` via `vscode-textmate` + `vscode-oniguruma` and prints every token with its scope. Edit the sample to add new edge cases.
