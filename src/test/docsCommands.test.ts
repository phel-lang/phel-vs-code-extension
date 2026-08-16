// Guards `docs/commands.md` against `package.json`. The doc lists every
// contributed command with its id, and nothing keeps the two in step but this
// test: a renamed id would leave the doc pointing at a command that no longer
// exists, and a new one would ship undocumented.
//
// Ids are read from the second column of the doc's tables rather than from the
// prose, so a setting mentioned in passing (`phel.executablePath`, …) is never
// mistaken for a command.

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface ContributedCommand {
    command: string;
    title: string;
}

interface Keybinding {
    command: string;
}

interface DocRow {
    title: string;
    id: string;
    key: string;
}

const root = join(__dirname, '..', '..');

const manifest: {
    contributes: { commands: ContributedCommand[]; keybindings?: Keybinding[] };
} = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

const doc = readFileSync(join(root, 'docs', 'commands.md'), 'utf-8');

const NO_KEY = '—';
/** A command row: `| <title> | \`phel.id\` | … | … | <key> |`. */
const ID_CELL = /^`(phel\.[A-Za-z0-9_.]+)`$/;

function commandRows(markdown: string): DocRow[] {
    const rows: DocRow[] = [];
    for (const line of markdown.split(/\r?\n/)) {
        if (!line.startsWith('|')) {
            continue;
        }
        // Leading `|` yields an empty first cell, so the columns start at 1.
        const cells = line.split('|').map((cell) => cell.trim());
        const match = ID_CELL.exec(cells[2] ?? '');
        if (match) {
            rows.push({ title: cells[1], id: match[1], key: cells[cells.length - 2] });
        }
    }
    return rows;
}

const rows = commandRows(doc);
const documented = new Map(rows.map((row) => [row.id, row]));
const contributed = new Map(manifest.contributes.commands.map((c) => [c.command, c]));
const bound = new Set((manifest.contributes.keybindings ?? []).map((k) => k.command));

describe('docs/commands.md', () => {
    it('documents every contributed command', () => {
        const missing = [...contributed.keys()].filter((id) => !documented.has(id));
        assert.deepEqual(missing, [], `commands with no row in docs/commands.md: ${missing}`);
    });

    it('documents no command package.json does not contribute', () => {
        const stale = [...documented.keys()].filter((id) => !contributed.has(id));
        assert.deepEqual(stale, [], `docs/commands.md rows with no such command: ${stale}`);
    });

    it('lists each command once', () => {
        assert.equal(rows.length, documented.size, 'duplicate id in docs/commands.md');
    });

    it('uses the palette title from package.json', () => {
        for (const [id, row] of documented) {
            assert.equal(row.title, contributed.get(id)?.title, `title for ${id}`);
        }
    });

    it(`marks unbound commands with "${NO_KEY}"`, () => {
        for (const [id, row] of documented) {
            if (bound.has(id)) {
                assert.notEqual(row.key, NO_KEY, `${id} has a default keybinding`);
            } else {
                assert.equal(row.key, NO_KEY, `${id} has no default keybinding`);
            }
        }
    });
});
