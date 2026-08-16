---
name: regen-phel-corpus
description: Sync the extension's symbol corpus and language surface to a Phel release. Use when bumping phel-lang support, "regen docs", "update corpus", or adding support for a new Phel version.
---

# regen-phel-corpus

Bring completion, hover, signature help, and grammar up to a Phel release.

## Inputs

- A local phel-lang checkout (default sibling: `../phel-lang`).
- Target version tag(s), e.g. `v0.41.0`.

## Steps

1. `npm run compile` once (regen needs `out/phelDocs.js`).
2. For each target tag, check out phel-lang at that tag and regenerate:
   ```bash
   npm run regen-docs -- /path/to/phel-lang --phel-version vX.Y.Z
   ```
   This rewrites `assets/phel-core-docs.json`. `MACROS` / `CORE_FNS` /
   `CORE_VALUES` in `src/phelCoreSymbols.ts` follow automatically.
   - phel-lang may carry untracked files (`.claude/`) that block `git checkout`; move them aside and restore after, and return phel-lang to its original branch when done.
3. Diff new vs old corpus to find added public symbols and namespaces. Map each new **special form** (check `src/php/Lang/Symbol.php` `NAME_*` constants) into:
   - `SPECIAL_FORMS` in `src/phelCoreSymbols.ts` (hand-curated — corpus does not cover engine forms).
   - the `corelib` keyword alternation in `syntaxes/phel.tmLanguage.json` (macros/special forms only; plain functions are not highlighted as keywords).
   Each new public `phel.core` symbol defined with a bare `(def …)` needs a line in `CORE_DEF_FORMS` (`macro` / `fn` / `value`) or, when phel marks it `{:private true}` / `^:private`, in `INTERNAL_CORE_DEFS` in `src/test/phelCoreSymbols.test.ts` — the corpus carries neither marker, and that test fails until one of the two lists claims the name.
4. New reader/metadata syntax → add a tmLanguage rule (e.g. `#'` var-quote, `^int` / `^:kw` metadata tags) and a snippet in `snippets/phel.code-snippets` if it is a common form.
5. Verify:
   - `node scripts/tokenize-sample.mjs <sample.phel>` for any grammar change.
   - `npm run pretest && npm test` (must stay green; no test pins corpus counts).
6. Update `docs/syntax.md` (version ref + new forms/highlights) and `docs/completion.md` (symbol counts, snippet table). Add a `## [Unreleased]` CHANGELOG bullet.

## Output

One conventional commit per version when doing multiple (`feat(lang): sync corpus to phel vX.Y.Z, ...`), signed per `project-conventions`. Each commit's corpus is pinned to that tag (`View source` links point at it).
