// Guards the menu / submenu / keybinding / walkthrough / configuration wiring in
// `package.json`. VS Code silently drops a menu item whose `command` it cannot
// resolve and a submenu reference whose id was never declared, so a typo here
// costs a whole context menu with nothing in the logs. A setting's `scope` fails
// just as quietly: without it the setting is window-scoped and a folder-level
// value is ignored. Nothing but this test reads those tables.

import * as assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface ContributedCommand {
    command: string;
    title: string;
    icon?: string;
}

interface Submenu {
    id: string;
    label: string;
}

/** A menu row carries either a `command` or a `submenu`, never both. */
interface MenuItem {
    command?: string;
    submenu?: string;
    group?: string;
    when?: string;
}

interface Keybinding {
    command: string;
    when?: string;
}

interface WalkthroughStep {
    id: string;
    title: string;
    description: string;
    media: { markdown?: string; image?: string };
    completionEvents?: string[];
}

interface Walkthrough {
    id: string;
    title: string;
    description: string;
    steps: WalkthroughStep[];
}

/** A contributed setting; `scope` defaults to `window` when absent. */
interface ConfigurationProperty {
    type: string;
    scope?: string;
}

const repoRoot = join(__dirname, '..', '..');

const manifest: {
    contributes: {
        commands: ContributedCommand[];
        submenus?: Submenu[];
        menus?: Record<string, MenuItem[]>;
        keybindings?: Keybinding[];
        walkthroughs?: Walkthrough[];
        configuration?: { properties: Record<string, ConfigurationProperty> };
    };
} = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));

const {
    commands,
    submenus = [],
    menus = {},
    keybindings = [],
    walkthroughs = [],
    configuration = { properties: {} },
} = manifest.contributes;

const commandIds = new Set(commands.map((c) => c.command));
const submenuIds = new Set(submenus.map((s) => s.id));

/** Every `[menu id, item]` pair across `contributes.menus`. */
const menuItems: [string, MenuItem][] = Object.entries(menus).flatMap(([menu, items]) =>
    items.map((item): [string, MenuItem] => [menu, item])
);

/** Codicon reference, e.g. `$(play)`. Icons may also be a light/dark path pair. */
const CODICON = /^\$\([a-z0-9-]+\)$/;

/** Every `[walkthrough id, step]` pair across `contributes.walkthroughs`. */
const walkthroughSteps: [string, WalkthroughStep][] = walkthroughs.flatMap((walkthrough) =>
    walkthrough.steps.map((step): [string, WalkthroughStep] => [walkthrough.id, step])
);

/** A `command:` link in a step description, with the args query stripped. */
const COMMAND_LINK = /\]\(command:([^?)\s]+)/g;

/**
 * Built-in commands a step button is allowed to invoke. Deliberately tiny: a
 * built-in that gets renamed or removed leaves a dead button with no error.
 */
const BUILT_IN_COMMANDS = new Set([
    'workbench.action.openSettings',
    'workbench.view.testing.focus',
]);

describe('package.json contributions', () => {
    it('references only declared commands from its menus', () => {
        for (const [menu, item] of menuItems) {
            if (item.command !== undefined) {
                assert.ok(commandIds.has(item.command), `${menu}: no such command ${item.command}`);
            }
        }
    });

    it('references only declared submenus', () => {
        for (const [menu, item] of menuItems) {
            if (item.submenu !== undefined) {
                assert.ok(submenuIds.has(item.submenu), `${menu}: no such submenu ${item.submenu}`);
            }
        }
    });

    it('gives every menu item exactly one target', () => {
        for (const [menu, item] of menuItems) {
            const targets = [item.command, item.submenu].filter((t) => t !== undefined);
            assert.equal(
                targets.length,
                1,
                `${menu}: expected one of command/submenu, got ${targets}`
            );
        }
    });

    it('fills in every submenu it declares', () => {
        for (const submenu of submenuIds) {
            assert.ok(menus[submenu]?.length, `submenu ${submenu} has no items`);
            assert.ok(
                menuItems.some(([, item]) => item.submenu === submenu),
                `submenu ${submenu} is never referenced from a menu`
            );
        }
    });

    it('labels every submenu', () => {
        for (const submenu of submenus) {
            assert.ok(submenu.label.length > 0, `submenu ${submenu.id} has no label`);
        }
    });

    it('gates every menu item with a non-empty when clause', () => {
        for (const [menu, item] of menuItems) {
            const target = item.command ?? item.submenu;
            assert.equal(typeof item.when, 'string', `${menu}: ${target} has no when clause`);
            assert.ok((item.when as string).length > 0, `${menu}: ${target} has an empty when`);
        }
    });

    it('binds only declared commands', () => {
        for (const binding of keybindings) {
            assert.ok(commandIds.has(binding.command), `no such command ${binding.command}`);
        }
    });

    it('uses codicon references for command icons', () => {
        for (const command of commands) {
            if (command.icon !== undefined) {
                assert.match(command.icon, CODICON, `icon for ${command.command}`);
            }
        }
    });

    it('gives every command an icon it shows outside the palette', () => {
        // `editor/title/run` renders as a button, so an entry without an icon
        // would come up blank.
        for (const item of menus['editor/title/run'] ?? []) {
            const command = commands.find((c) => c.command === item.command);
            assert.ok(command?.icon, `${item.command} appears in editor/title/run without an icon`);
        }
    });
});

// The Getting Started walkthrough fails just as quietly: a button whose command
// does not exist does nothing when clicked, a missing markdown file renders as
// an empty pane, and a step without a completion event never ticks off.
describe('package.json walkthrough', () => {
    it('names a resolvable command in every step button', () => {
        for (const [walkthrough, step] of walkthroughSteps) {
            for (const [, command] of step.description.matchAll(COMMAND_LINK)) {
                assert.ok(
                    commandIds.has(command) || BUILT_IN_COMMANDS.has(command),
                    `${walkthrough}/${step.id}: no such command ${command}`
                );
            }
        }
    });

    it('points every step at markdown that exists', () => {
        for (const [walkthrough, step] of walkthroughSteps) {
            const markdown = step.media.markdown;
            assert.equal(typeof markdown, 'string', `${walkthrough}/${step.id}: no markdown media`);
            assert.ok(
                existsSync(join(repoRoot, markdown as string)),
                `${walkthrough}/${step.id}: missing ${markdown}`
            );
        }
    });

    it('gives every step a way to complete itself', () => {
        for (const [walkthrough, step] of walkthroughSteps) {
            assert.ok(
                step.completionEvents?.length,
                `${walkthrough}/${step.id} has no completionEvents`
            );
        }
    });
});

// A setting with no `scope` is window-scoped, and VS Code then refuses it in a
// folder's `.vscode/settings.json`: the value never reaches `inspect()`, so a
// multi-root workspace where one project has its own binary cannot say so.
describe('package.json configuration scopes', () => {
    /**
     * The settings resolved against a workspace folder — every one of them is
     * read as `getConfiguration('phel', folder)`, so a folder value has
     * somewhere to land. Nothing else may claim `resource`: offering a
     * per-folder value that the read then ignores is worse than not offering it.
     */
    const RESOURCE_SCOPED = new Set([
        'phel.completion.phpInterop',
        'phel.executablePath',
        'phel.lsp.command',
        'phel.lsp.args',
        'phel.diagnostics.command',
        'phel.format.command',
        'phel.test.command',
        'phel.repl.command',
        'phel.repl.args',
        'phel.repl.history.enabled',
        'phel.nrepl.reloadOnSave',
        'phel.nrepl.hoverEval',
    ]);

    /**
     * Read once in `activate` to decide what to register for the whole window.
     * A folder value would arrive too late to change anything.
     */
    const ACTIVATION_GATES = [
        'phel.lsp.enabled',
        'phel.debug.enabled',
        'phel.paredit.enabled',
        'phel.repl.enabled',
        'phel.nrepl.enabled',
    ];

    const settings = configuration.properties;

    it('lets every CLI path be set per folder', () => {
        const paths = Object.keys(settings).filter(
            (key) => key === 'phel.executablePath' || key.endsWith('.command')
        );
        assert.ok(paths.length > 1, 'expected phel.executablePath and the per-command overrides');
        for (const key of paths) {
            assert.equal(settings[key].scope, 'resource', `${key} is not folder-scoped`);
        }
    });

    it('keeps the activation-time toggles window-scoped', () => {
        for (const key of ACTIVATION_GATES) {
            assert.ok(settings[key], `no such setting ${key}`);
            assert.notEqual(
                settings[key].scope,
                'resource',
                `${key} gates registration at activation and cannot be per-folder`
            );
        }
    });

    it('offers a folder value only where one is read', () => {
        const declared = Object.keys(settings).filter((key) => settings[key].scope === 'resource');
        assert.deepEqual(declared.sort(), [...RESOURCE_SCOPED].sort());
    });
});
