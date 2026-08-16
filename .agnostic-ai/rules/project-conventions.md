---
name: project-conventions
description: Build, test, commit, and architecture conventions for the Phel VS Code extension.
globs: "**/*"
alwaysApply: true
---

This repo is the **Phel Lang VS Code extension** (TypeScript). It provides syntax
highlighting, completion, hover, signature help, diagnostics, an Xdebug debug
adapter, and REPL/paredit helpers for `.phel` files.

## Build & test

- `npm run compile` — `tsc -p ./` → `out/` (what tests run against).
- `npm run lint` — eslint over `src`. `npm test` — mocha over `out/test/**/*.test.js`.
- `npm run pretest` runs compile + lint; always green before committing.
- `npm run bundle` / `bundle:prod` — esbuild → `dist/` (shipped bundle).
- `npm run tokenize` — tokenize `scripts/sample.phel` against the tmLanguage grammar with the same engine VS Code ships. Run after any `syntaxes/` edit.
- `npm run sweep` — run every pure analyzer over a real Phel corpus (defaults to `../phel-lang/src/phel`); exits non-zero if one throws. Read the printed counts too — an implausible number is the signal.
- Never hand-edit `out/` or `dist/`; they are generated.

## Symbol corpus

- Completion / hover / signature help read `assets/phel-core-docs.json`, generated from a phel-lang checkout. Do not edit it by hand.
- Regenerate with `npm run regen-docs -- /path/to/phel-lang --phel-version vX.Y.Z` (see the `regen-phel-corpus` skill for the full per-version flow).
- `MACROS`, `CORE_FNS` and `CORE_VALUES` in `src/phelCoreSymbols.ts` derive from the corpus automatically; `SPECIAL_FORMS` is hand-curated (engine forms live in PHP, not in any `.phel` file) — add new special forms there by hand and mirror them in the `corelib` list of `syntaxes/phel.tmLanguage.json`.
- `CORE_DEF_FORMS` in the same file is hand-curated too: `phel.core` bootstraps `first`, `next`, `with-meta`, … with a bare `(def …)`, and nothing in the source says such a `def` holds a function rather than a constant. `{:macro true}` and `{:private true}` / `^:private` need no table — the parser reads them. `src/test/phelCoreSymbols.test.ts` fails when a regen adds one the table does not classify.

## Commits & changelog

- Conventional Commits. Use `ref:` (not `refactor:`). Never mention Claude/Anthropic; no `Co-Authored-By` trailers.
- Sign every commit: git identity `chemaclass@outlook.es`, GPG key `E51B5BF45F85D160`.
- Every change needs a bullet under `## [Unreleased]` in `CHANGELOG.md`. `npm run check:changelog` (CI gate) fails when that section has no bullets.

## Layout

- `src/*.ts` — providers (completion, hover, diagnostics, signature help, definition, references, rename, format, …) plus the debug adapter and source-map machinery. Tests live in `src/test/`.
- `syntaxes/phel.tmLanguage.json` — TextMate grammar. `snippets/phel.code-snippets` — snippets.
- `scripts/` — `regen-core-docs.cjs`, `tokenize-sample.mjs`, `check-changelog.cjs`, `release.sh`.
- `docs/` — user docs; keep `syntax.md` and `completion.md` in sync when grammar or the symbol surface changes.
