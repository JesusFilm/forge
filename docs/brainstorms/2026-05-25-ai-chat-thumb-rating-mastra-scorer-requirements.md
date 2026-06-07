---
date: 2026-05-25
topic: ai-chat-thumb-rating-mastra-scorer
---

# AI Chat Thumb-Rating into the Mastra Scorer System

## Summary

Add thumbs-up / thumbs-down rating to workflow-generated outputs in the admin AI chat panel, with an optional free-text comment on either rating. Persist each rating into Mastra's built-in scores store via `saveScore` against a dedicated `chat-thumb-rating` scorer. v1 is capture-only — review happens in Mastra Studio/Playground, no custom admin dashboard.

---

## Problem Frame

The admin AI chat (`apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`) drives several high-value generation paths: full-page draft, add-section, rewrite-copy, critique, and the new multi-step draft workflow (`apps/admin/src/mastra/workflows/multi-step-draft-workflow.ts`). Each costs real model spend and produces outputs that get accepted, rejected, or quietly redone by the editor.

Today none of that user judgment is captured. There is no way to look at last week's drafts and say "this prompt is regressing" or "users hate the critique step's tone" — the only signal is whether someone hits "Generate full page" again, which conflates "bad output" with "wanted a variation." Without a feedback channel, every prompt change is a guess, and every model swap (cheaper, faster, newer) lacks a baseline to compare against.

Mastra already ships a scorer + scores-store primitive (`createScorer`, `storage.getStore('scores').saveScore`, `listScoresByScorerId`/`ByRunId`/`ByEntityId`) and Mastra Studio renders scored runs out of the box. The cheapest move that creates compounding value is to attach 👍/👎 to ratable outputs and pipe clicks straight into that primitive — capture now, decide downstream uses later when there's real data to look at.

---

## Requirements

**Rating UI**

- R1. The chat panel renders a 👍 / 👎 control next to each assistant turn that contains a **workflow output**: full-page draft, add-section, rewrite-copy, critique-experience, and multi-step draft. Plain chat replies, tool results, and system messages have no rating control.
- R2. Either thumb click opens an optional, single-line free-text comment field on the same turn. Submitting without a comment is allowed and is the expected fast path.
- R3. A user can change their rating at any time — toggle 👍 ↔ 👎, edit the comment, or clear the rating. The most recent click is the current value.
- R4. The rating control reflects the current user's own rating only; if multiple admins rate the same output, each user sees their own state. Aggregates are not shown in v1.
- R5. While a rating save is in flight, the control is non-blocking (optimistic UI) and surfaces a quiet error if the save fails.

**What gets identified**

- R6. Every ratable workflow output is emitted into the chat stream with a stable identifier the client can pass back when rating. The identifier strategy (Mastra `runId`, a per-generation chat-message id used as `entityId`, or both) is decided in planning, but the chosen identifier MUST be queryable in Mastra Studio without manual cross-referencing.
- R7. Each persisted rating records: scorer id (`chat-thumb-rating`), numeric score (`1` for 👍, `0` for 👎), optional comment, rater's admin user id, the workflow output's identifier(s) from R6, and the prompt/agent/workflow name that produced the output.

**Persistence**

- R8. A single `chat-thumb-rating` Mastra scorer is registered at Mastra init as the logical bucket for these scores. It is not invoked as an LLM evaluator — it exists so `listScoresByScorerId('chat-thumb-rating')` returns the full feedback set.
- R9. Rating writes go through `mastra.getStorage().getStore('scores').saveScore(...)`. No parallel Prisma table, no second source of truth.
- R10. Replacing a rating (R3) is implemented either by overwriting the existing score record for `(scorerId, outputId, userId)` or by appending and treating the latest record as truth — chosen in planning. The user-visible semantics is "latest wins" either way.

**Auth & scope**

- R11. Only authenticated admin users can submit ratings. The rater identity comes from the Better Auth session, not from request body.
- R12. The rating endpoint is `apps/admin`-only. No public, mobile, or web exposure.

**Out of scope for v1**

- O1. Custom admin dashboard, filters, charts, or aggregations over ratings — Mastra Studio is the only review surface.
- O2. Feeding ratings into prompt selection, automated regression eval, fine-tuning, or A/B comparison.
- O3. Rating individual blocks/sections within a workflow output — one rating per generated artifact.
- O4. Rating plain chat replies, tool calls, or non-workflow assistant turns.
- O5. Backfilling ratings against historical generations.
- O6. Notifications, threshold alerts, or moderation of comments.

---

## Success Criteria

- An admin user can rate a workflow output 👍 or 👎 with one click, optionally add a comment, and change or clear it later.
- Calling `mastra.getStorage().getStore('scores').listScoresByScorerId({ scorerId: 'chat-thumb-rating' })` returns the captured ratings with rater id, comment, and the identifier needed to find the original generation in Mastra Studio.
- Mastra Studio's scores view shows recent thumb ratings against the originating runs without further engineering.
- A prompt or workflow change can be evaluated by comparing 👍/👎 ratios on `chat-thumb-rating` scores in the windows before and after — even if that comparison is done manually in v1.

---

## Open Questions (resolve in planning)

- Q1. **Identifier strategy (R6).** Use Mastra workflow `runId` only, a per-output chat-message id surfaced as `entityId`, or both? Workflows have a `runId`; agent-only outputs may not surface one as cleanly. Pick the option that keeps Mastra Studio's score → trace navigation one click.
- Q2. **Mutable rating mechanics (R10).** Overwrite-by-key vs append-and-latest-wins. Depends on whether Mastra's `saveScore` exposes an upsert path or requires read-modify-write.
- Q3. **Where ratable outputs are tagged in the stream.** The chat envelope is produced in `experience-ai-chat-envelope.ts` and the multi-step workflow in `multi-step-draft-workflow.ts`. Decide the single seam where "this turn is ratable, here is its id" gets attached.

---

## Dependencies / Assumptions

- A1. The installed Mastra version exposes `storage.getStore('scores').saveScore(...)` and the `listScoresBy*` methods. To be confirmed in planning against `package.json` and `node_modules/@mastra/*`.
- A2. Mastra Studio in this environment can view scores written by the admin's Mastra instance. If Studio is not configured for this stack, R6's "queryable in Studio" success criterion needs an alternative inspection path (e.g. a small CLI or read-only GraphQL query).
- A3. Better Auth session is already available in admin API routes that the rating endpoint will live alongside (consistent with existing chat routes under `apps/admin/src/app/api/experience-chat`).
