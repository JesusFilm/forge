---
title: "Use source-neutral episode roots and server receipt time for recent playback"
date: "2026-09-15"
category: "logic-errors"
module: "Admin recommendation recent context"
problem_type: "logic_error"
component: "service_object"
symptoms:
  - "Profile candidates can repeat directly watched videos without recency suppression"
  - "Accepted buffered starts disappear when client timestamps precede episode issuance"
root_cause: "scope_issue"
resolution_type: "code_fix"
severity: "medium"
tags: [recommendations, playback, profiles, recency, clock-skew, postgres]
---

# Source-neutral recent playback history

## Problem

Profile learning accepts qualified episodes from every discovery source, but the
below-player recent-context reader joined starts only through recommendation
requests. Direct/search/editorial playback could influence interest retrieval
without receiving the corresponding recency preference.

## Symptoms

- Started videos with a null recommendation request were absent from recent
  context, even when the active profile authorized their sessions.
- A draft repair compared client `occurred_at` against server episode creation.
  That excluded valid starts buffered while context issuance was still pending.

## What Didn't Work

Joining more recommendation requests cannot recover source-neutral episodes.
Equating qualification with completion also misdiagnoses legitimate continuation
or deterministic refill. Comparing a browser timestamp directly with server
creation time is inconsistent with the capability's accepted clock allowance.

## Solution

`apps/admin/src/services/recommendations/recent-context.service.ts` resolves the
existing authorized session scope, then independently reads at most 32 episodes
per session before joining playback facts. It merges observed starts with the
bounded selection/serve history by video ID.

Episode creation remains fenced by authorization start, current profile privacy
generation, the seven-day window and expiry. Conflicted episodes and late facts
are excluded. Start recency and ordering use server `received_at`; ingestion has
already verified the event against its episode capability, including the bounded
client-clock allowance. A playback attempt alone is not a start.

The additive `(session_digest, created_at DESC, id DESC)` index supports bounded
episode lookup without scanning unrelated viewers. The concurrent migration is
tested through Prisma's full migration path. No new identity or retained history
table is introduced.

## Why This Works

Both learning and recency now understand playback without recommendation lineage.
The authorization boundary remains the server-issued episode and active profile
link, while server receipt time avoids rejecting valid queued browser events.
The final composer still decides whether recent videos can refill a sparse row.

## Prevention

- Test direct, search and recommendation origins against real PostgreSQL.
- Include pre-link, expired, reset, foreign-session, conflicting and late evidence.
- Test buffered starts and client clocks ahead of or behind the server; do not
  repeat token timestamp validation with stricter downstream assumptions.
- Bound roots before joining facts, and inspect the actual query plan with many
  unrelated episodes. An output `LIMIT` alone does not bound the expensive join.
- Distinguish a recent-start preference, qualified viewing, completion and an
  explicit reaction. An immediate exit has unknown preference meaning.
- Inspect actual rejected-stage reason codes; a composed position movement alone
  is not proof of prior suppression.

## Related Issues

- [Source-free profile and curated reserve boundaries](../architecture-patterns/source-free-recommendations-profile-first-curated-reserves-20260910.md).
- [Implementation verification](../../operations/recommendation-quality-validation-2026-09-15.md).
- `apps/admin/src/services/recommendations/recent-context.db.test.ts` contains the
  origin, authorization, clock and query-plan regression coverage.
