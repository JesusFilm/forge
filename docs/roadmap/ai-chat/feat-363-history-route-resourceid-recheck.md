---
id: "feat-363"
title: "Chat history read path: client-side re-check of the resourceId filter"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-08-24"
duration: 1
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

`apps/mastra/src/mastra/ai-chat-history-route.ts` (feat-241) passes
`filter: { resourceId }` to the same `listThreads` store surface that feat-337
hardened, and projects the returned rows straight to the wire with NO
client-side re-check. That store-side filter is a dependency-interpreted
predicate: if a `@mastra/*` bump makes it inert (drops the filter arg, renames
it, stops applying it), the listing returns other subjects' rows and the route
serves another user's thread titles to a signed-in caller. Every mocked test
implements the filter as exact-match by construction, so CI cannot detect the
drift — the exact shape of feat-337 PR 1's P1 finding, found on this route
during that PR's review (2026-08-13) and deliberately left out of its scope.

The replay path is already guarded: `resolveOwnedExistingThread` re-reads the
thread by id and compares the owner. The gap is the LISTING only.

## Entry Points — Read These First

1. `docs/solutions/best-practices/single-upstream-predicate-bounding-irreversible-blast-radius-20260812.md`
   — the trigger condition, the two re-check shapes, and the reject-vs-skip
   discriminator this route must apply.
2. `apps/mastra/src/mastra/ai-chat-history-route.ts` — the listing handler:
   `filter: { resourceId }` → field-by-field wire projection.
3. `apps/mastra/src/mastra/ai-chat-erasure.ts` — the collect-time re-check to
   mirror (the `filter_mismatch` fail-closed shape).
4. `apps/mastra/CLAUDE.md` → "ai-chat history read surface (feat-241)" — the
   gate ladder and projection contract the fix must not disturb.

## Grep These

- `filter: { resourceId }` in `src/mastra/` — every consumer of the store-side
  predicate (the erasure module and this route are the two known ones)
- `filter_mismatch` — the erasure module's fail-closed reason shape

## What To Build

A per-row client-side re-check in the history listing: a row whose own
`resourceId` does not exactly equal the authenticated resource is never
projected to the wire. Posture per the learning doc's discriminator — this is
a read path, so the lean is drop-the-row plus a loud enum log
(`event=history_filter_mismatch count=N`), not a hard request failure; a
hard-fail variant is defensible, and whichever is chosen should be recorded
against the learning doc's discriminator section. A row with an absent or
unreadable `resourceId` counts as a mismatch (fail closed on disclosure).

## Constraints

- No wire-shape change: the projection stays `{ id, title, updatedAt }`.
- Enum/count-only logging (house rule) — never a thread title or resource key.
- Do not touch the gate ladder or the replay path.

## Verification

- Unit: a listing response carrying a foreign-resource row → that row absent
  from the wire, mismatch counted in the log line; an all-foreign response →
  empty page plus the loud log; a row lacking `resourceId` → treated as
  foreign.
- Existing `ai-chat-history-route` suite stays green;
  `pnpm --filter @forge/mastra test -- ai-chat-history-route`.
