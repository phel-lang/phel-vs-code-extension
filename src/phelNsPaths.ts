// Where a namespace lives on disk, and which file is the other half of a pair.
//
// Two conventions, both from phel-lang. `Munge` maps a namespace onto a path:
// `.` is a directory separator and `-` is `_`, so `demo.my-app` is
// `demo/my_app.phel`. `ProjectTemplateGenerator` maps a namespace onto its
// test: `demo.strings` is tested by `demo.strings-test` in
// `tests/strings_test.phel`, i.e. the same path under the project's
// `test-dirs`, with `_test` on the file name.
//
// What nothing here can do is compute the namespace of a brand-new file from
// its path alone. `phel config --format=json` does not print the project's main
// namespace, and there is no rule to guess it with: `src/strings.phel` is
// `demo.strings` in a project scaffolded by `phel init demo` and `app.strings`
// in the next one. `deriveNamespace` reads that mapping off the files that
// already exist instead, and only falls back to the path when none of them
// agrees.
//
// No `vscode` imports, so every rule above is unit-testable on its own.

const PHEL_EXT = '.phel';

/** What Phel's own default layout uses, for a project whose CLI cannot be asked. */
export const DEFAULT_SRC_DIRS: readonly string[] = ['src'];
export const DEFAULT_TEST_DIRS: readonly string[] = ['tests'];

/** The directories a project keeps its two halves in. */
export interface PhelLayout {
    srcDirs: readonly string[];
    testDirs: readonly string[];
}

/**
 * The layout to work with, given whatever `phel config` could say. A CLI that
 * is missing or too old answers `null`, and every rule here then falls back to
 * the layout `phel init` scaffolds.
 */
export function layoutOf(config: PhelLayout | null | undefined): PhelLayout {
    return {
        srcDirs: config?.srcDirs.length ? config.srcDirs : DEFAULT_SRC_DIRS,
        testDirs: config?.testDirs.length ? config.testDirs : DEFAULT_TEST_DIRS,
    };
}

/** A `.phel` file and the namespace its `(ns ...)` form declares. */
export interface PhelFile {
    /** Path relative to the workspace folder, `/`-separated. */
    relPath: string;
    ns: string;
}

/** `demo.my-app` -> `demo/my_app.phel`. */
export function nsToRelativePath(ns: string): string {
    return (
        ns
            .split('.')
            .filter((segment) => segment.length > 0)
            .map((segment) => segment.replace(/-/g, '_'))
            .join('/') + PHEL_EXT
    );
}

/** `demo/my_app.phel` -> `demo.my-app`. The inverse Phel's `Munge` decodes. */
export function pathToNs(relPath: string): string {
    return segmentsOf(relPath).join('.');
}

/**
 * The test file for a source file, or `null` when the file is not under one of
 * the project's `src-dirs`. Ask `sourceFileFor` first: a root layout has `.`
 * among its `src-dirs`, which covers the test directory too.
 */
export function testFileFor(
    file: PhelFile,
    srcDirs: readonly string[] = DEFAULT_SRC_DIRS,
    testDirs: readonly string[] = DEFAULT_TEST_DIRS
): PhelFile | null {
    const rel = normalize(file.relPath);
    const rest = withoutDir(rel, srcDirs);
    const testDir = firstDir(testDirs);
    if (rest === null || testDir === null || !rest.endsWith(PHEL_EXT)) {
        return null;
    }
    return {
        relPath: join(testDir, rest.slice(0, -PHEL_EXT.length) + '_test' + PHEL_EXT),
        ns: file.ns ? `${file.ns}-test` : '',
    };
}

/**
 * The source file a test file belongs to, or `null` when the file is not a
 * `<name>_test.phel` under one of the project's `test-dirs`.
 */
export function sourceFileFor(
    file: PhelFile,
    srcDirs: readonly string[] = DEFAULT_SRC_DIRS,
    testDirs: readonly string[] = DEFAULT_TEST_DIRS
): PhelFile | null {
    const rel = normalize(file.relPath);
    const rest = withoutDir(rel, testDirs);
    const srcDir = firstDir(srcDirs);
    if (rest === null || srcDir === null || !rest.endsWith('_test' + PHEL_EXT)) {
        return null;
    }
    return {
        relPath: join(srcDir, rest.slice(0, -('_test' + PHEL_EXT).length) + PHEL_EXT),
        ns: file.ns.endsWith('-test') ? file.ns.slice(0, -'-test'.length) : file.ns,
    };
}

export interface DeriveNamespaceInput {
    /** The new file, relative to its workspace folder. */
    relPath: string;
    /** The `.phel` files already in the folder, with the namespace each declares. */
    siblings: readonly PhelFile[];
    /** Only used for the fallback, when no sibling covers the new file's path. */
    srcDirs?: readonly string[];
    testDirs?: readonly string[];
}

/**
 * The namespace a new file should declare.
 *
 * Every sibling states one fact: its own path ends in the same segments its
 * namespace does, and whatever is left over on each side is the project's
 * prefix. `src/strings.phel` declaring `demo.strings` says "drop `src`, prepend
 * `demo`"; `src/app/core.phel` declaring `app.core` says "drop `src`, prepend
 * nothing". Applying that to the new file's path is the whole rule, and the
 * sibling closest to it in the tree wins.
 *
 * Falls back to the path with a leading `src-dir` / `test-dir` removed, which
 * is right for a project whose namespaces have no prefix and wrong (but
 * visible, and one edit away) for one that does.
 */
export function deriveNamespace(input: DeriveNamespaceInput): string | null {
    const target = segmentsOf(input.relPath);
    if (target.length === 0) {
        return null;
    }
    let best: { pathPrefix: number; nsPrefix: string[]; shared: number } | null = null;
    for (const sibling of input.siblings) {
        const path = segmentsOf(sibling.relPath);
        const ns = sibling.ns.split('.').filter((segment) => segment.length > 0);
        const tail = commonTail(path, ns);
        if (tail === 0 || sameSegments(path, target)) {
            continue; // says nothing, or is the file itself
        }
        const pathPrefix = path.length - tail;
        if (!startsWith(target, path.slice(0, pathPrefix))) {
            continue; // a different corner of the project
        }
        const shared = sharedDirs(path, target);
        if (
            !best ||
            shared > best.shared ||
            (shared === best.shared && pathPrefix > best.pathPrefix)
        ) {
            best = { pathPrefix, nsPrefix: ns.slice(0, ns.length - tail), shared };
        }
    }
    if (best) {
        return [...best.nsPrefix, ...target.slice(best.pathPrefix)].join('.');
    }
    const rel = normalize(input.relPath);
    const dirs = [...(input.testDirs ?? DEFAULT_TEST_DIRS), ...(input.srcDirs ?? DEFAULT_SRC_DIRS)];
    return pathToNs(withoutDir(rel, dirs) ?? rel);
}

/**
 * The file to scaffold a missing test with: the `(ns ...)` header `phel init`
 * writes, and a `deftest` to replace.
 *
 * The body is not `phel init`'s. That one asserts against the `greet` its own
 * `src/main.phel` defines, which exists in exactly one project; a scaffold that
 * referred a name the namespace under test does not have would not compile, and
 * requiring it without referring anything would only trip the unused-require
 * hint this module also reports. So the namespace under test is named in the
 * `deftest` and in a TODO, and the first real assertion is the user's.
 */
export function testFileTemplate(testNs: string, srcNs: string): string {
    const subject = srcNs.split('.').pop() || 'it';
    return `(ns ${testNs}
  (:require phel.test :refer [deftest is]))

(deftest test-${subject}
  (is (= true true) "TODO: test ${srcNs}"))
`;
}

/** Path segments with the extension dropped and `_` decoded back to `-`. */
function segmentsOf(relPath: string): string[] {
    const rel = normalize(relPath);
    const withoutExt = rel.endsWith(PHEL_EXT) ? rel.slice(0, -PHEL_EXT.length) : rel;
    return withoutExt
        .split('/')
        .filter((segment) => segment.length > 0 && segment !== '.')
        .map((segment) => segment.replace(/_/g, '-'));
}

function normalize(relPath: string): string {
    return relPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** `rel` with the longest matching directory of `dirs` removed, or `null`. */
function withoutDir(rel: string, dirs: readonly string[]): string | null {
    let best: string | null = null;
    for (const dir of dirs) {
        // A root layout lists `.`, which every file is already relative to.
        const prefix = dirPrefix(dir);
        const matches = prefix === '' || rel.startsWith(prefix + '/');
        if (matches && (best === null || prefix.length > best.length)) {
            best = prefix;
        }
    }
    if (best === null) {
        return null;
    }
    return best === '' ? rel : rel.slice(best.length + 1);
}

/** The directory a file's counterpart goes in; `''` for a root layout. */
function firstDir(dirs: readonly string[]): string | null {
    return dirs.length > 0 ? dirPrefix(dirs[0]) : null;
}

function dirPrefix(dir: string): string {
    const prefix = normalize(dir).replace(/\/+$/, '');
    return prefix === '.' ? '' : prefix;
}

function join(dir: string, rest: string): string {
    return dir === '' ? rest : `${dir}/${rest}`;
}

/** How many segments the two arrays end with in common. */
function commonTail(a: readonly string[], b: readonly string[]): number {
    let n = 0;
    while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) {
        n++;
    }
    return n;
}

/** How many leading *directory* segments the two paths agree on. */
function sharedDirs(a: readonly string[], b: readonly string[]): number {
    let n = 0;
    while (n < a.length - 1 && n < b.length - 1 && a[n] === b[n]) {
        n++;
    }
    return n;
}

function startsWith(segments: readonly string[], prefix: readonly string[]): boolean {
    return prefix.length < segments.length && prefix.every((s, i) => segments[i] === s);
}

function sameSegments(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((s, i) => b[i] === s);
}
