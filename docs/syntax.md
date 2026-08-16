# Syntax highlighting

Coverage tracks [phel-lang](https://github.com/phel-lang/phel-lang) **v0.50.0**: the full PHP interop surface — the Clojure-style shorthands, `php/callable`, `php/ref`, named args via `:&`, the `:php/*` metadata tags, `defenum`/`defstruct` `:php` blocks — plus the 0.48–0.50 additions (`break` stepping debugger, `while`, `with-open`, `dbg`, the `phel.trace` macros `deftrace`/`dotrace`, `set!`, and `defbench` from the new `phel.bench`). Legacy forms are still recognised so older codebases keep highlighting; the reader syntax 0.50 removed is flagged by the [migration diagnostics](completion.md#migrating-to-phel-050) with a quick fix.

## Special forms

`def`, `def-`, `defonce`, `defenum*`, `defn`, `defn-`, `defmacro`, `defmacro-`, `definterface*`, `defexception*`, `defstruct*`, `reify*`, `fn`, `let`, `loop`, `recur`, `if`, `do`, `quote`, `var`, `deref`, `new`, `apply`, `concat`, `conj`, `list`, `vector`, `hash-map`, `ns`, `in-ns`, `use`, `load`, `set-var`, `try`/`catch`/`finally`, `throw`, `foreach`, `break`, `unquote`, `unquote-splicing`, plus the `php/` interop family (`php/->`, `php/::`, `php/aget`, `php/aset`, `php/apush`, `php/aunset`, `php/new`, `php/oset`, `php/ref`, and `*-in` variants).

## PHP interop

Since 0.50 the Clojure-style spelling is the only one to write; `php/->`, `php/::` and `php/new` remain the compilation target and stay highlighted, but are [deprecated as source](completion.md#migrating-to-phel-050). A class is recognised the way the analyzer recognises one — by an **upper-case first segment**:

```phel
(.format d "Y")                 ;; instance method call
(.-y point)                     ;; value member read
(DateTime/createFromFormat …)   ;; static call
(DateTime. "2024-03-10")        ;; constructor
PDO/ATTR_ERRMODE                ;; class constant
Counter/$instances              ;; static property (the sigil is required to read one)
Registry/.render                ;; instance method as a function of its receiver
Symfony.Component.Console.Command.Command/SUCCESS   ;; dotted namespaced class
\Throwable                      ;; explicit leading marker
```

| Part | Scope |
| --- | --- |
| Class name | `support.class.phel` |
| `.` / `.-` / `/` accessor | `punctuation.accessor.phel` |
| Method name | `entity.name.function.interop.phel` |
| Value member (`.-field`) | `variable.other.property.phel` |
| Static property (`C/$prop`) | `variable.other.property.static.phel` |
| ALL-CAPS member (`C/CONST`) | `constant.other.class.phel` |
| Leading `\` marker | `punctuation.definition.class.phel` |

A constant and a static method share one spelling and are told apart by reflection at analysis time, which a grammar cannot do; the split above follows PHP's own casing convention. A **bare** capitalised symbol is deliberately left as a plain symbol — a `defstruct` or `definterface` name looks identical (`phel.router/Router`), so only member access or the explicit `\` marker is treated as interop. A lower-case-first qualified name stays a namespace alias: `str/join` and `phel.string/blank?` are not interop.

## Macros (~85)

Threading: `->`, `->>`, `some->`, `some->>`, `as->`, `cond->`, `cond->>`.
Conditionals: `if-let`, `if-not`, `if-some`, `when`, `when-let`, `when-not`, `when-some`, `when-first`, `while`, `cond`, `condp`, `case`.
Iteration: `for`, `doseq`, `dofor`, `dotimes`, `doto`.
Bindings: `binding`, `letfn`, `with-bindings`, `with-redefs`, `with-output-buffer`, `with-open`.
Definitions: `defprotocol`, `defrecord`, `defmethod`, `defmulti`, `prefer-method`, `prefers`, `defspec`, `defstruct`, `defenum`, `definterface`, `defexception`, `deftype`, `declare`.
Testing: `deftest`, `is`, `are`, `testing`, `assert`, `with-mocks`, `with-mock-wrapper`, `with-isolated-stats`, `with-isolated-reporters`.
Debug / trace: `dbg`, `deftrace`, `dotrace`.
Benchmarks: `defbench` (`phel.bench`).
Interop: `set!`.
REPL helpers: `dir`, `doc`, `source`, `require`, `symbol-info`, `explain-sym`.
Other: `comment`, `time`, `lazy-seq`, `lazy-cat`, `match`, `instance?`, `pop`, `reify`, `delay`, `future`, `future-fiber`, `extend-protocol`, `extend-type`, `html`, `with-config`, `async`.

## Literals

Every numeric form the reader accepts (see phel-lang's `AtomParser`) has its own scope:

| Form | Example | Scope |
| --- | --- | --- |
| Decimal | `42`, `+7`, `-3`, `1_000` | `constant.numeric.decimal.phel` |
| Float | `3.14`, `.5`, `2e-3` | `constant.numeric.decimal.phel` |
| Hex / binary / octal | `0xff`, `0b1010`, `017` | `constant.numeric.{hex,binary,octal}.phel` |
| Radix (2-36) | `2r1010`, `16rFF`, `36rZZ` | `constant.numeric.radix.phel` |
| BigInt | `123N` | `constant.numeric.bigint.phel` |
| BigDecimal | `1.5M`, `-2.5e3M` | `constant.numeric.bigdecimal.phel` |
| Ratio | `3/4`, `-1/2` | `constant.numeric.ratio.phel` |
| Symbolic | `##Inf`, `##-Inf`, `##NaN` | `constant.language.symbolic-number.phel` |

Octal is the leading-zero spelling `017`; `0o17` is not valid Phel.

The rest:

- Keywords: `:keyword`, `::auto-resolved`, `:my.ns/name`
- Booleans / nil: `true`, `false`, `nil`
- Strings: `"hello"` with `\\` escapes
- Characters: `\A`, `\1`, `\(`, `\space`, `\newline`, `\tab`, `\formfeed`, `\backspace`, `\return`, `\u00e9`, `\o101` → `constant.character.phel`. The lexer's lookahead keeps a PHP fully-qualified name (`\Throwable`, `\Foo\Bar`) out of that rule; it scopes as a class instead — see [PHP interop](#php-interop).
- Regex literals: `#"^\d+$"` → `string.regexp.phel` (distinct from the `#regex "…"` tagged literal)
- Collections: `[1 2]`, `{:a 1}`, `#{1 2}`, `'(a b)`, PHP arrays `@[1 2]` / `@{:a 1}`
- Gensyms: a trailing `#` belongs to the symbol (`x#`), so `` `(let [x# ~x] …) `` highlights as code rather than opening a comment
- Prime-suffixed names: an apostrophe belongs to the symbol in any position but the first (`a'`, `foo''`), while a leading `'` stays the quote reader macro (`'sym`)

## Anonymous functions

```phel
#(+ %1 %2)        ;; preferred - Clojure-style
#(* % %)          ;; % is shorthand for %1
#(apply str %&)   ;; %& captures rest

|(+ $1 $2)        ;; removed in Phel 0.50 - still highlighted, flagged with a quick fix
```

## Comments

```phel
;; preferred line comment
; also a line comment
# legacy line comment - removed in Phel 0.50, still highlighted, flagged with a quick fix

#| legacy block comment |#
;; (removed in Phel 0.50, still highlighted, flagged with a quick fix)

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
{:a 1, :b 2}       ;; a comma is whitespace, never unquote
```

`,` and `,@` lost their unquote meaning before 1.0 and are not coming back. A comma now scopes as `punctuation.separator.comma.phel`, deliberately not as a reader macro: `` `(foo ,x) `` still parses and *quotes* `x` rather than unquoting it, so highlighting it like `~` would advertise a meaning it no longer has. Write `~` and `~@`.

Type and metadata tags (`^int`, `^"?int"`, `^:memoize`, `^:async`, any `^:keyword` or `^Type`) highlight their tag as `storage.type.tagged.phel` and the `^` as `punctuation.definition.tag.phel`.

## Tagged literals

```phel
#inst "2026-01-01T00:00:00Z"
#regex "\\d+"
#php/Foo\Bar
#my.app/Person {:name "Ada"}  ;; EDN-style namespaced tag
#money "10.00 EUR"            ;; custom tag via register-tag
```

`#` highlights as `punctuation.definition.tag.phel`; the tag name as `storage.type.tagged.phel`. Dotted and namespaced tag names (`#my.app/Person`) are one tag, and paredit treats the tag plus its value as a single form.

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

`npm test` runs the same engine over pinned assertions in `src/test/grammar.test.ts`, so a dropped or broken literal rule fails CI rather than needing a manual read of the tokenizer output.
