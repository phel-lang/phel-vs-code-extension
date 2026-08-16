// Launcher for the integration suite: downloads (and caches under
// `.vscode-test/`) a real VS Code, starts it with a fixture workspace open
// and this repo loaded as an extension under development, then hands control to
// `index.js` inside that host. `npm run test:integration` runs the compiled
// version of this file.
//
// The unit tests import modules directly; nothing there proves the extension
// activates, that the providers are registered against `phel`, or that the ids
// in `package.json` match the ones the code registers. That only shows up in a
// real host, which is what this exists for.
//
// There are up to three launches. The second exists because "which workspace
// folder does this command run in" can only be asked of a window that has more
// than one, so it opens `test-fixtures/multi-root.code-workspace`. The third is
// opt-in: `PHEL_REAL_CLI_WORKSPACE` points it at a project with a real Phel
// (see `scripts/make-real-cli-fixture.sh`), which is the only way to see what
// the CLI-backed features do against the CLI rather than against a stand-in.
// `PHEL_ITEST_SUITES` tells `index.js` which of the three sets to run.

import * as path from 'path';
import { runTests } from '@vscode/test-electron';

// out/test/integration -> repo root.
const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
const extensionTestsPath = path.resolve(__dirname, './index.js');

/** Which set of suites a host runs; mirrored by `SuiteGroup` in `index.ts`. */
type SuiteGroup = 'default' | 'multi-root' | 'real';

async function launch(workspace: string, suites: SuiteGroup): Promise<void> {
    await runTests({
        version: process.env.VSCODE_TEST_VERSION ?? 'stable',
        extensionDevelopmentPath,
        extensionTestsPath,
        extensionTestsEnv: { PHEL_ITEST_SUITES: suites },
        launchArgs: [
            workspace,
            // Another extension claiming `.phel`, a trust prompt swallowing the
            // first activation, or GPU init under xvfb would each break the run
            // for reasons that have nothing to do with this extension.
            '--disable-extensions',
            '--disable-workspace-trust',
            '--disable-gpu',
            // Keep the host off the developer's real profile: a locally open
            // VS Code of the same version otherwise adopts this window and the
            // run never reaches the tests. Overridable because the main IPC
            // socket lives inside this directory and a unix socket path is
            // capped at ~103 characters, which a checkout nested deeply enough
            // (a git worktree, say) exceeds before VS Code even starts.
            '--user-data-dir',
            process.env.VSCODE_TEST_USER_DATA_DIR ??
                path.join(extensionDevelopmentPath, '.vscode-test', 'user-data'),
            // Ubuntu 23.10+ (which the CI runner image tracks) blocks the
            // unprivileged user namespaces Electron's sandbox needs, and the
            // helper then refuses to start at all.
            ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
        ],
    });
}

async function main(): Promise<void> {
    const fixtures = path.join(extensionDevelopmentPath, 'test-fixtures');
    // Sequentially: the hosts share `--user-data-dir`, and a second window
    // opened while the first is up would be adopted by it.
    await launch(path.join(fixtures, 'workspace'), 'default');
    await launch(path.join(fixtures, 'multi-root.code-workspace'), 'multi-root');

    const realCli = process.env.PHEL_REAL_CLI_WORKSPACE;
    if (!realCli) {
        // Not a failure: CI has no PHP project to point at, and the suites are
        // meant to be run against one before a release.
        console.log(
            'PHEL_REAL_CLI_WORKSPACE is not set; skipping the real-CLI suites ' +
                '(see scripts/make-real-cli-fixture.sh).'
        );
        return;
    }
    await launch(path.resolve(realCli), 'real');
}

main().catch((err) => {
    console.error('Integration tests failed:', err);
    process.exit(1);
});
