#!/usr/bin/env node
//
// Fail CI when the `## [Unreleased]` section in CHANGELOG.md exists but has
// no bullets, or when it's missing entirely. Releases bump the Unreleased
// header to a version, so we leave that case alone — `release.sh` is
// responsible for re-creating an empty Unreleased on the next iteration.

const fs = require('node:fs');
const path = require('node:path');

const file = path.resolve(__dirname, '..', 'CHANGELOG.md');
const text = fs.readFileSync(file, 'utf-8');
const lines = text.split(/\r?\n/);

let inUnreleased = false;
let bullets = 0;
let foundUnreleased = false;

for (const line of lines) {
    if (/^##\s+\[Unreleased\]/i.test(line)) {
        inUnreleased = true;
        foundUnreleased = true;
        continue;
    }
    if (inUnreleased) {
        if (/^##\s/.test(line)) break;
        if (/^\s*-\s+\S/.test(line)) bullets++;
    }
}

if (!foundUnreleased) {
    console.error(
        'CHANGELOG.md is missing a `## [Unreleased]` section. Add one (even empty) so future PRs have somewhere to land notes.'
    );
    process.exit(1);
}

if (bullets === 0) {
    console.error(
        'CHANGELOG.md `[Unreleased]` section has no bullets. Add a one-line entry under the appropriate heading (Added / Changed / Fixed / Settings).'
    );
    process.exit(1);
}

console.log(`CHANGELOG.md [Unreleased] OK (${bullets} bullet${bullets === 1 ? '' : 's'}).`);
