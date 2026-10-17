---
module: "Studio external agents"
tags: ["mcp", "skills", "contracts", "shorts"]
problem_type: "integration_issue"
---

# Portable authoring skills need executable domain examples

An actual Codex MCP editing run invented JSON Patch (`op: replace`, `path: /title`)
for `shorts.apply` and received an invalid-input error. Repeating a prose instruction
to “use MCP” would not fix the missing contract knowledge. The successful retry
used the real domain operation `{ "kind": "set-metadata", "title": "..." }`.

`skills/shorts-creator/` now ships small command examples and a focused authoring
reference. Manager's `portable-skill.test.ts` parses these examples against the
actual MCP registry; Admin's equivalent test executes composition and feedback
through `applyOperations`. The latter catches semantic hazards that schema-only
checks miss: `set-text` also changes existing speech, so intentional distinct
narration needs a following `set-speech`. It also verifies human timing, title,
style and unrelated music survive the feedback delta.

Skill ZIPs can become stale when formatting hooks change Markdown or JSON after
packaging. Run `pnpm --filter @forge/manager skill:package` after formatting, and
`skill:check` after commit hooks. Record the archive hash used in actual-client
qualification. Deterministic ZIP bytes and successful extraction outside the
checkout establish portability; they do not establish agent behavior. Real
brief-to-render-to-feedback qualification must load that shipped skill, without
operation coaching that conceals a missing instruction.

Keep references package-relative, OAuth account-based, and server identities
runtime-discovered. Template digests and source IDs are illustrative, never
usable catalog identities. A client that cannot expose MCP image blocks has a
text-only inspection limitation even when the server produced JPEG evidence.
