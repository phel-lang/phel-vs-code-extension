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
- **Always** add an entry under the `## [Unreleased]` heading in `CHANGELOG.md`. Keep entries one line each. The release script promotes `## [Unreleased]` to `## [X.Y.Z] - DATE` and reinstates a fresh `## [Unreleased]` block, so the section is never empty between releases.
- Make sure compile, lint, and tests pass.

## Releasing

Cut a release entirely from GitHub Actions: no local install, no manual marketplace upload.

### One-click release (recommended)

1. Make sure CHANGELOG `## [Unreleased]` is up to date on `main`.
2. Open <https://github.com/phel-lang/phel-vs-code-extension/actions/workflows/release.yml> and click **Run workflow**.
3. Fill in:
   - `version`: leave empty to auto-bump from the current `package.json`, or pin an explicit semver like `0.6.0`.
   - `bump`: when `version` is empty, picks the auto-bump level (`patch` / `minor` / `major`). Default `minor`.
   - `publish_marketplace`: check to publish via `vsce publish` (requires `VSCE_PAT` secret). Uncheck to skip the Marketplace step and upload the vsix yourself via the [publisher web UI](https://marketplace.visualstudio.com/manage/publishers/Phel-Lang). The vsix is attached to the GitHub Release and uploaded as a workflow artifact either way.
   - `dry_run`: check to bump + package only, with no git push, GH release, or Marketplace publish. Use it once before a real cut to confirm the pipeline.
4. The workflow:
   - bumps `package.json` + `package-lock.json`,
   - rewrites `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and re-creates an empty `Unreleased`,
   - runs the gate (compile, lint, test, tokenize, bundle),
   - packages the vsix,
   - commits / tags / pushes,
   - creates the GitHub Release with the vsix attached and the CHANGELOG section as the body,
   - publishes to the VS Code Marketplace via `vsce publish`.

### Local release

Same flow, run from a clean `main` checkout:

```bash
npm run release            # auto-bump minor, build vsix, push tag, create GH Release
npm run release -- 0.6.0   # explicit version
npm run release -- --bump patch
npm run release -- --bump major
```

Default behaviour: bump the minor version of the current `package.json`, build the vsix, push the tag, create the GitHub Release with the vsix attached. Marketplace publish is **off** by default - download the vsix from the GH Release and drop it into <https://marketplace.visualstudio.com/manage/publishers/Phel-Lang>.

Flags:

- `--publish` - also run `vsce publish` (requires `vsce login Phel-Lang` cached or `VSCE_PAT` env var set).
- `--bump <patch|minor|major>` - choose the auto-bump level (default `minor`).
- `--no-push` - dry run: bumps versions and builds the `.vsix` locally, no push / tag / GH release.

If the script fails partway through, fix the cause and re-run; each step checks for existing artefacts.

### Marketplace setup (one-time)

The extension's `publisher` field is `Phel-Lang`. To publish you need a Personal Access Token (PAT) tied to that account.

1. Go to <https://dev.azure.com>, sign in with the same account that owns the [`Phel-Lang` publisher](https://marketplace.visualstudio.com/manage/publishers/Phel-Lang).
2. **User settings → Personal Access Tokens → New Token**:
   - Organization: **All accessible organizations**
   - Expiration: pick what you're comfortable with (max 1 year)
   - Scopes → **Custom defined** → check **Marketplace > Manage**
3. Copy the token (shown once).
4. **For the GitHub workflow**: add it as a repo secret named `VSCE_PAT` (Settings → Secrets and variables → Actions → New repository secret).
5. **For local publishing**: cache it on your machine:
   ```bash
   npx @vscode/vsce login Phel-Lang
   # paste the PAT when prompted
   ```

Rotation: regenerate in Azure DevOps, update the `VSCE_PAT` secret (and `vsce login` again locally if you use the local flow).

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

### Analyzers, against real Phel (`npm run sweep`)

The unit tests cover the shapes we thought of. To check the analyzers — paredit, scope, folding, references, ns, docs — against the shapes people actually write:

```bash
npm run sweep                          # defaults to ../phel-lang/src/phel
npm run sweep -- /path/to/other/src    # or any directory of .phel files
```

It runs each analyzer over every file, probes the offset-driven entry points across each one, and exits non-zero if anything throws.

**Read the counts, not just the exit code.** A number that looks wrong is worth chasing: the macro-template and sequential-rebinding bugs behind the unused-local hints were found this way, when phel's own stdlib came back reporting 98 unused bindings in code written by the language's authors. It now reports 15, and those are genuine.

### Completion + docs database (`src/phelCoreDocs.ts`)

`src/phelCoreDocs.ts` lazy-loads `assets/phel-core-docs.json`, a generated array of `PhelDoc` records (one per `defn` / `defmacro` / `def` form) extracted from a phel-lang checkout. It is the single source of truth for completion, hover, signature help, and the `Phel: Show Doc` command.

To regenerate after bumping phel-lang:

```bash
npm run regen-docs -- /path/to/phel-lang --phel-version v0.49.0
```

The script walks `src/phel/**/*.phel`, detects each file's namespace from its `(ns ...)` or `(in-ns ...)` form, runs the parser in `src/phelDocs.ts`, and writes the JSON corpus. `--phel-version` (default `main`) is the git ref used to build `View source` links.

`src/phelCoreSymbols.ts` exposes flat name arrays projected from this database (`MACROS`, `CORE_FNS`) plus a hand-curated `SPECIAL_FORMS` for the engine special forms (which live in PHP, not in any `.phel` file).

### Snippets (`snippets/phel.code-snippets`)

Snippets cover the common shapes a Phel programmer types from muscle memory (`defn`, `let`, `cond`, `try`/`catch`, …). Add or refine entries when a form is fiddly enough that scaffolding helps. Keep the `prefix` matching the form name so it composes naturally with completion.

## Reporting issues

Please file issues at <https://github.com/phel-lang/phel-vs-code-extension/issues>. Include:

- VS Code version and OS
- Extension version
- A short `.phel` snippet that reproduces the problem
- What you expected vs. what happened (screenshots help for highlighting/completion bugs)
