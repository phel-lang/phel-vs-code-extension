---
name: regen-phel-corpus
description: Use to bump support to a new Phel release, "regen docs", "update corpus", or sync the symbol corpus and grammar with phel-lang.
---

# regen-phel-corpus

Inputs: a phel-lang checkout (default sibling `../phel-lang`) and the target tag(s), for example `v0.41.0`.

1. `npm run compile` once (regen needs `out/phelDocs.js`).
2. For each tag, check out phel-lang at it and run `npm run regen-docs -- /path/to/phel-lang --phel-version vX.Y.Z`. This rewrites `assets/phel-core-docs.json`; `MACROS`, `CORE_FNS` and `CORE_VALUES` follow. Untracked files in phel-lang (`.claude/`) can block `git checkout`: move them aside, restore them, and return phel-lang to its original branch.
3. Diff the new corpus against the old to find added public symbols and namespaces. For each new special form (see the `NAME_*` constants in `src/php/Lang/Symbol.php`), add it to:
   - `SPECIAL_FORMS` in `src/phelCoreSymbols.ts`;
   - the `corelib` keyword alternation in `syntaxes/phel.tmLanguage.json` (macros and special forms only; plain functions are not keywords).
   Each new public `phel.core` symbol defined with a bare `(def ...)` needs a `CORE_DEF_FORMS` line (`fn` or `value`); `src/test/phelCoreSymbols.test.ts` fails until it has one.
4. New reader or metadata syntax: add a tmLanguage rule (`#'` var-quote, `^int` / `^:kw` tags) and, for a common form, a snippet in `snippets/phel.code-snippets`.
5. Verify: `node scripts/tokenize-sample.mjs <sample.phel>` for grammar changes, then `npm run pretest && npm test`. No test pins corpus counts.
6. Update `docs/syntax.md` (version reference, new forms) and `docs/completion.md` (symbol counts, snippet table). Add a `## [Unreleased]` bullet to `CHANGELOG.md`.

With several versions, make one signed commit per version (`feat(lang): sync corpus to phel vX.Y.Z, ...`), each with its corpus pinned to that tag (the `View source` links point at it).
