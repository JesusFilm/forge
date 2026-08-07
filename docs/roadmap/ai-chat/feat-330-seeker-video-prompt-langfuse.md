---
id: "feat-330"
title: "Durable video-featuring guidance in the Langfuse seeker prompt"
owner: "jian wei"
priority: "P1"
status: "complete"
start_date: "2026-08-10"
duration: 1
depends_on:
  - "feat-327"
  - "feat-328"
blocks: []
tags:
  - "ai-pipeline"
---

## Resolution

**Shipped:** 2026-08-06 via [PR #PR_NUMBER](https://github.com/JesusFilm/forge/pull/PR_NUMBER) (`feat(mastra): durable seeker video guidance in the managed prompt (ai-chat feat-330)`). Final PR of the five-PR arc: [#1813](https://github.com/JesusFilm/forge/pull/1813) (feat-326) → [#1820](https://github.com/JesusFilm/forge/pull/1820) (feat-327) → [#1832](https://github.com/JesusFilm/forge/pull/1832) (feat-328) → feat-329 → this one.

**What landed.** The video-featuring guidance moved out of feat-327's interim code-appended block and into the durable prompt — the Langfuse-managed `seeker-system` text, with `SEEKER_SYSTEM_PROMPT_FALLBACK` carrying the PR-reviewed rollback copy. `SEEKER_VIDEO_INSTRUCTIONS_BLOCK` and its flag-gated append are deleted, so `SEEKER_VIDEO_ENABLED` now gates the TOOLS only and a flag flip cannot change what `/api/agents*` serves (asserted as a cross-file invariant: the flag-off suite and the flag-on suite each pin resolved instructions against the same constant). Two deviations from the brief, both owner decisions taken during the work: **byte-parity was dropped as a concept** — the fallback is outage continuity plus reviewed rollback text, not a mirror of the managed prompt, and no standing match requirement exists in either direction — and the **rollout stayed edit-first**, with the window in which the old deployed code still appends its superseded block after the new managed text accepted as a knowingly contradictory overlap at dogfood scale rather than bracketed by a flag flip. The narration rule also gained a split the brief did not anticipate (see the candidate-D note below).

**E7 before/after.** Baseline was roughly 2 of 3 video-searching turns skipping `retrieveAnswer` (operator dogfooding, 2026-08-04). After the durable prompt: **0–8% across three independent probe runs** — implementer 12 video turns / 1 skip, independent reviewer 5 turns / 0 skips, final probe2 run 7 turns / 0 skips. Skips are counted from the route's own `video_turn_missing_retrieval` log, not from `grounded`: two reviewer turns and one probe2 turn showed `grounded=false` caused by `rag_retrieval_unavailable reason=timeout` — a RAG-side outage the model disclosed honestly rather than a skip. The named re-ask probe ("show me that video again") now re-searches in-turn and **attaches a real player**, closing feat-327's recorded re-ask limitation at the instruction level (the route's declaration union remains turn-scoped).

**Injection-guard governance.** The searchVideos non-instruction line is now inside the managed text, so it deliberately shares the SAFETY line's governance posture — bounded by the small label-move roster and the PR-reviewed fallback as known-good rollback text, not by code. A weaker, code-owned echo survives in the `searchVideos` tool description (`src/mastra/tools/seeker-search-videos.ts`), unreachable by any Langfuse editor; it is a backstop, not a replacement. No standing check watches the managed copy. **feat-272 item 5's version/source span stamping now inherits the drift-visibility role byte-parity provided in principle**, for the tuned text and this guard line specifically.

**Candidate-D note.** A prompt that both bans search narration and requires honesty resolves toward honesty — probing showed the model narrating "I've looked through the video library, but…" against an outright ban. The final text splits the rules by whether the seeker asked (unasked + nothing usable → silence; asked → an honest brief decline, never tool names, query text, or result counts). Recorded in the test comments and `apps/mastra/CLAUDE.md`; deliberately no `docs/solutions/` entry — one observation on one model family is too thin an evidence base.

**Compound docs.** Two existing entries extended: [`mocked-shape-vs-real-contract-discipline-20260506.md`](../../solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md) — prevention-checklist item 10 (anchor both ends of a whole-region verbatim pin; containment is neither equality nor adjacency) plus its worked-instance row; and [`mechanism-retirement-docs-prose-sweep.md`](../../solutions/workflow-issues/mechanism-retirement-docs-prose-sweep.md) — the retirement prose sweep extended to `*.ts` comment prose, with the key-not-just-the-glob correction and `config/env` flag docstrings named as the starting surface for flag-gated retirements.

**Residual risk / follow-ups.** No standing check watches the Langfuse-managed copy — accepted; detection follow-up is feat-272 item 5 (version/source span stamping), tracked in [feat-272](feat-272-seeker-langfuse-managed-prompt-integration.md).

**Unblocked.** None — this closes the arc.

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
  > **Correction (owner, 2026-08-06):** edit-first stands, but "benign" is
  > wrong. In that window the agent serves the NEW managed text with the OLD
  > interim block appended AFTER it — a CONTRADICTORY overlap, not a
  > duplicate: the old block's absolute "never feature a video you have
  > already featured earlier in this conversation" lands last, while the new
  > text permits exactly that on an explicit re-ask. Accepted as trivial at
  > dogfood scale; merge-first remains unacceptable.
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
  > **Dropped (owner, 2026-08-06):** the sha256 byte-parity gate is NOT
  > adopted and merge is not conditional on it. The fallback is not a mirror
  > of the managed prompt — it is the PR-reviewed rollback copy, and the
  > managed prompt is maintained independently (feat-272's original intent).
  > No standing match requirement exists in either direction; at landing the
  > operator verifies the Langfuse edit landed as intended.
- Operator probe transcripts recorded in the PR: re-run the feat-327 probe
  set on the durable prompt (the four prototype shapes PLUS the
  factual+video both-tools-fire E7 regression probe).
- `getManagedPrompt` provenance shows `source: "langfuse"` serving the new
  text after the label edit.
