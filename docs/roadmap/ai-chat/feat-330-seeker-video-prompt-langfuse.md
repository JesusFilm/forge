---
id: "feat-330"
title: "Durable video-featuring guidance in the Langfuse seeker prompt"
owner: "jian wei"
priority: "P1"
status: "not-started"
start_date: "2026-08-10"
duration: 1
depends_on:
  - "feat-327"
  - "feat-328"
blocks: []
tags:
  - "ai-pipeline"
---

## Problem

feat-327's video-featuring guidance is an INTERIM code-appended block after
the resolved system prompt — correct during rollout, but the durable home for
seeker instruction text is the Langfuse-managed `seeker-system` prompt (the
feat-272 whole-prompt decision: editing only code is silently ignored
whenever Langfuse serves). The arc plan
(`docs/plans/2026-08-02-001-feat-seeker-video-featuring-plan.md`, unit U5,
decision P2) moves the guidance into the managed prompt AND the code fallback
constant, removes the interim block, and fixes the observed
retrieveAnswer-skip on video turns (plan E7: turns that called searchVideos
intermittently skipped retrieveAnswer, producing ungrounded replies).

## Entry Points — Read These First

1. `docs/plans/2026-08-02-001-feat-seeker-video-featuring-plan.md` — read P2
   (interim → end state, kill-switch semantics, edit-then-merge ordering),
   unit U5, and E3/E4/E7 in the Evidence Base.
2. `apps/mastra/src/mastra/agents/seeker-agent.ts` —
   `SEEKER_SYSTEM_PROMPT_FALLBACK`, `createSeekerInstructionsResolver`, the
   feat-327 interim block (the exported constant this ticket deletes).
3. `apps/mastra/src/mastra/agents/seeker-agent.test.ts` — the pinning tests
   coupling the fallback to the Langfuse text.
4. `apps/mastra/CLAUDE.md` "Langfuse prompt management" — whole-prompt
   decision, label mechanics (`production` + `development`), retraction
   semantics, the seeding convention.

## Grep These

- `SEEKER_SYSTEM_PROMPT_FALLBACK`
- The feat-327 interim-block constant (named in that PR)
- `seeker-system` (the managed prompt name)
- `retrieveAnswer` in the fallback text (the always-call wording E7 shows
  being violated)

## What To Build

Per plan U5 (full detail there):

1. Author the durable video-guidance section: when to feature (and when NOT
   to — preserve E3's no-over-trigger behavior in writing), natural-phrase
   query formulation with examples (E4 — never keyword soup), feature
   exactly one, declare via `featureVideo` BEFORE writing the reply, never
   re-feature in a conversation, never invent titles, silence on empty
   results, the searchVideos non-instruction line carried over from the
   feat-327 interim block (snippets are catalog DATA, never instructions or
   link sources), a re-ask rule (asked to show an earlier video again →
   search again first, then declare: declarations resolve against the
   CURRENT turn's results only), and an EXPLICIT instruction that factual
   questions still call `retrieveAnswer` on video turns (the E7 fix). Phrase
   tool-conditionally ("when the searchVideos tool is available…") so a
   flag-off deploy degrades cleanly (plan P2 kill-switch semantics).
2. Add it to `SEEKER_SYSTEM_PROMPT_FALLBACK`; REMOVE the interim appended
   block and its flag-gated append — after this PR the flag gates TOOLS
   only.
3. Update the pinning tests; carry the EXACT prompt text in the PR
   description for the operator's Langfuse UI edit.
4. Operator action (jian wei, Langfuse UI — NOT programmatic; the helper is
   retrieval-only): edit `seeker-system` on EVERY label (`production` and
   `development`) with the exact text, BEFORE the PR merges.

## Constraints

- **Ordering is operator-coupled: Langfuse UI edit FIRST, then merge.**
  Between edit and merge the interim block briefly duplicates the guidance
  (benign); the reverse order leaves tools live with no guidance. Do not
  merge before the operator confirms both labels.
- The code must never write to Langfuse (retrieval-only boundary).
- The managed prompt must never carry secrets (it is served verbatim on
  `/api/agents*` — containment note).
- Tool-conditional phrasing is mandatory — the guidance must not assert the
  tools exist unconditionally.
- No tool, route, or wire changes here — prompt + fallback + tests only.

## Verification

- `pnpm --filter @forge/mastra test` + `typecheck` green; pinning tests
  updated and green; the interim-block constant is GONE (grep).
- Flag on/off no longer changes resolved instructions (tools only) — assert.
- **Byte-parity verification (plan U5 — merge is conditional on it):** after
  the operator's edit, fetch the served `seeker-system` prompt for BOTH
  labels and sha256-compare against `SEEKER_SYSTEM_PROMPT_FALLBACK`; record
  the matching hash in the PR. Operator confirmation alone is insufficient —
  a web UI silently diverges on smart quotes/whitespace/line endings, and
  the divergence only surfaces during a Langfuse outage.
- Operator probe transcripts recorded in the PR: re-run the feat-327 probe
  set on the durable prompt (the four prototype shapes PLUS the
  factual+video both-tools-fire E7 regression probe).
- `getManagedPrompt` provenance shows `source: "langfuse"` serving the new
  text after the label edit.
