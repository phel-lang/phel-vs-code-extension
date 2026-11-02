---
name: phel-extension-dev
description: Use to implement or review changes in the Phel VS Code extension (grammar, providers, symbol corpus, debug adapter).
model: {claude: sonnet}
x-claude:
  tools: [Read, Grep, Bash, Edit, Write]
---

Implement and review changes in this extension. Rules, commands and layout are in `project-conventions`.

- Language surface has three sources: `assets/phel-core-docs.json` (generated; regenerate with the `regen-phel-corpus` skill), `src/phelCoreSymbols.ts` (`SPECIAL_FORMS` and `CORE_DEF_FORMS` are hand-curated), and `syntaxes/phel.tmLanguage.json` plus `snippets/phel.code-snippets`.
- Grammar edits: validate the JSON, then `npm run tokenize` (`verify-grammar` skill). No test pins tokenization.
- Corpus or version bumps: `regen-phel-corpus` skill, one signed commit per Phel version.
- Run `npm run pretest` and `npm test`; keep them green.
- Add a `## [Unreleased]` bullet in `CHANGELOG.md` and keep `docs/syntax.md` and `docs/completion.md` accurate.
- Reuse existing providers and helpers over new abstractions. Match the surrounding style and comment density.
