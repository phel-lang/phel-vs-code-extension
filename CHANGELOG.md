# Change Log

## [Unreleased]

### Added

- Namespace-aware go-to-definition and cross-file references, served by the analysis daemon's project index (`indexProject` / `resolveSymbol` / `findReferences`). <kbd>F12</kbd> on a namespace in `(:require …)` now jumps to the `(ns …)` form that declares it — something no token index could answer — and on a symbol it resolves within the namespace it is written in, so two definitions of the same name are told apart. Find All References adds the sites the daemon indexed, which is how a namespace-qualified use (`s/includes?`) shows up at all; a file with unsaved changes keeps its own answer, since the daemon read it off disk. The index is rebuilt two seconds after each save, over the project's `src-dirs` and `test-dirs`, through the same one-process-per-folder daemon live diagnostics use (`phel.diagnostics.live`) — never on the keystroke path. Without a daemon, an index, or a Phel new enough to have one, both features behave exactly as before.

- Analyzer diagnostics **as you type**, 500 ms after you stop, through a long-lived `phel api-daemon` (one process per workspace folder, started on first use, `phel.diagnostics.live`, default on). Findings the on-save engine already reports are dropped rather than squiggled twice, and when the effective `phel.diagnostics.engine` is `analyze` the save reuses the warm daemon instead of spawning a CLI. A Phel without the `api-daemon` command gets nothing new and no notification. **Phel: Restart Analysis Daemon** (`phel.diagnostics.restartDaemon`) drops a daemon whose view of another file has gone stale; the **Phel Analysis** output channel logs starts, restarts and timeouts.

- Menus, so the commands are no longer Command-Palette-only: a **Phel** submenu on the editor's right-click menu (eval form / selection / nREPL inline, run tests / benchmarks / file, show docs, lint), **Run File** and **Run All Tests in File** under the editor title bar's run button, and the three run entries on a `.phel` file's Explorer context menu. The palette now hides `phel.runBenchmark` (it needs the name its CodeLens supplies) and the editor-only commands when no `.phel` file is focused.
- `Phel: Run File` (`phel.runFile`): `phel run <file>` in the **Phel Run** terminal, on the uri the menu passes or the active editor. The path is resolved against the workspace folder that owns the file, so running one from the Explorer of a multi-root workspace uses its own project root.
- A **Get started with Phel** walkthrough (**Help: Get Started**): seven steps from `composer require phel-lang/phel` through `phel.executablePath`, `Phel: Init Project`, Doctor, the Testing view, the REPL, and a debug session — each with a button that runs the command it describes and ticks itself off when you do.
- Parameter-name inlay hints at call sites, opt-in through `phel.inlayHints.parameterNames` (default off): `(assoc m :k v)` reads as `(assoc ds: m key: :k value: v)`, with the matched arity as the hint's tooltip. A wrong label is worse than none, so only functions are labelled — a macro binds its arguments by shape, not by position — and a label is dropped for quoted data, for a head a local binding shadows (`(let [map (fn [x] x)] (map 1))`), for an argument already spelled like its parameter, and for everything past a `& rest`. Threading is followed: `->`, `some->`, `doto` and `cond->` shift the written arguments one parameter along, while a `->>` / `some->>` / `cond->>` form is skipped whole, since the threaded value lands where a variadic tail makes the mapping guesswork. Only the visible range is walked, over the shared parse tree.
- The extension now reads each workspace folder's *effective* Phel configuration — `phel config --format=json`, which merges `phel-config-local.php` and applies the defaults — and lets the features follow it instead of guessing. Migration severity follows `warn-deprecations` (a deprecated call is a warning exactly when `phel build` reports it, a hint otherwise; the `\` separator stays a warning either way, since Phel announces it without the flag), the Test Explorer scans `test-dirs`, and a debug session defaults its `cacheDir` to `<cache-dir>/compiled`. One read per folder, lazy and cached — nothing on the activation path — re-read when a `phel-config.php` / `phel-config-local.php` is saved or the CLI path setting changes. No Phel installed, or one too old to print its config: every feature keeps the behaviour it had.
- A `phel` task type, so the CLI can run through VS Code's task system rather than a terminal you have to read: **Terminal → Run Task… → phel** offers `test`, `test --watch`, `lint`, `build`, `format` and `bench` per workspace folder, in the right group for <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> and **Run Test Task**, and `tasks.json` can name any `phel` subcommand with its own `args`. Two problem matchers come with it: `$phel-lint` parses `phel lint`'s human-readable output into the Problems panel (severity, rule code and all), and `$phel-test-watch` is a background matcher that follows `phel test --watch`, re-reporting the failing `deftest`s on every re-run.
- Hover evaluation over a live nREPL connection (`phel.nrepl.hoverEval`, on by default): hovering a symbol shows what it evaluates to in the running program as a `=> value` block under its docs. Symbols only — a var deref cannot have side effects, evaluating the form under the pointer could — and locals, keywords, literals, special forms and `php/…` names are skipped. It never opens a connection, gives up after 2 s (sending the nREPL `interrupt` op) and shows nothing on error.
- Debug hover now evaluates the whole Phel symbol under the pointer. VS Code's own word pattern cuts Phel names at their punctuation, so hovering `add-item` in a paused session used to ask the adapter for `item`; an evaluatable-expression provider now answers with the same token shape the rest of the extension uses.
- Benchmarks in the Testing view: a **Phel Benchmarks** tree with one item per `defbench`, run through `phel bench <file>` (narrowed with `--filter=<name>` when a single benchmark is asked for). The table `phel bench` prints is parsed back, so each item reports its mean as a duration and the whole table lands in the run output; a benchmark the runner left out is skipped, and a run that produced no table at all errors with what the CLI said. It is a controller of its own, not a second profile on the test one, so "Run All Tests" never times a benchmark.
- An opt-in integration suite that runs against a **real** Phel CLI (`src/test/integration/real/`, third host, `PHEL_REAL_CLI_WORKSPACE=<dir> npm run test:integration`). `scripts/make-real-cli-fixture.sh` builds the project it needs from a phel-lang checkout — a lint warning and a lint error, a passing and a failing `deftest`, a `defbench`, a removed and a deprecated form, a `:deprecated` definition with a caller, two namespaces where one requires the other. Twenty-three assertions observe what the CLI actually did: `phel lint` on save, live `api-daemon` diagnostics and their restart, `phel config` deciding a deprecation's severity, `phel format` on save, the daemon's project index behind go-to-definition and references, nREPL hover evaluation both on a server the extension starts and on one it attaches to, the JUnit / Clover / bench reports the runners parse, and the `$phel-lint` matcher filling the Problems panel from a task run. Skipped, with a log line, when the variable is unset — which is how CI runs it.
- An integration suite (`npm run test:integration`) that runs the extension inside a real VS Code against a small fixture project, headless in CI. It covers what importing a module cannot: activation, that every command id in `package.json` is really registered, and that completion, hover, signature help, folding, symbols, rename, semantic tokens, the unused-local and migration diagnostics, the `push` → `conj` quick fix and the test/benchmark CodeLenses all reach the editor through the shipped bundle. The fixture has no `vendor/bin/phel` on purpose, so the CLI-backed features failing silently is itself asserted.

### Changed

- The extension now loads on 118 KB of JavaScript instead of 507 KB. The language client (`vscode-languageclient` and friends, 68% of the old bundle, opt-in and off by default) and the Xdebug debug adapter ship as sibling bundles that `extension.js` loads only when `phel.lsp.enabled` is on, respectively when a debug session starts. `npm run bundle:report` prints what each bundle is made of.

- Every analyzer now reads one shared parse cache (`src/phelParseCache.ts`) instead of re-parsing the buffer per feature. Folding, ns, migration, refactor, selection, completion-context, REPL, form-highlight and scope all hit the same tree, and `Form` is immutable so sharing it is safe. Keyed by the source text, so a stale buffer can never be served.

### Fixed

- Every CLI-backed feature now works on a workspace opened through a symlink (`/var/…` on macOS, a symlinked `~/Code`, a project reached through a linked path). Phel resolves symlinks in every path it prints, so what the CLI called `/private/var/…/src/app.phel` and what the editor calls `/var/…/src/app.phel` were two different files: on-save `phel lint` / `phel analyze` diagnostics were dropped on the floor, **Phel: Lint Workspace** filled the Problems panel with files nothing could open, go to definition opened a second copy of a file already on screen, Find All References pointed at that copy, and test coverage decorated it. Every path the CLI or the analysis daemon reports is now spelled the way the folder was opened (`src/phelPaths.ts`). Problems produced by the `phel` *task* type still show under the resolved path — VS Code builds those markers itself, before the extension sees the output; `docs/troubleshooting.md` says so.
- nREPL evaluation from a file with an `(ns …)` form now works at all. The session switch was sent as `(in-ns 'app.core)`, and the reader turns `'x` into a list, which Phel's `in-ns` rejects — so **Eval Form**, **Eval Selection**, inline eval and hover evaluation all came back `AnalyzerException: First argument of 'in-ns must be a Symbol or String` against Phel 0.50. The namespace goes in as a string now.
- Find All References now searches files that define nothing of their own. The workspace index dropped a file whose parse yielded no `defn` / `def` / `deftest`, so a `defbench` file, or any script that only calls things, was invisible to the scan and its uses of a symbol were never listed.
- `phel format` now runs in the formatted document's workspace folder. It was spawned with no working directory of its own, so Phel resolved its project from wherever the extension host had been started — and wrote a `.phel/` cache into that directory on every format.
- **Run Tests with Coverage** now produces coverage on a machine with Xdebug. Xdebug only records lines when `coverage` is one of its active modes, and the mode a developer keeps in `php.ini` is `develop,debug`, so `phel test --coverage=clover` answered "--coverage requires the pcov or xdebug extension" and the run reported none. A coverage run now spawns with `XDEBUG_MODE=coverage`, unless the environment already asks for it.
- Every Phel CLI invocation now works on Windows. `vendor/bin/phel` is a PHP script Windows cannot execute, and Node refuses to spawn Composer's `vendor/bin/phel.bat` proxy without a shell, so diagnostics, formatting, the test/benchmark runs, the REPL and nREPL terminals and the language server all failed there. A single resolver (`src/phelInvocation.ts`) now does what the `.bat` does — run `php vendor/bin/phel …`, argv array intact, no quoting — and falls back to a shelled-out batch file when there is no PHP proxy. Find All References also matches open editors by URI rather than path, since the same file can be spelled with either drive-letter case. CI builds on macOS and Windows too.
- Commands in a multi-root workspace now run in the right folder. `Phel: Run Benchmarks in Current File` and the `▶ Run benchmark` lens follow the file they were invoked on — with the path passed relative to its folder, as the test runner already did — instead of whatever the active editor happened to be; watch, build, init, balance, doctor, show-config and lint-workspace use the active file's folder and ask which one to use when that is ambiguous, rather than silently taking the first folder. The language server is still one instance rooted at the first folder, which is now documented in `docs/settings.md`.

- Stopping a Phel debug session no longer leaves it hanging in the editor. The adapter answered the graceful `terminate` request but never reported the debuggee as gone, so the session stayed in the UI until Stop was pressed a second time.

- The Test Explorer no longer lists `deftest`s it found inside `vendor/` — a dependency's suite is not yours to run — and its tree now follows `.phel` files created or deleted outside the editor, where before only saving a file already open updated it.
- `npm test` no longer risks silently skipping the top-level unit tests. The glob was unquoted, and `sh` expands `**` as a single `*`, so the moment any subdirectory of `out/test/` held a `*.test.js` the shell would have resolved the pattern to that subdirectory alone.

### Docs

- `docs/commands.md`: every contributed command with its id, the exact CLI invocation or editor operation behind it, which setting resolves the executable, what it needs (Phel CLI / nREPL / nothing), and its default keybinding — including the two that only make sense from a CodeLens. A unit test keeps the id column in step with `contributes.commands`.

## [0.13.0] - 2026-08-16

### Added

- Support for Phel **v0.50.0**. The symbol corpus is regenerated from that tag: 1582 entries across 35 namespaces, with the new `phel.bench` namespace (`defbench`, `run-benchmarks`) and the new `phel.core/set!` and `phel.core/php-invoke`. `View source` links point at `v0.50.0`.
- Syntax highlighting for the Clojure-style PHP interop spellings, which 0.50 made the only ones to write: `(.method obj)`, `(.-field obj)`, `(Class/method args)`, `(Class. args)`, `Class/CONST`, `Class/$prop`, `Class/method` and `Class/.method`. A class is recognised the way the analyzer recognises one, by an upper-case first segment, so dotted namespaced classes (`Symfony.Component.Console.Command.Command/SUCCESS`) highlight as one name. A **bare** capitalised symbol is left alone on purpose — a `defstruct` name looks identical (`phel.router/Router`) — and `\Throwable` now scopes as a class rather than a plain symbol.
- Completion and hover for the nine PHP superglobals (`php/$_SERVER`, `php/$_GET`, …), mirroring what the language server offers. Like the special forms these exist only in PHP, so no corpus entry can carry them.
- Migration diagnostics for the 0.50 surface change, with quick fixes. The eleven removed `phel.core` aliases (`push` → `conj`, `values` → `vals`, `id` → `identical?`, …) are warnings carrying the replacement, which the compiler cannot tell you — it only reports an unresolvable symbol. The four forms deprecated as source (`php/new`, `php/->`, `php/::`, `set-var`) are struck-through hints, since those still compile and the compiler mentions them only under `--warn-deprecations`. Only the head of a list is considered, and a name the file defines or a local binding shadows is left alone, so `(defn f [values] (values))` stays silent. New setting `phel.migration.enabled` (default on) turns the check off when targeting an older Phel.
- The removed reader syntax is flagged too, each with a quick fix: `#| … |#` block comments (rewritten as `;;` lines when nothing follows the closer), a bare `#` line comment (→ `;`), `|( … )` short functions (→ `#( … )` with `$`/`$1`/`$&` renamed to `%`/`%1`/`%&`, strings untouched), a `foo$` gensym inside a syntax-quote (→ `foo#`), and `^:reference` (→ `^:by-ref`). The grammar keeps highlighting all of it so an old file stays readable; on 0.50 none of it lexes. The one that does not fail is the one worth flagging most: `,` became whitespace, so `` `(f ,x) `` still parses and quietly quotes `x`. A `,` immediately followed by a form inside a syntax-quote is a warning with a `~` fix; a `,` followed by a space, as in `{:a 1, :b 2}`, is idiomatic and never reported.
- The `\` namespace separator, still shipped and deprecated, is a struck-through hint with a quick fix that writes the dotted form: `(ns my-app\core (:require phel\string))`, `\Phel\Lang\Keyword` → `Phel.Lang.Keyword`, and a fully-qualified call site such as `(phel\string/join "," xs)`, which the compiler does not detect. A lower-case PHP namespace (`\phpDocumentor\Reflection\DocBlock`) cannot be spelled dotted in place, so it is told to import the class with `(:use …)` instead of being rewritten; a root class (`\DateTime`) and char literals are left alone.
- A `def`/`defn` whose meta-map carries `:deprecated` (a version, a reason, or `true`) and optionally `:superseded-by` now behaves the way the compiler treats it under `--warn-deprecations`: every call site in the workspace is a struck-through hint phrased like the compiler's message, the symbol is struck through in completion, and hover leads with the note. `phelDocs` reads both keys, so a corpus regen picks them up. No quick fix, since `:superseded-by` names a replacement without promising the same arguments.
- The nREPL commands attach to a server you already started. Since 0.50 `phel nrepl` writes its bound port to `.nrepl-port` in the working directory and removes it on exit, so the first nREPL command in a folder now reads that file, probes the port, and joins the running server — from a terminal, a `docker exec`, or another editor — instead of starting a second one. A file whose port no longer answers is reported and the extension falls back to its own `phel nrepl --port=0`. Disconnect only stops a server the extension started.
- `Phel: Run Benchmarks`, `Phel: Run Benchmarks in Current File` and `Phel: Run Benchmark` commands for `phel bench`, plus a `▶ Run benchmark` CodeLens above each `defbench` and a file-level lens beside the existing test one.
- `Phel: Check Balanced Delimiters` for `phel balance`. Reporting is the default; `--fix` rewrites source, so it is only reached by picking it explicitly.
- Snippets for `defbench`, `set!`, `new`, `php-invoke` and the `.method` / `.-field` interop shorthands.

### Changed

- A comma is highlighted as whitespace (`punctuation.separator.comma.phel`) instead of as a reader macro. `,` and `,@` lost their unquote meaning before 1.0 and are not coming back, so `` `(foo ,x) `` parses and *quotes* `x`; colouring it like `~` advertised a meaning it no longer has.
- `defbench`, `set!`, `with-isolated-stats` and `with-isolated-reporters` are highlighted as keywords.
- The deprecated interop forms sort last in completion and carry the deprecated tag, so the Clojure-style spelling is what gets picked when both match what was typed.

### Docs

- Consolidated the documentation. `CONTRIBUTING.md` moved to `docs/CONTRIBUTING.md` — GitHub reads that location too, so the "Contributing guidelines" link on issues and PRs still resolves — and the root now holds only `README.md` and `CHANGELOG.md`, which tooling pins in place.
- Removed `vsc-extension-quickstart.md`, untouched Yeoman scaffold that still described the project as "your extension" and duplicated nothing the real docs cover.
- Trimmed the README feature list from sixteen dense paragraphs to eleven scannable lines, with the detail left in `docs/`. The docs index now lists every page — `refactoring.md` and `repl-and-paredit.md` were missing from it.
- Collapsed the three near-duplicate CLI-path examples in `docs/settings.md` into one annotated block; the first two differed only in whether the path was relative.

## [0.12.0] - 2026-07-26

### Language support

- **Protocol-method parameters are locals.** `this` and friends inside a `defrecord` / `deftype` / `extend-type` / `extend-protocol` / `reify` implementation tail, and the parameters of a `defmethod`, now resolve to their own binding — previously renaming `this` in one method rewrote every `this` in the workspace. A `defprotocol` / `definterface` method form stays excluded: it is a signature with no body, so binding its names would report each one as an unused local. `defrecord` / `deftype` field vectors also stay out — those are struct keys, not locals.
- **Scope analysis covers the remaining core binding forms.** `dotimes`, `when-first`, `as->`, and `letfn` now introduce locals, so go-to-definition, find-references, rename, document-highlight, semantic tokens, unused-local hints, and in-scope completion work inside them. `letfn` is modelled properly: the function names are visible across every spec and the body (mutual recursion), while each spec's parameters stay confined to that spec.
- **`for` / `doseq` / `dofor` heads are read in full.** Only the first `binding :verb expr` clause used to bind; a second clause (`(for [x :in xs y :in ys] …)`) and the `:reduce [acc init]` accumulator were treated as globals. All clauses, `:let` pairs, and the accumulator now resolve as locals.
- A local whose scope has closed is no longer offered by completion — a `letfn` spec's parameters stop at that spec instead of leaking into the body.
- Find-references on a `letfn` name now includes a mutually recursive call that appears *before* the name's own spec; references were previously cut off at the declaration offset.
- `with-redefs` targets stay globals (they rebind existing vars), so renaming one remains a workspace-wide rename — pinned by a test.
- **Every literal the Phel reader accepts now highlights.** The grammar gained rules for character literals (`\A`, `\1`, `\(`, `\space`, `\newline`, `\u00e9`, `\o101`), regex literals (`#"^\d+$"`, distinct from the `#regex "…"` tagged literal), symbolic numbers (`##Inf`, `##-Inf`, `##NaN`), radix numbers (`2r1010`, `16rFF`, `36rZZ`), `BigInt` (`123N`), `BigDecimal` (`1.5M`), and ratios (`3/4`). Signed forms (`+7`, `-3.5`, `-1/2`) and digit separators now scope as numbers across every base. A PHP fully-qualified name (`\Throwable`) still scopes as a symbol, matching the lexer's own lookahead.
- **Gensyms no longer break a macro body.** A trailing `#` is part of the symbol (`x#`), so `` `(let [x# ~x] …) `` highlights as code; previously the `#` opened a comment that swallowed the rest of the line.
- **Namespaced tagged literals.** `#my.app/Person {:name "Ada"}` scopes the whole dotted/namespaced name as the tag, and paredit reads the tag plus its value as one form.
- **Regex literals are one form to paredit.** `#"…"` is read as a single string form rather than a `#` atom followed by a string, so slurp/barf/raise/kill, folding, and expand-selection no longer split it.
- `phel.router/compiled-router` highlights as a macro, closing the last gap between the grammar keyword list and the v0.49.0 macro corpus.

### Completion

- **`alias/…` completes.** After `(:require [phel.string :as str])`, typing `str/` now offers every public symbol of that namespace with its docs. Hover, go-to-definition and signature help already resolved alias-qualified symbols; completion offered nothing, because every candidate label is a bare name.
- **`:use` and `:require-file` no longer offer Phel namespaces.** All three clauses were treated alike, but `:use` imports a **PHP class** (`(:use Symfony.Component.Console.Application)`) and `:require-file` takes a path string. `:use` now offers only `:as`, which is the single option its registrar accepts — `:refer` there is a compile error — and `:require-file` offers nothing rather than a list that could never be right.
- **`:refer [ … ]` offers the namespace's own names.** Completing inside a refer vector suggested `:as` / `:refer` — the entry options — instead of the symbols being referred. It now lists the public names of the namespace on that entry, for both require shapes and either separator, and without mistaking an `:as` alias for the namespace.
- **The `(ns …)` form gets its own candidates** instead of all 576 core symbols: `:require` / `:use` / `:require-file` directly inside `(ns …)`, the requirable namespaces inside a `(:require …)` clause, and `:as` / `:refer` inside an entry vector.

### Symbols & navigation

- **Ten more defining forms are indexed.** The parser behind the outline, "Go to Symbol in Workspace", cross-file completion, auto-import and go-to-definition recognised only `defn` / `defn-` / `defmacro` / `defmacro-` / `def` / `def-`. It now also reads `defonce`, `defstruct`, `defrecord`, `deftype`, `defprotocol`, `definterface`, `defenum`, `defexception`, `defmulti` and `deftest` — so a file of records, protocols or tests is no longer nearly invisible (a 14-definition sample produced 2 symbols before, 12 now), and those names resolve across files.
- Struct-like forms carry their field vector as a signature, because that vector is the positional constructor: `(defrecord Circle [r] Shape (area [this] 1))` shows as `(Circle r)`, with the method tail correctly not read as a second arity.
- Outline entries now pick an icon per form — Struct for `defrecord`, Interface for `defprotocol`, Enum for `defenum`, Event for `deftest`, and so on — via a new `form` field on `PhelDoc` that records the defining operator. `PhelDocKind` keeps its three values, so the `MACROS` / `CORE_FNS` projections are unchanged.
- `declare` stays unindexed on purpose: it forward-declares names a real defining form supplies later in the same file, so indexing it would list every declared symbol twice.
- Note for the next `npm run regen-docs`: the corpus generator shares this parser, so a regen will pick up the `phel.html` / `phel.http` / `phel.router` structs and add `form` to every entry. No `phel.core` symbol changes, so `CORE_FNS` and `MACROS` are unaffected.

### Diagnostics

- **`phel lint` now backs inline diagnostics.** It reports everything `phel analyze` does plus rule-based findings — unused bindings, shadowed bindings, arity problems, and whatever `phel-lint.phel` configures. On a file with one undefined symbol and one unused binding, `analyze` reported 1 diagnostic where `lint` reports 2.
- New `phel.diagnostics.engine` setting (`auto` | `lint` | `analyze`, default `auto`). `lint` is newer than `analyze`, so `auto` uses it and falls back the first time a CLI rejects the subcommand, remembering that for the session; changing the executable or the setting retries. Nothing breaks for anyone on an older Phel.
- New **Phel: Lint Workspace** command runs `phel lint` over the configured source dirs and fills the Problems panel for every file, including ones never opened. On-save diagnostics stay scoped to the saved file.

### Snippets

- **31 new snippets, 29 → 60.** The binding-vector conditionals (`if-let`, `when-let`, `if-some`, `when-some`, `when-first`), `binding`, `letfn`, `dotimes`, `foreach`, `condp`, `if-not`, `when-not`, `declare`; the rest of the threading family (`as->`, `some->`, `some->>`, `cond->`, `cond->>`, `doto`); the protocol surface (`defrecord`, `deftype`, `reify`, `extend-type`, `extend-protocol`, `defmulti`, `defmethod`); the test forms (`testing`, `are`, `with-mocks`); plus `match` and `lazy-seq`. Every body is taken from the form's own `:example` metadata or its phel-lang definition, so the scaffolding matches the real shape.
- `src/test/snippets.test.ts` now fails the build when a snippet prefix matches no form in the symbol corpus, when two snippets share a prefix, or when a body's brackets do not balance.

### Fixed

- **Unused-local hints fired on code that was using the binding**, and rename silently corrupted it. Measured over phel's own 62-file stdlib, the extension reported **98** unused bindings; 83 of those were wrong. Two causes. First, an unquoted name inside a macro template — `` `(let [~v ~x] …) `` — was read as a *new* binding declaration, so it shadowed the outer `v` and swallowed its uses: the outer binding looked dead, and renaming it rewrote 1 of its 4 occurrences. Second, resolving a use picked the *first* binding of that name whose scope covered it, which breaks the common idiom of rebinding a name through successive `let` pairs (`[body (base) body (f body) body (g body)]`) — every use resolved to the first pair, so the rest looked unused. Uses now resolve to the most recently opened binding, and unquoted template names bind nothing. The stdlib now reports **15**, and the remainder are genuine (`(catch NoConfigurationException e nil)` really does not use `e`).

- **Every breakpoint was reported as failed, and none could be removed.** Two defects in one response, both found by setting a breakpoint against a live Xdebug 3 and reading what came back: `<response command="breakpoint_set" transaction_id="1" id="463430001">`. First, the id was matched with `/id="(\d+)"/`, which finds the `id="1"` *inside* `transaction_id="1"` — so the adapter stored the transaction id, and the removal added in the previous release aimed `breakpoint_remove` at a breakpoint that never existed. Second, success required a `resolved` or `state` attribute, and Xdebug sends neither on a perfectly good set, so every installed breakpoint was treated as a failure — leaving it unverified in the UI and making `applyAllBreakpoints` try every candidate line on a breakpoint that was already working. Success is now decided the way DBGp defines it: anything without an `<error>`.

- **Non-ASCII text in CLI output could come back corrupted.** `runPhelCli` — the shared runner behind diagnostics, lint, format, doctor, build and the test commands — accumulated `chunk.toString()` per chunk, and the nREPL client did the same for its server output. Node reads in 64 KiB chunks, so a multi-byte character straddling a boundary decoded to `\ufffd` on both sides. A large `phel lint` run crosses that boundary easily. Both now decode with `StringDecoder`, which holds an incomplete sequence back until the rest arrives. The corruption was cosmetic — JSON and XML structure is ASCII, so parsing was unaffected — but it reached diagnostic messages, test output and the REPL channel.

- **Every int, float and bool in the Variables pane was mojibake.** DBGp payloads are base64 only when the element says `encoding="base64"`, which Xdebug sets for strings and not for scalars — verified by capturing a live session. The adapter base64-decoded every payload unconditionally, and `Buffer.from(x, 'base64')` silently discards anything that is not base64, so `42` and `3.5` both rendered as `\ufffd` and `true` as an empty string. The `encoding` attribute is now honoured everywhere a payload is read — property values, stdout/stderr stream output, and engine error messages. Errors were the same bug with a different face: Xdebug sends `<error><message>` as plain text, so `no such breakpoint` reached the user base64-decoded into bytes, hiding every real reason a debug command failed.
- **Any non-ASCII value broke the debug session.** DBGp frames each message as `<length>\0<xml>\0`, where the length is a count of **bytes**. The adapter decoded every TCP chunk to a string and then indexed that byte count into it, whose `.length` is UTF-16 code units. A single `é` — in a variable value, a docstring, or a file path — misaligned the buffer: the first message came back with a trailing NUL and the **next one came back empty**, so every subsequent response was lost and its command timed out. Separately, decoding each chunk as it arrived turned a multi-byte character split across TCP packets into `�`, which no later reassembly could undo. Framing now stays in `Buffer`s and decodes only complete payloads.
- **A command in flight when the connection closed hung forever.** Every Xdebug command parks a promise until a response with its transaction id arrives. On socket close the adapter cleared the pending map *without settling* those promises, and the 30-second timeout only fires for ids still in the map — so it saw the entry gone and did nothing. The awaiting caller never resumed. Reachable in normal use, because the session deliberately survives a closing connection to serve the next request: toggling a breakpoint as a request finishes could leave `setBreakpoints` unanswered, and VS Code's breakpoint UI stuck. Pending commands are now settled on close and on disconnect.
- **Removed breakpoints kept stopping execution.** The debug adapter called Xdebug's `breakpoint_set` but never `breakpoint_remove` — the id Xdebug returns was parsed and then discarded, so nothing could be removed. DAP sends the complete breakpoint list for a source on every change, so deleting or moving a breakpoint in the editor left the old one live in the engine, and each toggle installed more, on every candidate line of a multi-expression form. The adapter now tracks the ids per source and clears them before installing the new set. The bookkeeping lives in a separate `XdebugBreakpointRegistry` so it is covered by real tests rather than the replicated-logic tests the adapter otherwise needs.
- **Breakpoints never bound at all without manual configuration.** The source-map manager searched only the system temp directory by default, a location current Phel never writes to: `PhelConfig::DEFAULT_CACHE_DIR` is `.phel/cache`, *relative to the project root*. Registering a workspace root collected it into a field that was never read, so out of the box the debugger had no valid cache directory and no breakpoint could resolve unless the user pointed `phel.cacheDirectory` at the right place themselves. A workspace root now registers `<root>/.phel/cache/compiled`, honouring a relative or absolute `PHEL_CACHE_DIR`. The debug adapter runs in its own process and builds its own manager, so it never sees a workspace root either — resolution therefore also walks up from the `.phel` file to its project root (nearest `phel-config.php` or `.phel/`) and registers that cache, which makes breakpoints bind with no launch configuration at all. The `phel.cacheDirectory` description, which claimed the temp directory was the fallback, is corrected.
- **Breakpoints never resolved outside a `src/` directory.** `findCompiledFile` derived a namespace from the file path with a heuristic that required `…/<dir>/src/<path>.phel`, and returned `null` outright when it did not match — before reaching the reliable lookup that matches on the source path each compiled file records on its second line. Phel's `withSrcDirs` accepts any directory name, so a project keeping its sources in, say, `lib/` got no debugger mapping at all. Verified by building a real `lib/`-layout project: the cache file names the exact source path, yet the lookup returned `null`. The content scan now always runs; the namespace guess stays as a fast path.

- **Hover on a local showed an unrelated core function.** Go-to-definition, find-references, rename and document-highlight all consult the scope analyzer; hover did not, and looked the name up in the symbol corpus instead. Every one of the 20 most common parameter names — `name`, `map`, `key`, `count`, `str`, `first`, `type`, `next`, `get`, `list`, `keys`, `vals`, `set`, `max`, `min`, `val`, `rest`, `last`, `apply`, `print` — is also a `phel.core` function, so hovering the `name` in `(defn greet [name] …)` documented `phel.core/name`. It now reports the parameter and the line it is bound on.
- **Signature help described the wrong function for a local callee.** `(f x)` where `f` is a let-bound function showed the signature of whatever global shared that name. It now stands down instead. `findCurrentCall` gained a `calleeStart` offset so the callee can be resolved against the scope analyzer.
- **Renaming `a` corrupted `a'`.** The apostrophe was treated as a symbol terminator on both sides, so the leading `a` of `a'` looked like a complete token: find-references reported it, and rename rewrote it, leaving a stray `'`. `a'` and `foo''` are single symbols to the Phel lexer — verified by running one — and are now matched as such. Renaming *to* `a'` is allowed; a leading `'` is still rejected, because there it is the quote reader macro.
- The grammar had the same split: `a'` highlighted as the symbol `a` followed by a quote reader macro. An apostrophe now stays inside the symbol in any position but the first, and a leading `'` is still the quote macro.
- Word selection splits the quote macro off what it quotes: the word at `'sym` and `#'sym` is now `sym`, so hover and go-to-definition resolve a quoted symbol instead of looking up `'sym` and finding nothing.
- **Flat `:require` entries resolved no alias.** `(:require phel.string :as str)` — the shape the compiler still accepts alongside the vector form — parsed as a namespace with no options, so `str/blank?` silently lost hover, go-to-definition and signature help. Several flat entries in one clause, and flat mixed with vector entries, are now read the way `NsSymbol` reads them.
- **The backslash namespace separator never matched.** `phel\string`, which Phel's own sources use, was compared verbatim against the corpus's `phel.string`, so every alias-qualified lookup through it failed. Namespaces are now normalised to the dotted form on parse, which also stops auto-import from adding a duplicate `:require` for a namespace already imported with backslashes.

### Performance

- **Semantic tokens and unused-local hints are ~14x faster**, 591 ms → 43 ms on phel's own 56 KB `test.phel`. Both run the scope analyzer on every edit, and `resolveLocalAt` re-parsed the whole document once per candidate occurrence — hundreds of full parses per keystroke. The parse is now memoised on the source string, and the per-name occurrence scan alongside it (410 bindings share 158 distinct names in that file, so each scan was repeated two to three times). Both caches are keyed on the source text, so a stale buffer cannot be served; tests cover switching sources and cold-vs-warm results.

### Docs

- `docs/debugging.md` explains why a debug session connects **twice**: Phel re-executes its own PHP process on startup for the opcache file cache, so the launcher connects first and exits, and the replacement process is the one that runs your code and hits breakpoints. "Request completed. Waiting for next connection..." mid-run is normal rather than a failure. Traced against a live Xdebug session, which also confirmed the adapter's reconnect handling is what makes breakpoints work at all — and that the in-flight-command fix earlier in this release applies to every run, since the first connection always closes with `run` outstanding.

- README feature list refreshed. It had drifted well behind the extension: it still described paredit as "slurp / barf / raise / wrap, sexp selection" (0.11 added drag / splice / kill, folding and native expand-selection), listed snippets as "`defn`, `let`, `cond`, `try`, `deftest`, `->`, …" when there are 60, and never mentioned scope-aware navigation, semantic highlighting, unused-local hints, the refactorings, or the outline coverage. Now grounded in the actual contributions in `package.json`.

### Internal

- Made the CLI stream-decoding test deterministic. It asserted that a *spawned* process's output is corrupted without a `StringDecoder`, which depends on where the runtime happens to chunk the stream — true on macOS under both Node 20 and 22, false on CI's Linux Node 20, so it failed there. The corruption is now demonstrated by splitting the buffer in the test itself; the spawn-based case remains but asserts only what must always hold, that the decoded text equals the payload.

- New `npm run sweep`: runs every pure analyzer — paredit, scope, folding, references, ns, docs — over a real Phel corpus (defaults to `../phel-lang/src/phel`), probes the offset-driven entry points across each file, and exits non-zero if anything throws. It also prints per-analyzer counts, which is the more useful half: the two unused-local bugs fixed in this release were found by noticing that phel's own stdlib came back with 98 unused bindings. Documented in `CONTRIBUTING.md` next to `npm run tokenize`.

- **De-duplicated the provider boilerplate**, net −28 lines. The Phel symbol-token regex existed as seven byte-identical copies (so the gensym change earlier in this release would have needed seven edits to stay consistent); it now lives in `phelSymbolToken.ts` with tests pinning what it matches. The `combineDocs(indexer, PHEL_DOCS)` merge and the `MarkdownString` + `isTrusted`/`supportHtml` construction each had five copies and are now `mergedDocs()` and `plainMarkdown()` in `phelProviderSupport.ts`. Behaviour is unchanged.
- Grammar coverage is pinned by `src/test/grammar.test.ts`, which tokenizes with the same `vscode-textmate` engine VS Code ships and asserts scopes, so a grammar regression fails `npm test` instead of needing a manual read of `npm run tokenize`.
- `scripts/sample.phel` used `0o17`, which is not valid Phel (octal is the leading-zero `017`); fixed and extended with the newly covered literal forms.
- `npm run pretest` now also runs `format:check`, so a Prettier violation fails locally (before commit) instead of only in CI.

## [0.11.0] - 2026-07-24

### Language support

- **Semantic highlighting for locals.** A `DocumentSemanticTokensProvider` tags every `fn` / `defn` parameter (as `parameter`) and every `let` / `loop` / `for` / `catch` / … binding (as `variable`), with each declaration site flagged, so colour themes render locals distinctly from globals and core symbols. It reuses the `phelScope` analyzer, so highlighting and go-to-definition always agree on what a local is.
- **Unused-local hints.** Bindings that are declared but never read are marked with `DiagnosticTag.Unnecessary` (VS Code renders them faded); parameters and `_`-prefixed names are exempt. Both features are part of the bundled providers and stand down when the Phel language server is active.

### Refactoring & code actions

- **Structural refactorings** on the form at the cursor (lightbulb / `Ctrl+.`): **Thread first** (`->`) and **Thread last** (`->>`), each fully unwinding the threaded-argument spine (`(map f (filter p xs))` → `(->> xs (filter p) (map f))`); **Unwind thread**, the inverse; and **Cycle collection**, rotating a collection's delimiters `(` → `[` → `{` → `(`.
- **Add missing `:require`** quick-fix: when the bare symbol under the cursor is a known core/workspace name that the file has not imported, offers to insert the matching `(:require [ns :refer [name]])` entry into the `(ns …)` form. Bundled-only; stands down under `phel lsp`.

### REPL

- **Inline evaluation results.** `Phel: nREPL Eval Form Inline` (`ctrl+alt+enter` / `cmd+alt+enter`) evaluates the top-level form under the cursor over the nREPL connection and shows the value as a dimmed `=> …` decoration at the end of the form's line — Calva-style — with errors in the error colour. The decoration clears on the next edit; the full value and any stdout/stack trace still go to the **Phel nREPL** channel.

### Structural editing

- **More paredit.** New commands joining slurp/barf/raise/wrap: **drag form forward/backward** — swap a form with its adjacent sibling (`ctrl+shift+.` / `ctrl+shift+,`); **splice** — drop the enclosing brackets, lifting children into the parent (`alt+shift+s`); **kill form** — delete the form at the cursor (`alt+shift+k`).
- **Form-aware folding & selection.** A `FoldingRangeProvider` folds every multi-line form and runs of `;` line comments (in place of indentation folding), and a `SelectionRangeProvider` makes VS Code's native expand/shrink selection (`Shift+Alt+→` / `←`) grow through the enclosing forms.

## [0.10.0] - 2026-07-24

### Language support

- **Scope-aware navigation for locals.** Go-to-definition, find-references, rename, and document-highlight now understand lexical scope: `fn` / `defn` parameters, `let` / `loop` / `binding` / `with-open` bindings, `if-let` / `when-let`, `for` / `doseq` / `dofor` loop vars, `foreach` key/value vars, `catch` exception vars, and vector / `:keys` / `:as` destructuring. A local now resolves to its binding site and renames **only within its own scope** — same-named globals and bindings shadowed in other scopes are left untouched (previously every matching token in the file was rewritten). Go-to-definition on a parameter jumps to the parameter, not to an unrelated global of the same name.
- **In-scope locals in completion.** While writing a body, completion surfaces the bindings visible at the cursor (parameters, `let` names, loop vars, …) ranked above core and workspace symbols, plus the current file's own private (`defn-`) definitions.

### Docs

- Bump corpus / extension version references in `CONTRIBUTING.md` (regen example → v0.49.0) and `docs/installation.md` (dev symlink → 0.9.0).

## [0.9.0] - 2026-07-24

### Language server

- Optional Phel language-server integration via `phel lsp` (`phel.lsp.enabled`, **default off**): when enabled and the server is healthy, delegates completion, hover, signature help, go-to-definition, references, rename, symbols, formatting, and diagnostics to the Phel-compiler-backed server, gaining PHP-interop intelligence (`php/->`, `php/::`, `php/new`) and scoped rename/references. Best-effort: it falls back to the bundled providers when off, unavailable, or unstable — some current `phel lsp` builds exit on idle, so it ships opt-in. Settings: `phel.lsp.command`, `phel.lsp.args`. The server and the bundled providers are mutually exclusive at runtime (never both, to avoid duplicate results); note the LSP path does not provide the bundled providers' auto-import-on-accept or call-site snippets.

### REPL & runtime

- Add an nREPL client (`phel nrepl`, bencode-over-TCP, auto-started on a free port): connect/disconnect, structured eval of the form/selection, load file, reload changed (`phel.nrepl.reload`) or all (`phel.nrepl.reloadAll`) namespaces, run a namespace's tests (`phel.nrepl.runTestsInNs`), and run the test under the cursor (`phel.nrepl.runTestUnderCursor`). Results show in a "Phel nREPL" channel. Settings: `phel.nrepl.enabled` (default `true`), `phel.nrepl.reloadOnSave` (default `false`).

### Test Explorer

- Report per-test results via `phel test --reporter=junit-xml`: failing tests show the assertion message and failing form (was: one pass/fail per run from the exit code).
- Add a "Run with Coverage" profile (`phel test --coverage=clover`) showing native line coverage; warns once when pcov/xdebug is missing. Requires VS Code **1.88+** (raised minimum).

### Commands

- Add **Phel: Doctor** (`phel doctor`) for project/environment health, and **Phel: Show Effective Configuration** (`phel config`).
- Add **Phel: Watch Tests** (`phel test --watch`), **Phel: Build** (`phel build`, with optimization-level / report prompts), and **Phel: Init Project** (`phel init`, with a template picker).

### Language support

- Completion, hover, and signature help for the REPL workflow fns (`reload!`, `reload-all!`, `run-test`, `run-tests`), new core helpers (`clamp-int`, `defs->map`), and `phel.json` / `phel.string` / `phel.transit` / `phel.ai` additions.
- Add `php/callable` (first-class callable interop) to the `php/*` completion list.
- Rename `argv` → `*argv*`.
- Sync the symbol corpus to phel-lang **v0.49.0** (was v0.45.1): +46 public symbols and the new `phel.trace` namespace. Completion / hover / signature help now cover the 0.46–0.49 core additions — `mapv`, `filterv`, `reduce-kv`, `reductions`, `trampoline`, `subvec`, `arity`, `variadic?`, `gcd`, `lcm`, `every-pred`, `distinct?`, `bounded-count`, `splitv-at`, `map-invert`, `random-sample`, the `clojure.set` relational helpers (`select`, `project`, `rename`, `index`), `subseq` / `rsubseq`, the readable-print family (`pr`, `prn`, `pr-str`, `prn-str`, `println-str`), the completed atom API (`compare-and-set!`, `swap-vals!`, `reset-vals!`), the bit ops (`unsigned-bit-shift-right`, `bit-and-not`), `rational?` / `infinite?`, `inspect`, and the `phel.trace` fns (`trace`, `trace-fn`, `reset-trace-state!`).
- Highlight (and complete) the new `break` special form (stepping debugger), the macros `while`, `with-open`, `dbg`, and the `phel.trace` macros `deftrace` / `dotrace`. Add `while`, `with-open`, `dbg`, and `deftrace` snippets.

### Fixed

- Terminal commands (test / watch / build / init) now launch the CLI as the terminal's process instead of a shell-quoted command line, so they work on Windows (PowerShell/cmd) and with paths containing spaces.
- nREPL eval now runs in the open file's namespace, and nREPL "load file" reports compile-error locations with the real file path instead of `NO_SOURCE_FILE`.
- The language server now restarts automatically when `phel.lsp.command`, `phel.lsp.args`, or `phel.executablePath` changes (toggling `phel.lsp.enabled` offers a reload); coverage from several test files merges into one report per source; cancelling a test run resolves every started test.
- The language client now restarts the server if its connection drops, and falls back to the bundled providers (instead of looping) if the server proves unusable, so language features keep working.
- `phel.debug.enabled` now actually gates the debug adapter (it was declared but ignored).
- Highlight the `#(... %&)` / `#(... $&)` rest-arg marker as a parameter (the `&` was previously left unscoped).

### Internal

- Deduplicate shared logic into focused modules: `xml` (attribute/entity/int parsing used by the JUnit and Clover parsers), `phelCli` (one-shot CLI spawn + output collection), `phelWorkspace` (active-folder resolution), and `phelTerminal` (terminal launch). Harden the nREPL reader against malformed frames, unref pending timers, and reap the server process on socket close; dispose output channels, run profiles, and per-folder file watchers; read test files concurrently when populating the Test Explorer.
- The language client (`vscode-languageclient`) ships alongside the existing bundled providers and symbol corpus rather than replacing them, so the packaged extension is larger than 0.8.0 (~265 KB vsix, `extension.js` ~98 KB → ~463 KB).

## [0.8.0] - 2026-06-05

### Language support

- Track phel-lang `main` (ahead of v0.41.0) for the unreleased interop work: corpus now covers `defenum`, `hydrate`, `bean`, `iterator-seq`, the reflect enum/attribute bridges (`enum->keyword`, `keyword->enum`, `enum-values`, `class-attributes`, `method-attributes`, `property-attributes`), and `html-response` / `json-response`.
- Add the `defenum` enum form: completion (`defenum*` special form), keyword highlighting, and a `defenum` snippet.
- Add `php/ref` (by-reference PHP interop) to the `php/*` special-form completion list; it already highlighted via the generic `php/` rule.

## [0.7.0] - 2026-06-05

### Language support

- Update the symbol corpus to Phel v0.41.0. Completion, hover, and signature help now cover everything added since v0.36: the numeric tower, the `phel\reflect`, `phel\edn`, and `phel\transit` namespaces, multimethod helpers, renamed runtime types, and `defonce`.
- Add `defonce` as a known special form, with keyword highlighting and a snippet.
- Highlight type/metadata tags (`^int`, `^:memoize`, …), the `#'sym` var-quote, and the `prefer-method` / `prefers` macros.

## [0.6.4] - 2026-05-08

### Diagnostics

- Fix off-by-one column shift: phel emits 0-based exclusive columns, the range converter was subtracting again and pushing every marker one column left.
- Run `phel analyze` with the workspace folder as `cwd` so `phel-config.php` and the autoloader resolve from the project root.
- Coalesce overlapping analyze runs per document; the latest save's content wins.
- Skip non-`file:` URIs (git diff views, untitled buffers).
- Drop diagnostics for documents closed mid-analysis.

## [0.6.3] - 2026-05-07

### Settings

- New `phel.executablePath` (default `vendor/bin/phel`) acts as a single workspace-wide pointer to the Phel CLI for diagnostics, format, test, and REPL. Existing per-subsystem settings (`phel.diagnostics.command`, `phel.format.command`, `phel.test.command`, `phel.repl.command`) still take precedence when set, but their defaults are now empty strings that fall back to `phel.executablePath`. Useful when the binary lives somewhere other than `vendor/bin/phel` (e.g. `bin/phel`, `/usr/local/bin/phel`).

### Docs

- README trimmed to features + install + docs index. Marketplace install link added.
- `docs/settings.md` rewritten with a Phel CLI location section, resolution order, and per-subsystem override examples.

## [0.6.2] - 2026-05-07

### Editor intelligence

- Resolve `alias/name` symbols via the file's `(:require [other.ns :as alias])` clause. Hover, go-to-definition, and signature help now light up for `r/render`-style references when `r` is aliased in the current file.

## [0.6.1] - 2026-05-07

### Build

- Move the 1300-entry symbol corpus out of the JS bundle into a sibling `dist/phel-core-docs.json` (~490 KB), lazy-loaded via a `Proxy` on first use. `dist/extension.js` shrinks from ~559 KB to ~97 KB; the bundle-size warning during `vsce package` no longer fires. Total vsix size is unchanged.

## [0.6.0] - 2026-05-07

Largest release since the initial cut. Brings the extension up to a modern
Lisp-IDE feature set: completion + hover + signature help backed by a
generated symbol DB, workspace-aware refactoring, paredit, an integrated
REPL, a Test Explorer, and inline debug values.

### Editor intelligence

- Generated symbol DB (`src/phelCoreDocs.ts`, 1317 entries across 30 namespaces; regenerate via `npm run regen-docs`).
- Hover docs with signature, docstring, example, see-also, and source link.
- Completion for every public `phel.core` symbol plus user `defn`/`defmacro`/`def` from anywhere in the workspace.
- Signature help with active-parameter highlighting.
- `Phel: Show Documentation` quick-pick command.
- Workspace indexer parses every `.phel` and powers go-to / find-refs / rename / outline / symbol search.
- **Go to Definition** (`F12`), **Find All References** (`shift+F12`), **Rename Symbol** (`F2`, validates the new name), document outline, and **Go to Symbol in Workspace** (`cmd+T`).
- **Auto-import** on completion: choosing a symbol from another namespace also patches the current file's `(ns ...)` form with `[that.ns :refer [name]]`. Skipped for `phel.core` and same-ns symbols.
- **Call-site snippets**: accepting a function in callee position inserts a `name ${1:arg1} ${2:arg2}` skeleton derived from the signature.
- **Document highlight**: cursor on a symbol underlines every occurrence in the file (skipping strings and comments).

### Structural editing

- Paredit: slurp / barf (forward + backward), raise, and wrap with `( )` / `[ ]` / `{ }`.
- Selection expand/shrink by sexp.
- Subtle background tint on the form enclosing the cursor.
- Bracket pair colorization for `.phel`; auto-close pair for `#(...)`.

### REPL

- `Phel: Start REPL` opens an integrated terminal running `phel repl`.
- Evaluate form under cursor, selection (or current line), next form, or whole file. Multi-line forms are flattened so the terminal REPL sees a single line.
- `(in-ns ...)` follow: cross-file evaluation switches the REPL into the source file's namespace automatically.
- Every sent form is appended to `.vscode/phel-repl-history.phel` (timestamped). Toggle off with `phel.repl.history.enabled`.
- `Phel: Switch REPL to Current Namespace` command.

### Diagnostics, format, tests

- Inline diagnostics on save via `phel analyze`.
- Format-on-save via `phel format`.
- CodeLens on `deftest`: `▶ Run test` / `▶ Run all tests in file`.
- **Test Explorer** integration: every `deftest` is a TestItem; running shells `phel test --filter ^name$` and reports pass/fail by exit code. Saving a file refreshes the tree.

### Debugging

- Inline values during paused debug sessions: visible symbol tokens get rendered with their live values. Unresolved names drop silently rather than rendering placeholders.

### Project & branding

- Status bar item: current `(ns ...)` while editing a `.phel` file, or a `Phel` badge when the workspace's `composer.json` requires `phel-lang/phel`. Click to start the REPL.
- Marketplace icon (256x256 PNG generated from the official `phel-lang/phel-lang` logo).
- Marketplace / Installs README badges switched from the retired shields.io endpoint to `vsmarketplacebadges.dev`.

### Build & release

- Bundle the runtime via esbuild into a single minified `dist/extension.js`. The published vsix drops from a directory tree to ~155 KB and activation is faster.
- New **Release** GitHub Actions workflow (`workflow_dispatch`): bumps version, packages the vsix, pushes the tag, creates the GitHub Release with the vsix attached. Marketplace publish is opt-in via the `publish_marketplace` toggle (requires the `VSCE_PAT` secret).
- `scripts/release.sh` defaults: GitHub Release on, Marketplace publish off. With no args, auto-bumps the minor of the current `package.json`; override with `--bump patch|minor|major` or pass an explicit semver. `--publish` opts into `vsce publish`.
- CI: PRs must keep at least one bullet under `## [Unreleased]` (`scripts/check-changelog.cjs`).
- Weekly scheduled workflow regenerates the docs DB from phel-lang `main` and opens a PR.
- GitHub Actions CI matrix on Node 20 + 22.

### Docs

- README rewritten with a feature tour (completion + auto-import, hover, REPL, paredit, refactoring, test explorer) and links to deeper pages under `docs/`.
- New pages: `docs/repl-and-paredit.md`, `docs/refactoring.md`.

### Changed

- `MACROS` / `CORE_FNS` derive from the generated `PHEL_DOCS` corpus.
- Default `lineComment` is now `;` (was `#`, deprecated upstream).

### Settings

| Setting | Default | Purpose |
|---|---|---|
| `phel.diagnostics.enabled` / `phel.diagnostics.command` | `true` / `vendor/bin/phel` | `phel analyze` integration. |
| `phel.format.enabled` / `phel.format.command` | `true` / `vendor/bin/phel` | `phel format` integration. |
| `phel.tests.codeLensEnabled` / `phel.test.command` | `true` / `vendor/bin/phel` | Run-test CodeLens + Test Explorer command. |
| `phel.paredit.enabled` | `true` | Register paredit commands. |
| `phel.repl.enabled` / `phel.repl.command` / `phel.repl.args` | `true` / `vendor/bin/phel` / `["repl"]` | REPL terminal launch. |
| `phel.repl.history.enabled` | `true` | Append every sent form to `.vscode/phel-repl-history.phel`. |
| `phel.formHighlight.enabled` | `true` | Subtle highlight on the enclosing form. |

## [0.5.1] - 2026-05-06

### Changed

- Marketplace metadata: language-first description, more keywords, `Snippets` category, `qna: false`, gallery banner, badges.
- Deps: drop unused `glob` / `@types/glob`; move `@vscode/debugprotocol` to runtime; remove duplicate `@vscode/debugadapter` from dev deps; add `@vscode/vsce`.
- Scripts: `npm run package` / `npm run publish`.
- Docs / snippets: modern `phel.core` namespaces (was `phel\core`); strip em-dashes.

## [0.5.0] - 2026-05-06

### Added

- Tagged literals (`#inst`, `#regex`, `#php`, custom `#tag`) highlight.
- Reader conditionals `#?(...)` and `#?@(...)` highlight as `meta.reader-conditional.phel`.

## [0.4.0] - 2026-05-06

Sync with phel-lang `main` (`428c59f`).

### Added

- Anonymous fn `#(...)` with `%`, `%1`, `%&`. Legacy `|(...)` still works.
- Reader macros `~`, `~@`. Legacy `,`, `,@` still work.
- Deref `@x` highlights `@` as reader-macro punctuation.
- `aset` macro + numeric/comparison fns (`+`, `-`, `*`, `**`, `/`, `%`, `<`, `<=`, `=`, `==`, `>`, `>=`) in completion.
- `npm run tokenize` for grammar verification.

### Fixed

- `#{`, `#(`, `#_`, `#|`, `#?`, `#tag` were being eaten by the line-comment pattern. Comment now requires `#` followed by whitespace.

### Changed

- README: replaced obsolete `phel.debug/enable-trace` with `add-tap` / `tap>` / `remove-tap`.
- `regen-core-symbols.sh` scoped to `phel.core` only.

## [0.3.0] - 2026-05-06

### Added

- Code completion: 382 core fns, all special forms, every public macro.
- Code snippets for common forms (`defn`, `let`, `cond`, `try`, `deftest`, `->`, ...).
- Grammar coverage for the rest of the current core (added ~40 special forms and macros, sorted longest-first).

### Changed

- `mocha` to `^11.7.5`; npm overrides for `serialize-javascript` and `diff`. `npm audit` clean.

## [0.2.0] - 2025-02-01

### Added

- Native Phel debug adapter: source maps, breakpoints, stack traces, Phel-friendly variable display.
- Commands: *Show Compiled PHP Location*, *Clear Source Map Cache*.
- Settings: `phel.cacheDirectory`, `phel.debug.enabled`.
- Docker / remote path mappings, step filter, exception breakpoints, multi-expression line handling.
- Multiline `#| ... |#` and inline `#_` comments.
- Short anonymous fn `|(...)` with `$`, `$1`, `$&`.
- Set literals `#{...}`; `;` line comments.
- Threading macros (`->`, `->>`, `some->`, `some->>`, `as->`, `doto`).
- More keywords: `throw`, `in-ns`, `set-var`, `defexception`, `comment`, `or`, `and`, `doseq`, `lazy-seq`, `lazy-cat`, `binding`, `if-let`, `when-let`, `time`, `with-output-buffer`.
- `definterface*`, `defexception*`, `defstruct*`.
- Word pattern + indentation rules.

### Changed

- Debug configs use `phel` type (was `php`).
- Column-aware source map parsing.
- VS Code engine `^1.75.0`.
- Grammar typo: `brakets` -> `brackets`.

### Fixed

- Mutable collection syntax `@{`, `@[`, `@(`.

## [0.0.1] - Initial release

- Basic syntax highlighting for Phel.
- Comments, strings, numbers, keywords.
- Core special forms and macros.
