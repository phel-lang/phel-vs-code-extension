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
| `npm test` | Mocha unit suite |
| `npm run test:integration` | Mocha suite inside a real VS Code (see below) |

`npm run compile && npm run lint && npm test` is the gate every PR has to pass.

## Running the extension locally

Open the repo in VS Code and press <kbd>F5</kbd>. That starts an Extension Development Host with this extension loaded and source-mapped - set breakpoints in `src/*.ts`, then exercise the extension by opening a `.phel` file in the Host window.

## Integration tests

The unit suite imports modules directly, so it can never show that the extension
activates, that a provider is actually registered against the `phel` language,
or that a command id in `package.json` matches the one the code registers. The
integration suite does: it downloads a real VS Code, opens the fixture
workspace, and drives the extension through the same `vscode.execute*` commands
the editor uses.

```bash
npm run test:integration            # compile, bundle, download VS Code, run
VSCODE_TEST_VERSION=1.88.0 npm run test:integration   # pin a version
VSCODE_TEST_USER_DATA_DIR=/tmp/vscode-phel npm run test:integration   # short profile path
```

The last one is for a checkout nested deeply enough that the host's IPC socket
path, which sits under the profile directory, exceeds the ~103-character unix
socket limit - a git worktree usually does. VS Code then refuses to start with
`listen EINVAL`.

The download lands in `.vscode-test/` (gitignored) and is reused. The run needs
Node 22, which is what `@vscode/test-electron` requires.

### Layout

| Path | Purpose |
|------|---------|
| `src/test/integration/runTests.ts` | Launcher: downloads VS Code, opens each fixture workspace, points the host at `index.js` |
| `src/test/integration/index.ts` | Runs inside the host; builds the Mocha run over the compiled `*.itest.js` that belong to it |
| `src/test/integration/helpers.ts` | `activateExtension`, `openFixture`, `positionOf`, `waitFor` |
| `src/test/integration/*.itest.ts` | The suites |
| `test-fixtures/workspace/` | A small Phel project: `phel-config.php`, `composer.json`, `src/app/*.phel`, `tests/app/core_test.phel` |
| `test-fixtures/workspace2/` | A second project (`src/util/strings.phel`, with a `deftest` and a `defbench`) |
| `test-fixtures/multi-root.code-workspace` | Two-folder workspace over both of the above, for the multi-root cases |

The launcher starts VS Code **twice**, sequentially: once on
`test-fixtures/workspace`, once on `test-fixtures/multi-root.code-workspace`.
"Which workspace folder does this command run in" can only be asked of a window
that has more than one, and running every suite in both would only double the
runtime. `MULTI_ROOT_SUITES` in `index.ts` lists the suites belonging to the
second host; every other suite runs in the first. Add a multi-root suite to that
set, or it will run in the single-folder window and fail there.

The `.itest.ts` suffix is what keeps the two suites apart. `npm test` globs
`out/test/**/*.test.js`, which never matches `*.itest.js`, so the integration
suites can live in the same `out/` tree without a second `tsconfig.json` and
without either runner picking up the other's files. The fixtures sit at the repo
root rather than under `src/`, because `tsc` only copies `.ts` output into
`out/`. `main` points at `dist/extension.js`, so the suites always exercise the
bundle a user would install - which is why `test:integration` bundles first.

### Writing one

- Call `activateExtension()` from `before`; it is idempotent.
- Address fixture text with `positionOf(doc, '(push xs item)', 1)` instead of
  hard-coded line/column, so editing a fixture cannot silently move an assertion
  off its target.
- Never sleep. Anything asynchronous - the workspace index scan, the 250 ms
  diagnostic debounces - goes through `waitFor(what, probe)`, which polls
  against a deadline and names what it was waiting for when it gives up.
- The fixture deliberately has **no** `vendor/bin/phel`. Every CLI-backed
  feature has to fail silently there, and that is itself an assertion: see
  `diagnostics.itest.ts`.
- If a test edits a buffer, revert it (`workbench.action.files.revert`) in
  `afterEach`. The fixtures are checked in; a suite must leave them as found.

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
npm run regen-docs -- /path/to/phel-lang --phel-version v0.50.0
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
