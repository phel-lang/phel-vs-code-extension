---
name: verify-grammar
description: Verify TextMate grammar changes by tokenizing sample Phel. Use after editing syntaxes/phel.tmLanguage.json, "check highlighting", or "tokenize".
---

# verify-grammar

Confirm a `syntaxes/phel.tmLanguage.json` edit highlights what you expect, using the same `vscode-textmate` + `vscode-oniguruma` engine VS Code ships.

## Steps

1. Validate JSON: the grammar must parse (`tsc`/node `JSON.parse`) — a trailing comma silently breaks all highlighting.
2. Add or extend a case in `scripts/sample.phel` that exercises the construct (new special form, reader macro, metadata tag, tagged literal, reader conditional).
3. Run:
   ```bash
   npm run tokenize                 # default scripts/sample.phel
   node scripts/tokenize-sample.mjs /tmp/case.phel   # ad-hoc file
   ```
4. Check each token maps to the intended scope, e.g.:
   - special forms / macros → `keyword.control.phel`
   - type & metadata tags (`^int`, `^:memoize`) → `storage.type.tagged.phel` + `^` as `punctuation.definition.tag.phel`
   - tagged literals `#inst` → `storage.type.tagged.phel`
   - reader conditionals `#?` → `keyword.other.reader-conditional.phel`

## Gotchas

- `corelib` is one big regex alternation. With the trailing lookahead `(?=\s|\)|\]|\})`, a shorter prefix like `def` will not swallow `defonce`, but keep longest-first ordering for related words anyway.
- The `metadata` rule must sit before `readermac` so a tag beats the bare `^` punctuation rule.
- `tokenize` is a dev/release helper, not part of `npm test`; run it yourself after grammar edits.
