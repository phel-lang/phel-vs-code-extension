// Launcher for the integration suite: downloads (and caches under
// `.vscode-test/`) a real VS Code, starts it with the fixture workspace open
// and this repo loaded as an extension under development, then hands control to
// `index.js` inside that host. `npm run test:integration` runs the compiled
// version of this file.
//
// The unit tests import modules directly; nothing there proves the extension
// activates, that the providers are registered against `phel`, or that the ids
// in `package.json` match the ones the code registers. That only shows up in a
// real host, which is what this exists for.

import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
    // out/test/integration -> repo root.
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
    const extensionTestsPath = path.resolve(__dirname, './index.js');
    const fixtureWorkspace = path.join(extensionDevelopmentPath, 'test-fixtures', 'workspace');

    await runTests({
        version: process.env.VSCODE_TEST_VERSION ?? 'stable',
        extensionDevelopmentPath,
        extensionTestsPath,
        launchArgs: [
            fixtureWorkspace,
            // Another extension claiming `.phel`, a trust prompt swallowing the
            // first activation, or GPU init under xvfb would each break the run
            // for reasons that have nothing to do with this extension.
            '--disable-extensions',
            '--disable-workspace-trust',
            '--disable-gpu',
            // Keep the host off the developer's real profile: a locally open
            // VS Code of the same version otherwise adopts this window and the
            // run never reaches the tests.
            '--user-data-dir',
            path.join(extensionDevelopmentPath, '.vscode-test', 'user-data'),
            // Ubuntu 23.10+ (which the CI runner image tracks) blocks the
            // unprivileged user namespaces Electron's sandbox needs, and the
            // helper then refuses to start at all.
            ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
        ],
    });
}

main().catch((err) => {
    console.error('Integration tests failed:', err);
    process.exit(1);
});
