// The `.nrepl-port` discovery file, kept free of `vscode` so it can be
// unit-tested. Since Phel 0.50 `phel nrepl` writes its bound port there (in
// the working directory, the Clojure-standard location that CIDER, Calva and
// Conjure read) once the socket is listening, and removes it on every exit
// path, so a file that exists is meant as an invitation to attach.

export const NREPL_PORT_FILE = '.nrepl-port';

/**
 * Parse the contents of a `.nrepl-port` file. The server writes the bare port
 * number; anything else (an empty file, a host:port pair from another tool, a
 * port outside the TCP range) is not ours to trust.
 */
export function parseNreplPortFile(contents: string): number | undefined {
    const text = contents.trim();
    if (!/^\d{1,5}$/.test(text)) {
        return undefined;
    }
    const port = Number.parseInt(text, 10);
    return port >= 1 && port <= 65535 ? port : undefined;
}
