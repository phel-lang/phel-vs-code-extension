#!/usr/bin/env bash
# Build the workspace the real-CLI integration suites run against.
#
#   scripts/make-real-cli-fixture.sh [--phel <phel-lang checkout>] [<target dir>]
#
# The checked-in `test-fixtures/workspace` deliberately has no Phel, so every
# CLI-backed feature there is only ever verified against a fake. This makes the
# other half of that picture: a real `phel init` project, with a real Phel
# pointed at it, holding one instance of every case the suites assert on -
# a lint warning, a lint error, a file only the linter objects to, a failing and
# a passing `deftest`, a `defbench`, a removed and a deprecated form, a
# `:deprecated` definition with a caller, an unused `:require`, and a namespace
# two others require, one with `:refer` and one with `:as`.
#
# It is written outside the repo (mktemp by default) because it is a scratch
# project: the suites save files in it, rewrite its `phel-config.php`, and leave
# `.phel/` caches behind. Re-run this script to get a clean one.
#
# Then:
#   PHEL_REAL_CLI_WORKSPACE=<dir> VSCODE_TEST_USER_DATA_DIR=$(mktemp -d) \
#       npm run test:integration
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
phel_repo="$(cd "$repo_root/../phel-lang" 2>/dev/null && pwd || echo '')"
target=''

while [ $# -gt 0 ]; do
    case "$1" in
        --phel)
            phel_repo="$2"
            shift 2
            ;;
        -h|--help)
            sed -n '2,21p' "$0"
            exit 0
            ;;
        *)
            target="$1"
            shift
            ;;
    esac
done

if [ -z "$phel_repo" ] || [ ! -x "$phel_repo/bin/phel" ]; then
    echo "no phel-lang checkout with bin/phel; pass --phel <path>" >&2
    exit 1
fi
if [ ! -f "$phel_repo/vendor/autoload.php" ]; then
    echo "run composer install in $phel_repo first" >&2
    exit 1
fi
if ! command -v php >/dev/null 2>&1; then
    echo "php is not on PATH (Phel needs 8.2+)" >&2
    exit 1
fi
phel_repo="$(cd "$phel_repo" && pwd)"

if [ -z "$target" ]; then
    target="$(mktemp -d "${TMPDIR:-/tmp}/phel-real-cli.XXXXXX")"
fi
mkdir -p "$target"
target="$(cd "$target" && pwd)"

# `phel init` scaffolds phel-config.php, src/main.phel, tests/main_test.phel and
# a .gitignore. `-n` keeps it non-interactive; the flat layout is what a reader
# of `src/<file>.phel` expects.
(cd "$target" && php "$phel_repo/bin/phel" init demo -n >/dev/null)

# The one thing `phel.executablePath` accepts is a single spawnable file, and a
# phel-lang checkout's `bin/phel` needs `php` in front of it on the platforms
# where the shebang is not honoured. A wrapper inside the project keeps the
# setting to one path and the project self-contained.
mkdir -p "$target/bin"
cat >"$target/bin/phel" <<EOF
#!/bin/sh
exec php "$phel_repo/bin/phel" "\$@"
EOF
chmod +x "$target/bin/phel"

mkdir -p "$target/.vscode"
cat >"$target/.vscode/settings.json" <<EOF
{
    "phel.executablePath": "$target/bin/phel"
}
EOF

# One namespace requiring another: go-to-definition on the required namespace is
# the case only the daemon's project index can answer, and \`shout\` is used from
# three other files, which is what find-references has to gather.
cat >"$target/src/strings.phel" <<'EOF'
(ns demo.strings)

(defn shout
  "Upper-case `text` and add an exclamation mark."
  [text]
  (str (php/strtoupper text) "!"))
EOF

cat >"$target/src/consumer.phel" <<'EOF'
(ns demo.consumer
  (:require demo.strings :refer [shout])
  (:require demo.unused-dep))

(defn announce [text]
  (str "** " (shout text) " **"))
EOF

# The second require above names this namespace and never uses it, which is what
# `phel lint` reports as `phel/unused-require` - the one finding the editor-side
# hygiene hints have to agree with, and hand over to, after a save. It has to be
# a namespace that compiles: requiring `demo.legacy` (which uses the removed
# `push`) would break `demo.consumer` for every other suite.
cat >"$target/src/unused_dep.phel" <<'EOF'
(ns demo.unused-dep)

(defn helper [x]
  (str x))
EOF

# The same function reached through an alias instead of `:refer`. A scan for the
# token `shout` cannot see it — `s/shout` is one token — so this is what says
# whether the reference count and the rename follow a qualified use.
cat >"$target/src/qualified_consumer.phel" <<'EOF'
(ns demo.qualified-consumer
  (:require demo.strings :as s))

(defn loud [text]
  (s/shout text))
EOF

# `phel lint` reports `phel/unused-binding` here and nothing else; the analyzer
# (and so the api-daemon) has no such rule, which is what makes this file proof
# that the on-save pass really ran `phel lint`.
cat >"$target/src/lint_me.phel" <<'EOF'
(ns demo.lint-me)

(defn with-unused []
  (let [used 1
        unused 2]
    used))
EOF

# A file nothing but `phel lint` has anything to say about: a standalone `;` is
# a `phel/comment-style` warning, while the analyzers the extension runs itself -
# unused locals, migration, the api-daemon - all find it clean. The tasks suite
# needs one to watch what a task run does to the markers the on-save pass filed,
# which the editor only reports back once none of the extension's own are left.
cat >"$target/src/lint_only.phel" <<'EOF'
(ns demo.lint-only)

; A standalone comment, which the linter wants to see written as `;;`.
(defn forty-two [] 42)
EOF

# A lint *error*: `phel/unresolved-symbol`, which `phel lint` exits 1 for.
cat >"$target/src/broken.phel" <<'EOF'
(ns demo.broken)

(defn boom []
  (no-such-symbol 1 2))
EOF

# `push` was removed in 0.50, `php/new` deprecated: one migration warning and
# one migration hint, plus the quick fix that rewrites `push` to `conj`.
cat >"$target/src/legacy.phel" <<'EOF'
(ns demo.legacy)

(defn append [xs x]
  (push xs x))

(defn now []
  (php/new \DateTimeImmutable))
EOF

# A workspace definition marked `:deprecated`, and a caller of it.
cat >"$target/src/deprecated_api.phel" <<'EOF'
(ns demo.deprecated-api)

(defn old-greet
  "Greet someone the old way."
  {:deprecated "0.49.0" :superseded-by "greet-v2"}
  [name]
  (str "Hi " name))

(defn greet-v2 [name]
  (str "Hello " name))

(defn caller []
  (old-greet "Phel"))
EOF

# One failing and one passing `deftest`, so a run of this file exits 1 and the
# JUnit report has both outcomes in it.
cat >"$target/tests/failing_test.phel" <<'EOF'
(ns demo.failing-test
  (:require phel.test :refer [deftest is])
  (:require demo.strings :refer [shout]))

(deftest test-shout-passes
  (is (= "HI!" (shout "hi"))))

(deftest test-shout-fails
  (is (= "this will never match" (shout "hi"))))
EOF

cat >"$target/tests/shout_bench.phel" <<'EOF'
(ns demo.shout-bench
  (:require phel.bench :refer [defbench])
  (:require demo.strings :refer [shout]))

(defbench bench-shout
  (shout "hello"))
EOF

# A file with nothing wrong in it, for the suites that type into a clean buffer.
cat >"$target/src/scratch.phel" <<'EOF'
(ns demo.scratch)

(defn noop []
  nil)
EOF

# Already formatted, so a suite can mis-indent it and watch `phel format` put it
# back on save.
cat >"$target/src/format_me.phel" <<'EOF'
(ns demo.format-me)

(defn tidy [x]
  (+ x 1))
EOF

# Nothing but a namespace: the on-type indentation suite types a body into it
# line by line and then asks `phel format` whether it would move any of them.
cat >"$target/src/indent_me.phel" <<'EOF'
(ns demo.indent-me)
EOF

# A value the nREPL suite loads into the live runtime and then hovers.
cat >"$target/src/repl_target.phel" <<'EOF'
(ns demo.repl-target)

(def answer 42)
EOF

echo "$target"
