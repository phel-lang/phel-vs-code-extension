// A stand-in for `phel api-daemon`, spawned by the unit tests (through
// `process.execPath`) and by the fixture script the integration suite points
// `phel.executablePath` at. It speaks the same newline-delimited JSON the real
// daemon does, and reproduces the three ways the real one misbehaves, on
// demand through switches in the request params:
//
//   `__hang`            never answer (a PHP process stuck mid-analysis)
//   `__crash`           exit non-zero without answering
//   `__unknownCommand`  the Symfony line an older Phel prints for a command it
//                       does not have, on stderr, then exit
//
// Two more things it copies from the real thing: the banner Symfony can put on
// stdout before any response (so the client has to tolerate non-JSON lines),
// and answering a subcommand that is not `api-daemon` - `lint`, `analyze` -
// with an empty JSON array, so pointing the whole extension at this script
// leaves the on-save path quiet instead of hanging it on a daemon that never
// speaks.
//
// Compiled to `out/test/fakeApiDaemon.js`; `npm test` globs `*.test.js`, so it
// is never collected as a suite.

import * as fs from 'node:fs';
import * as readline from 'node:readline';

interface Request {
    id?: unknown;
    method?: unknown;
    params?: Record<string, unknown>;
}

const argv = process.argv.slice(2);

function flagValue(flag: string): string | undefined {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
}

function respond(message: Record<string, unknown>): void {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

function diagnosticsFor(params: Record<string, unknown>): unknown[] {
    return [
        {
            code: 'FAKE001',
            severity: 'warning',
            message: `fake:${String(params.source ?? '')}`,
            uri: String(params.uri ?? ''),
            startLine: 1,
            startCol: 0,
            endLine: 1,
            endCol: 3,
        },
    ];
}

/** The subcommand, i.e. the first argument that is not a flag or its value. */
const subcommand = argv.find((arg) => !arg.startsWith('-')) ?? 'api-daemon';

if (subcommand !== 'api-daemon') {
    // One-shot mode. Nothing keeps the loop alive, so the process ends once
    // stdout has drained - `process.exit` here could truncate the pipe.
    process.stdout.write('[]\n');
} else {
    const spawnLog = flagValue('--spawn-log');
    if (spawnLog) {
        // One line per process, so a test can tell a restart from a respawn
        // that never happened.
        fs.appendFileSync(spawnLog, `${process.pid}\n`);
    }

    /** How many `analyzeSource` calls this process has answered. */
    let analyzed = 0;

    // The line the client has to skip before it sees any JSON.
    process.stdout.write('<error>Fake Phel daemon banner</error>\n');

    const reader = readline.createInterface({ input: process.stdin });

    reader.on('line', (line: string) => {
        const trimmed = line.trim();
        if (trimmed === '') {
            return;
        }

        let request: Request;
        try {
            request = JSON.parse(trimmed) as Request;
        } catch {
            respond({ id: null, error: { code: -32700, message: 'Invalid JSON payload' } });
            return;
        }

        const params = request.params ?? {};
        if (params.__hang === true) {
            return;
        }
        if (params.__crash === true) {
            process.exit(3);
        }
        if (params.__unknownCommand === true) {
            // Exit from the write callback: on a pipe the message would
            // otherwise be lost, which is the whole point of this switch.
            process.stderr.write('Command "api-daemon" is not defined.\n', () => process.exit(1));
            return;
        }

        switch (request.method) {
            case 'analyzeSource':
                analyzed++;
                respond({ id: request.id, result: diagnosticsFor(params) });
                return;
            case '__stats':
                respond({ id: request.id, result: { analyzed, pid: process.pid } });
                return;
            default:
                respond({
                    id: request.id,
                    error: { code: -32601, message: `Unknown method: ${String(request.method)}` },
                });
        }
    });

    // Losing stdin means the editor is gone; do not linger as an orphan.
    reader.on('close', () => process.exit(0));
}
