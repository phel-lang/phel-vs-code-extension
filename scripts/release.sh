#!/usr/bin/env bash
# Cut a new release of the Phel Lang VS Code extension.
#
#   scripts/release.sh [<version>] [--bump <major|minor|patch>] [--publish] [--no-push]
#
# Default flow (no args): bump the minor version of the current package.json,
# package the vsix, push the tag, create the GitHub Release with the vsix
# attached. Marketplace publish is OFF by default - drop the vsix into the
# Marketplace web UI yourself, or pass `--publish` for full automation.
#
# Version selection precedence:
#   1. Explicit `<version>` arg if given.
#   2. `--bump major|minor|patch` of the current `package.json` version.
#   3. Default: `--bump minor`.
#
# What it does, in order:
#   1. Sanity checks: on main, working tree clean, version not already tagged.
#   2. Bumps package.json + package-lock.json to the chosen version.
#   3. Renames the CHANGELOG "Unreleased" heading to "[<version>] - <today>"
#      (if present); otherwise leaves CHANGELOG as-is so the entry is
#      assumed already authored.
#   4. Runs the gate: npm run compile, npm test, npm run tokenize.
#   5. Builds phel-lang-<version>.vsix via `vsce package`.
#   6. Commits ("chore(release): vX.Y.Z"), tags vX.Y.Z, pushes both
#      (skip with --no-push to dry-run locally).
#   7. Creates a GitHub Release with the .vsix attached, using the matching
#      CHANGELOG section as the release notes.
#   8. (Only with --publish) publishes to the VS Code Marketplace via
#      `vsce publish`.
#
# Pre-reqs (one-time): see docs/CONTRIBUTING.md "Marketplace setup".
#   - gh authed (`gh auth status`)
#   - For --publish: vsce logged in (`npx @vscode/vsce login Phel-Lang`)
#     or VSCE_PAT env var set.

set -euo pipefail

PUBLISH=0
PUSH=1
VERSION=""
BUMP="minor"

usage() {
    sed -n '2,38p' "$0" >&2
    exit 1
}

while (( $# > 0 )); do
    case "$1" in
        --publish)    PUBLISH=1; shift ;;
        --no-publish) PUBLISH=0; shift ;;  # accepted for backwards compatibility
        --no-push)    PUSH=0; shift ;;
        --bump)
            shift
            case "${1:-}" in
                major|minor|patch) BUMP="$1"; shift ;;
                *) echo "--bump expects major|minor|patch (got '${1:-}')" >&2; exit 1 ;;
            esac
            ;;
        -h|--help)    usage ;;
        -*)           echo "unknown flag: $1" >&2; usage ;;
        *)            VERSION="$1"; shift ;;
    esac
done

if [[ -z "$VERSION" ]]; then
    CURRENT=$(node -p "require('./package.json').version")
    VERSION=$(node -e "
        const [v, level] = process.argv.slice(1);
        const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
        if (!m) { console.error('cannot parse current version: ' + v); process.exit(1); }
        let [, maj, min, pat] = m.map(Number);
        if (level === 'major')      { maj++; min = 0; pat = 0; }
        else if (level === 'minor') { min++; pat = 0; }
        else                        { pat++; }
        console.log(\`\${maj}.\${min}.\${pat}\`);
    " "$CURRENT" "$BUMP")
    echo "==> auto-bumping $BUMP: $CURRENT -> $VERSION"
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    echo "version '$VERSION' is not semver (X.Y.Z[-pre])" >&2
    exit 1
fi

TAG="v$VERSION"

# 1. Sanity checks
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "main" ]]; then
    echo "release must be cut from main (current: $BRANCH)" >&2
    exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
    echo "working tree not clean. commit or stash first." >&2
    git status --short >&2
    exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "tag $TAG already exists" >&2
    exit 1
fi

# Sync with remote so we don't release behind main.
git fetch origin --tags --quiet
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
    echo "local main is not in sync with origin/main. run 'git pull --ff-only' first." >&2
    exit 1
fi

echo "==> releasing $TAG"

# 2. Version bump
npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
echo "    package.json -> $VERSION"

# 3. CHANGELOG: rewrite "## [Unreleased]" -> "## [X.Y.Z] - YYYY-MM-DD" and
#    insert a fresh empty "## [Unreleased]" above it so the next contribution
#    has a place to land.
TODAY=$(date +%Y-%m-%d)
if grep -q "^## \[Unreleased\]" CHANGELOG.md; then
    sed -i.bak -E "s/^## \[Unreleased\]/## [$VERSION] - $TODAY/" CHANGELOG.md
    rm CHANGELOG.md.bak
    awk -v entry="## [$VERSION] - $TODAY" '
        !inserted && $0 == entry {
            print "## [Unreleased]"
            print ""
            inserted = 1
        }
        { print }
    ' CHANGELOG.md > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md
    echo "    CHANGELOG.md: Unreleased -> [$VERSION] - $TODAY (fresh Unreleased restored)"
else
    echo "    CHANGELOG.md: no [Unreleased] heading; assuming entry already in place"
fi

# 4. Gate
echo "==> npm run compile"
npm run compile

echo "==> npm test"
npm test

if [[ -f scripts/tokenize-sample.mjs ]]; then
    echo "==> npm run tokenize (sanity, no diff check)"
    npm run tokenize >/dev/null
fi

# 5. Build vsix
echo "==> vsce package"
rm -f "phel-lang-$VERSION.vsix"
npx --yes @vscode/vsce package --no-dependencies --out "phel-lang-$VERSION.vsix" \
    || npx --yes @vscode/vsce package --out "phel-lang-$VERSION.vsix"

VSIX="phel-lang-$VERSION.vsix"
if [[ ! -f "$VSIX" ]]; then
    echo "vsce did not produce $VSIX" >&2
    exit 1
fi

# 6. Commit + tag
git add package.json package-lock.json CHANGELOG.md
if [[ -n "$(git diff --cached --name-only)" ]]; then
    git commit -m "chore(release): $TAG"
    echo "    commit created"
else
    echo "    nothing to commit (version already at $VERSION)"
fi

git tag -a "$TAG" -m "Release $VERSION"
echo "    tagged $TAG"

if (( PUSH == 1 )); then
    git push origin main
    git push origin "$TAG"
else
    echo "    skipping git push (--no-push)"
fi

# 7. GitHub Release
RELEASE_NOTES_FILE=$(mktemp)
trap 'rm -f "$RELEASE_NOTES_FILE"' EXIT

awk -v ver="$VERSION" '
    BEGIN { capture = 0 }
    /^## \[/ {
        if (capture) exit
        if ($0 ~ "^## \\[" ver "\\]") { capture = 1; next }
    }
    capture { print }
' CHANGELOG.md > "$RELEASE_NOTES_FILE"

if [[ ! -s "$RELEASE_NOTES_FILE" ]]; then
    echo "no CHANGELOG section for [$VERSION]; release notes will be empty" >&2
fi

if (( PUSH == 1 )); then
    echo "==> gh release create $TAG"
    gh release create "$TAG" "$VSIX" \
        --title "$TAG" \
        --notes-file "$RELEASE_NOTES_FILE" \
        || echo "    (gh release create failed; create manually if needed)"
else
    echo "    skipping gh release create (--no-push)"
fi

# 8. Marketplace publish
if (( PUBLISH == 1 )) && (( PUSH == 1 )); then
    echo "==> vsce publish $VERSION"
    npx --yes @vscode/vsce publish --packagePath "$VSIX"
else
    echo "    skipping vsce publish (--no-publish or --no-push)"
fi

echo "==> done. https://github.com/phel-lang/phel-vs-code-extension/releases/tag/$TAG"
