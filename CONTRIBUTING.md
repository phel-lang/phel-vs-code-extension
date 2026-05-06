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

Open the repo in VS Code and press <kbd>F5</kbd>. That starts an Extension Development Host with this extension loaded and source-mapped - set breakpoints in `src/*.ts`, then exercise the extension by opening a `.phel` file in the Host window.

## Branches

The default branch is `main`. Topic branches use a `<type>/<short-slug>` shape, e.g.

- `feat/hover-provider`
- `fix/source-map-cache-race`
- `chore/bump-typescript`
- `docs/contributing`

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/). Common prefixes in this repo:

- `feat(<area>): …` - new user-visible behaviour
- `fix(<area>): …` - bug fix
- `chore(deps): …` - dependency / tooling changes
- `docs(<area>): …` - README, CHANGELOG, comments

Keep the subject under ~70 characters; put the *why* in the body when it isn't obvious from the diff.

## Pull requests

- One concern per PR. Stack PRs if a feature naturally splits.
- Link the source of truth when adding language features (e.g. point at the `phel-lang` file or commit that introduced the form).
- Update `CHANGELOG.md` under an `## [Unreleased]` heading (or bump the version in a separate PR if the change ships immediately).
- Make sure compile, lint, and tests pass.

## Releasing

The end-to-end flow is automated by `scripts/release.sh` (also exposed as `npm run release`):

```bash
# from a clean main branch:
npm run release -- 0.6.0
```

That single command:

1. Sanity-checks: on `main`, working tree clean, version not already tagged, local in sync with `origin/main`.
2. Bumps `package.json` + `package-lock.json` to the requested version.
3. Renames `## [Unreleased]` in `CHANGELOG.md` to `## [X.Y.Z] - YYYY-MM-DD` (no-op if you've already done it).
4. Runs the gate: `npm run compile`, `npm test`, `npm run tokenize`.
5. Builds `phel-lang-X.Y.Z.vsix` via `vsce package`.
6. Commits `chore(release): vX.Y.Z`, tags `vX.Y.Z`, pushes both.
7. Creates a GitHub Release with the `.vsix` attached, using the matching CHANGELOG section as the body.
8. Publishes to the VS Code Marketplace via `vsce publish`.

Useful flags:

- `--no-publish` - everything except the Marketplace upload (use when you want to drag-and-drop the `.vsix` via the publisher web UI instead).
- `--no-push` - dry run: bumps versions and builds the `.vsix` locally, but does not push, tag remotely, create a release, or publish.

If the script fails partway through, fix the cause and re-run; it's safe to re-run from the same point because each step checks for existing artefacts.

### Marketplace setup (one-time)

The extension's `publisher` field is `Phel-Lang`. To publish you need a Personal Access Token (PAT) tied to that account:

1. Go to <https://dev.azure.com>, sign in with the same account that owns the [`Phel-Lang` publisher](https://marketplace.visualstudio.com/manage/publishers/Phel-Lang).
2. **User settings → Personal Access Tokens → New Token**:
   - Organization: **All accessible organizations**
   - Expiration: pick what you're comfortable with (max 1 year)
   - Scopes → **Custom defined** → check **Marketplace > Manage**
3. Copy the token (shown once).
4. Cache it locally:
   ```bash
   npx @vscode/vsce login Phel-Lang
   # paste the PAT when prompted
   ```

Subsequent `vsce publish` calls reuse the cached credentials. To rotate, run `vsce logout Phel-Lang` and repeat.

### Marketplace assets

Listed in `package.json` and shipped inside the `.vsix`:

- `displayName`, `description`, `categories`, `keywords` - surface in search.
- `repository.url`, `bugs.url`, `homepage` - render as sidebar links.
- `icon` - 128×128 PNG (currently absent; add one before the first publish for a better listing).

## Updating the language surface

The completion and grammar features are driven by snapshots of the phel-lang core. When `phel-lang` adds or renames symbols:

### Grammar (`syntaxes/phel.tmLanguage.json`)

The `corelib` pattern in `syntaxes/phel.tmLanguage.json` is a single regex alternation of every special form and macro that should be highlighted as `keyword.control.phel`. **The order matters** - alternation is left-to-right, so longer names must come first (`defmacro-` before `defmacro`, `cond->>` before `cond->` before `cond`, `if-some` before `if`). When you edit the list, sort it longest-first.

To verify highlighting changes without launching VS Code, run:

```bash
npm run tokenize
```

That uses the same `vscode-textmate` + `vscode-oniguruma` engine VS Code ships with to tokenise `scripts/sample.phel` and prints each token with its scope. Add new edge cases to `scripts/sample.phel` when fixing or extending grammar patterns.

### Completion + docs database (`src/phelCoreDocs.ts`)

`src/phelCoreDocs.ts` is a generated array of `PhelDoc` records (one per `defn` / `defmacro` / `def` form) extracted from a phel-lang checkout. It is the single source of truth for completion, hover, signature help, and the `Phel: Show Doc` command.

To regenerate after bumping phel-lang:

```bash
npm run compile
node scripts/regen-core-docs.cjs /path/to/phel-lang --phel-version v0.35.0
```

The script walks `src/phel/**/*.phel`, detects each file's namespace from its `(ns ...)` or `(in-ns ...)` form, runs the parser in `src/phelDocs.ts`, and writes the typed module. `--phel-version` (default `main`) is the git ref used to build `View source` links.

`src/phelCoreSymbols.ts` exposes flat name arrays projected from this database (`MACROS`, `CORE_FNS`) plus a hand-curated `SPECIAL_FORMS` for the engine special forms (which live in PHP, not in any `.phel` file).

### Snippets (`snippets/phel.code-snippets`)

Snippets cover the common shapes a Phel programmer types from muscle memory (`defn`, `let`, `cond`, `try`/`catch`, …). Add or refine entries when a form is fiddly enough that scaffolding helps. Keep the `prefix` matching the form name so it composes naturally with completion.

## Reporting issues

Please file issues at <https://github.com/phel-lang/phel-vs-code-extension/issues>. Include:

- VS Code version and OS
- Extension version
- A short `.phel` snippet that reproduces the problem
- What you expected vs. what happened (screenshots help for highlighting/completion bugs)
