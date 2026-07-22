---
id: "feat-283"
title: "Mastra ai-chat lane admission module (flag + lane bearer)"
owner: "jian wei"
priority: "P2"
status: "in-progress"
start_date: "2026-07-22"
duration: 2
depends_on: []
blocks:
  - "feat-247"
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

The ai-chat lane's admission preamble — enable flag → 404, lane bearer → 401,
refusal bodies byte-identical across all three routes — exists as two
implementations in `apps/mastra`: the history list/replay handlers share
`refuseUnlessAdmitted` inside `ai-chat-history-route.ts` and source the lane
CSV in-handler (`readLaneServiceKeys`), while `handleSeekerRouteRequest`
re-implements the same two rungs and has its keys threaded through
`index.ts` (`serviceKeys: seekerServiceKeys`). That caller-side seam means
the pool-vs-lane security invariant — pool keys must never reach conversation
data (feat-250's hard cutover) — is held by two regex source-pins in
`seeker-route-isolation.test.ts`, not by structure. A future lane route
(feat-247) would hand-roll a third implementation.

This ticket is **Ruling 1** of the adjudicated Mastra/Seeker architecture
review. The authoritative spec — numbered requirements, corrections, standing
decisions, amendment protocol, stop-and-report clause — is
`docs/handoffs/2026-07-21-mastra-seeker-architecture-review-rulings.md`. Read
it first in full. Do NOT run `ce-plan`; the handoff doc + this ticket are the
plan.

## Entry Points — Read These First

1. `docs/handoffs/2026-07-21-mastra-seeker-architecture-review-rulings.md` —
   Ruling 1 (the 7 numbered requirements — requirement 1's discriminating
   key-source test is the gate for landing this PR), Correction 4 (why the
   existing default-source test cannot discriminate), and the Standing
   decisions (what stays per-route).
2. `apps/mastra/src/mastra/ai-chat-history-route.ts` —
   `refuseUnlessAdmitted` + `readLaneServiceKeys`: the deeper pattern this
   ticket generalizes; both fold into the new module.
3. `apps/mastra/src/mastra/agents/seeker-route.ts` — gates 1–2 of
   `handleSeekerRouteRequest` (the re-implementation) and its required
   `serviceKeys` input, which becomes a defaulted seam.
4. `apps/mastra/src/mastra/index.ts` — the `/forge-seeker` registration
   passing `serviceKeys: seekerServiceKeys`, and the `seekerServiceKeys`
   const (both go).
5. `apps/mastra/src/mastra/seeker-route-isolation.test.ts` — the two feat-250
   pins being replaced ("threads the lane-only seekerServiceKeys", "derives
   seekerServiceKeys from the ai-chat lane CSV") and the guards that MUST
   stay (route counts, `seekerAgent` literal counts, handler wiring).
6. `apps/mastra/src/config/env.test.ts` — the `vi.stubEnv` +
   `vi.resetModules` + dynamic-import pattern the discriminating test needs
   (`config/env.ts` snapshots `process.env` at module load).
7. `apps/mastra/CLAUDE.md` — the `AI_CHAT_SERVICE_API_KEYS` env-table row and
   the `/forge-seeker` + history-surface sections; update in the same PR.

## Grep These

- `seekerServiceKeys` — the caller-side seam being deleted (index.ts + the
  isolation test's pins)
- `refuseUnlessAdmitted` / `readLaneServiceKeys` — the history-side
  implementation folding into the module
- `isValidServiceBearer` / `parseServiceApiKeys` — the shared primitives the
  module composes (they stay in `server/service-bearer.ts`)
- `Service bearer required` — the 401 refusal body that must stay
  byte-identical
- `AI_CHAT_SERVICE_API_KEYS` — the lane CSV (module default source; env
  table row)
- `assertAiChatServiceKeysDisjoint` — untouched boot invariant (Standing
  decision)

## What To Build

One PR (branch `feat/mastra-ai-chat-lane-admission`).

```ts
// src/mastra/ai-chat-lane-admission.ts (name is the implementer's)
// The two genuinely shared rungs, nothing more (handoff Ruling 1, req 2).
export type AiChatLaneRefusal = { status: 404 | 401; body: { error: string } }

export function refuseUnlessLaneAdmitted({
  authHeader,
  getEnabled = isSeekerRouteEnabled,
  // Key sourcing lives INSIDE the module: default reads the lane CSV
  // (parseServiceApiKeys(env.AI_CHAT_SERVICE_API_KEYS)); injectable for tests.
  getServiceKeys = readLaneServiceKeys,
}: {
  authHeader: string | null | undefined
  getEnabled?: () => boolean
  getServiceKeys?: () => readonly string[]
}): AiChatLaneRefusal | null
```

- All three handlers call it: the history handlers replace
  `refuseUnlessAdmitted`; `handleSeekerRouteRequest` replaces its gates 1–2
  and drops the required `serviceKeys` input (defaulted seam instead).
- `index.ts`: both history registrations unchanged in shape; the
  `/forge-seeker` registration stops passing keys; `seekerServiceKeys` const
  deleted. The slimmed registrations must not add `seekerAgent` or
  `/forge-seeker` literals (isolation-test counts — handoff Ruling 1, req 6).
- `seeker-route-isolation.test.ts`: delete exactly the two feat-250 pins;
  every other guard stays (handoff Ruling 1, req 3).
- **The discriminating key-source test (the PR's gate):** both CSVs set to
  distinct values (`vi.stubEnv` + `vi.resetModules` + dynamic import, per
  `env.test.ts`), then through the module's DEFAULT sourcing path:
  pool-key bearer → 401, lane-key bearer → admitted (null refusal). An
  injected `getServiceKeys` seam does NOT satisfy this — the seam bypasses
  the default source the test exists to pin. Same PR as the pin deletion.
- `apps/mastra/CLAUDE.md`: update the sections this PR invalidates.
- Exact module name, file layout, and whether the history handlers keep
  their own seam params are the implementer's; deviations from what the
  handoff doc SPECIFIES get amendments (see its protocol).

## Constraints

- **Refusal behavior byte-identical:** flag checked before bearer; 404
  `{ error: "Not found" }`; 401 `{ error: "Service bearer required" }`.
- **Scope is flag + bearer only** — the budget→reason mapping and the
  `user:`-prefix 403 stay per-route (the send route admits anon/dogfood
  resources by design).
- **Per-route in-handler validation** (never `/api/*` middleware — breaks
  Studio); the module is a function handlers call.
- `assertAiChatServiceKeysDisjoint` and `server/service-bearer.ts` are not
  moved or modified.
- The wire contracts to `apps/chat` are frozen (SSE frames, history
  projections).
- If the discriminating test cannot be written, STOP and report (handoff
  stop-and-report clause) — do not land the pin deletion without it.
- Flip this ticket `in-progress` (+ lane README row) as the session's first
  act; `complete` + `## Resolution` + README row land in the same PR.

## Verification

- `pnpm --filter @forge/mastra test` / `typecheck` / `lint` green;
  `seeker-route-isolation.test.ts` green with only the two named pins
  replaced; `ai-chat-pg-failmode-contract.test.ts` untouched.
- The discriminating key-source test fails if the module's default is
  hand-edited to the pool CSV (verify by temporarily making that edit
  locally — it must go red).
- Real-service smoke against a locally running Mastra
  (`MASTRA_STORAGE_BACKEND=memory`): flag off → 404; pool bearer → 401; lane
  bearer admitted on `/forge-seeker` + both history routes. The operator's
  implementation prompt supplies the local run/bearer recipe; never kill or
  restart a Mastra instance you didn't start.
- Run `/ce-code-review` before push and resolve the actionable findings
  (auth surface — mandatory Tier-2 trigger).
- PR assigned to `jianwei1`; squash-merge to `main`.
