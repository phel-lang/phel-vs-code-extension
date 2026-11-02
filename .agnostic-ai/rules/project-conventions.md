---
name: project-conventions
description: Build, test, commit and architecture conventions for the Phel VS Code extension.
globs: "**/*"
alwaysApply: true
---

TypeScript VS Code extension for `.phel` files: syntax highlighting, completion, hover, signature help, diagnostics, Xdebug debug adapter, REPL and paredit helpers.

## Build and test

- `npm run compile`: `tsc -p ./` into `out/`, which the tests run against.
- `npm run lint`: eslint over `src`. `npm test`: mocha over `out/test/**/*.test.js`.
- `npm run pretest` runs compile and lint; keep it green before committing.
- `npm run bundle` / `bundle:prod`: esbuild into `dist/` (the shipped bundle).
- `npm run tokenize`: tokenize `scripts/sample.phel` against the tmLanguage grammar with the engine VS Code ships. Run after any `syntaxes/` edit.
- `npm run sweep`: run every pure analyzer over a real Phel corpus (default `../phel-lang/src/phel`); exits non-zero if one throws. Read the printed counts too: an implausible number is the signal.
- Never hand-edit `out/` or `dist/`.

## Symbol corpus

- Completion, hover and signature help read `assets/phel-core-docs.json`, generated from a phel-lang checkout. Never hand-edit it.
- Regenerate: `npm run regen-docs -- /path/to/phel-lang --phel-version vX.Y.Z` (per-version flow in the `regen-phel-corpus` skill).
- In `src/phelCoreSymbols.ts`, `MACROS`, `CORE_FNS` and `CORE_VALUES` derive from the corpus. `SPECIAL_FORMS` is hand-curated (engine forms live in PHP, not in a `.phel` file): add new ones there and in the `corelib` list of `syntaxes/phel.tmLanguage.json`.
- `CORE_DEF_FORMS` is hand-curated too: `phel.core` bootstraps `first`, `next`, `with-meta` and others with a bare `(def ...)`, and nothing in the source says whether it holds a function or a constant. `{:macro true}` and `{:private true}` / `^:private` need no entry; the parser reads them. `src/test/phelCoreSymbols.test.ts` fails when a regen adds a `def` the table does not classify.

## Commits and changelog

- Conventional Commits; `ref:` instead of `refactor:`. No AI mention, no `Co-Authored-By` trailer.
- Sign every commit: identity `chemaclass@outlook.es`, GPG key `E51B5BF45F85D160`.
- Every change needs a bullet under `## [Unreleased]` in `CHANGELOG.md`. `npm run check:changelog` (CI gate) fails on an empty section.

## Layout

- `src/*.ts`: providers (completion, hover, diagnostics, signature help, definition, references, rename, format), the debug adapter and source-map code. Tests in `src/test/`.
- `syntaxes/phel.tmLanguage.json`: TextMate grammar. `snippets/phel.code-snippets`: snippets.
- `scripts/`: `regen-core-docs.cjs`, `tokenize-sample.mjs`, `check-changelog.cjs`, `release.sh`.
- `docs/`: user docs. Keep `syntax.md` and `completion.md` in sync when the grammar or symbol surface changes.
