# Contributing

Thanks for considering a contribution. This document captures the small set of conventions used in this repo.

## Getting started

```bash
git clone git@github.com:phel-lang/phel-vs-code-extension.git
cd phel-vs-code-extension
npm install
```

Useful scripts:

| Command | Purpose |
|---------|---------|
| `npm run compile` | TypeScript build (output in `out/`) |
| `npm run watch` | Incremental build during development |
| `npm run lint` / `npm run lint:fix` | ESLint |
| `npm run format` / `npm run format:check` | Prettier |
| `npm test` | Mocha test suite |

`npm run compile && npm run lint && npm test` is the gate every PR has to pass.

## Running the extension locally

Open the repo in VS Code and press <kbd>F5</kbd>. That starts an Extension Development Host with this extension loaded and source-mapped — set breakpoints in `src/*.ts`, then exercise the extension by opening a `.phel` file in the Host window.

## Branches

The default branch is `main`. Topic branches use a `<type>/<short-slug>` shape, e.g.

- `feat/hover-provider`
- `fix/source-map-cache-race`
- `chore/bump-typescript`
- `docs/contributing`

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/). Common prefixes in this repo:

- `feat(<area>): …` — new user-visible behaviour
- `fix(<area>): …` — bug fix
- `chore(deps): …` — dependency / tooling changes
- `docs(<area>): …` — README, CHANGELOG, comments

Keep the subject under ~70 characters; put the *why* in the body when it isn't obvious from the diff.

## Pull requests

- One concern per PR. Stack PRs if a feature naturally splits.
- Link the source of truth when adding language features (e.g. point at the `phel-lang` file or commit that introduced the form).
- Update `CHANGELOG.md` under an `## [Unreleased]` heading (or bump the version in a separate PR if the change ships immediately).
- Make sure compile, lint, and tests pass.

## Releasing

1. Decide the new version (`MAJOR.MINOR.PATCH`).
2. Bump it in `package.json` and run `npm install` so `package-lock.json` follows.
3. Move the `Unreleased` block in `CHANGELOG.md` under the new version and date.
4. Open a `chore(release): x.y.z` PR.
5. After merge, tag `vX.Y.Z` on `main` and (if publishing) run `vsce package` / `vsce publish`.

## Updating the language surface

The completion and grammar features are driven by snapshots of the phel-lang core. When `phel-lang` adds or renames symbols:

### Grammar (`syntaxes/phel.tmLanguage.json`)

The `corelib` pattern in `syntaxes/phel.tmLanguage.json` is a single regex alternation of every special form and macro that should be highlighted as `keyword.control.phel`. **The order matters** — alternation is left-to-right, so longer names must come first (`defmacro-` before `defmacro`, `cond->>` before `cond->` before `cond`, `if-some` before `if`). When you edit the list, sort it longest-first.

To verify highlighting changes without launching VS Code, run:

```bash
npm run tokenize
```

That uses the same `vscode-textmate` + `vscode-oniguruma` engine VS Code ships with to tokenise `scripts/sample.phel` and prints each token with its scope. Add new edge cases to `scripts/sample.phel` when fixing or extending grammar patterns.

### Completion (`src/phelCoreSymbols.ts`)

Three readonly arrays — `SPECIAL_FORMS`, `MACROS`, `CORE_FNS` — back the completion provider. To regenerate them from a phel-lang checkout:

```bash
scripts/regen-core-symbols.sh /path/to/phel-lang > /tmp/phel-symbols.txt
```

The script prints the three arrays to stdout. Review the output, then paste the relevant arrays into `src/phelCoreSymbols.ts`. The script does not write the file in place on purpose — manual review keeps surprises (private helpers leaking into completion) out of the published surface.

### Snippets (`snippets/phel.code-snippets`)

Snippets cover the common shapes a Phel programmer types from muscle memory (`defn`, `let`, `cond`, `try`/`catch`, …). Add or refine entries when a form is fiddly enough that scaffolding helps. Keep the `prefix` matching the form name so it composes naturally with completion.

## Reporting issues

Please file issues at <https://github.com/phel-lang/phel-vs-code-extension/issues>. Include:

- VS Code version and OS
- Extension version
- A short `.phel` snippet that reproduces the problem
- What you expected vs. what happened (screenshots help for highlighting/completion bugs)
