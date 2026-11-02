---
name: verify-grammar
description: Use after editing syntaxes/phel.tmLanguage.json, or for "check highlighting" and "tokenize".
---

# verify-grammar

1. Check the grammar parses (`JSON.parse`). A trailing comma silently breaks all highlighting.
2. Add or extend a case in `scripts/sample.phel` that exercises the construct (special form, reader macro, metadata tag, tagged literal, reader conditional).
3. Run `npm run tokenize` (default `scripts/sample.phel`) or `node scripts/tokenize-sample.mjs /tmp/case.phel`.
4. Check each token has the intended scope:
   - special forms and macros: `keyword.control.phel`
   - type and metadata tags (`^int`, `^:memoize`): `storage.type.tagged.phel`, with `^` as `punctuation.definition.tag.phel`
   - tagged literals (`#inst`): `storage.type.tagged.phel`
   - reader conditionals (`#?`): `keyword.other.reader-conditional.phel`

Gotchas:
- `corelib` is one regex alternation with a trailing lookahead `(?=\s|\)|\]|\})`, so `def` does not swallow `defonce`. Still keep related words longest-first.
- The `metadata` rule must sit before `readermac`, or the bare `^` rule wins.
- `tokenize` is not part of `npm test`; run it yourself.
