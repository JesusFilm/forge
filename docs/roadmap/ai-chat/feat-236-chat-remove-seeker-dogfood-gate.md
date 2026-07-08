---
id: "feat-236"
title: "Remove the chat seeker dogfood gate (public seeker release)"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-09-01"
duration: 2
depends_on:
  - "feat-233"
blocks:
tags:
  - "web"
  - "infrastructure"
---

## Problem

feat-233 gates the real seeker agent behind a per-user LaunchDarkly allowlist
for the dogfood phase. That gate is deliberately phase-scoped scaffolding: the
feat-233 plan's Scope Boundaries say widening beyond a named-person list
requires a different mechanism entirely, so whichever way the dogfood phase
ends, this exact gate does not survive it. This ticket is the removal recipe,
written **in the same PR that shipped the gate** — while the full removal map
(what deletes cleanly, what must NOT be deleted, the ordering hazards) was
still in context. Without it, a future "revert feat-233" session would have to
re-derive that map, and the natural failure mode is reverting the two pieces
that must stay (see Constraints).

**Trigger:** the dogfood phase's explicit widen / iterate / kill decision
(feat-233 plan, Goal Capsule), on the **widen-to-full-public** arm only —
seeker for everyone, anonymous included. The other arms are NOT this ticket:

- **Iterate:** gate stays; this ticket stays open and untouched.
- **Widen to all signed-in users:** NOT a removal — that is rule-based/broader
  gating, which the feat-233 plan (R13, Scope Boundaries) forbids without
  session revocation + a login-time membership gate first. New ticket, new
  mechanism; most of this recipe's delete-list still applies afterward.
- **Kill seeker:** bigger removal (the seeker wiring itself, feat-205/208
  surfaces); this recipe's delete/keep split still identifies the feat-233
  layer within it.

`start_date` is provisional — pegged to the phase-end decision, not a plan.

## Entry Points — Read These First

1. `docs/plans/2026-07-03-002-feat-chat-seeker-ld-flag-plan.md` — the gate's
   plan: Scope Boundaries (why widening ≠ this gate), the Ordering assumption
   (the fail-open rollback hazard this removal inverts), Rollout Runbook
   (steps 1–7 — the teardown below is its mirror).
2. `apps/chat/src/lib/seeker-gate.ts` — the whole decision helper (KTD1: one
   module, exactly two call sites). Primary deletion target.
3. `apps/chat/src/lib/feature-flags.ts` — chat's LD client. Deletable ONLY if
   `chatSeekerDogfood` is still chat's only flag (Grep 2 below).
4. `apps/chat/src/app/api/seeker/route.ts` — the injected `resolveGate` input
   on `handleSeekerProxyRequest`, the gate-order comment, and the ACCESS
   POSTURE header (rewritten a third time by this ticket — see What To Build).
5. `apps/chat/src/lib/conversations.ts` — `gate_denied` in
   `REPLY_FAILURE_REASONS`: removing the union member is the compile-forced
   cleanup lever for every client site (chat-stub.ts mapping, message-list.tsx
   switch).
6. `packages/feature-flags/src/launchdarkly.ts` + `registry.ts` —
   `booleanVariationDetail` STAYS (permanent shared infrastructure;
   `booleanVariation` delegates through it); only the `chatSeekerDogfood`
   registry entry goes.

## Grep These

- `resolveSeekerGate|seeker-gate` — the gate's two call sites (page.tsx,
  seeker route) plus docs references; all must be gone or rewritten.
- `grep -rn "createChatFeatureFlagClient\|chatFeatureFlagClient" apps/chat/src`
  — if anything besides `seeker-gate.ts` consumes the LD client by execution
  time, `lib/feature-flags.ts` and the SDK key STAY; only the gate goes.
- `chatSeekerDogfood|FORGE_CHAT_SEEKER_DOGFOOD_DEFAULT` — registry entry, env
  schema, `.env.example`, tests, docs. All go.
- `gate_denied` — union member, route emit, client mapping, tests. All go
  (typecheck enumerates the sites once the union member is removed).
- `grep -rln '"server-only"' apps/chat/src` — at gate-ship time only
  `lib/feature-flags.ts` + `lib/seeker-gate.ts` import it; if that is still
  true, also delete the vitest alias + `src/__mocks__/server-only.ts`.
- `emailVerified` — do NOT delete (Constraints); grep is to confirm nothing
  else grew a dependency that this removal would orphan.
- `grep -rni 'gate authoriz\|carve-out\|dogfood' apps/chat/ CONCEPTS.md` — the
  docs re-amendment map (What To Build step 4).

## What To Build

Ordered; step 0 is a hard precondition, not part of this PR.

**0. Rate/concurrency cap lands FIRST (separate ticket — see Constraints).**
Removing the gate without it re-creates feat-205's original accepted risk —
each turn a ~90s paid generation, now deliberately public, with feat-208's
anonymous storage-flood caveats live. The cap ticket does not exist yet; the
phase-end decision creates it. Add it to this ticket's `depends_on` when it
exists (ai-chat side only if it lands in a rendered lane, per this lane's
one-way cross-boundary rule).

**1. Delete (with re-verify greps above):**

- `apps/chat/src/lib/seeker-gate.ts` + `seeker-gate.test.ts`
- `apps/chat/src/lib/feature-flags.ts` + `feature-flags.test.ts` — conditional
  on Grep 2 (no other flag consumer)
- `apps/chat/src/app/api/seeker/route.gate-wiring.test.ts` + the gate cases
  added to `route.test.ts` (AE2/AE4 deny-matrix cases)
- `chatSeekerDogfood` entry in `packages/feature-flags/src/registry.ts`
- `LAUNCHDARKLY_SDK_KEY` + `FORGE_CHAT_SEEKER_DOGFOOD_DEFAULT` from
  `apps/chat/src/config/env.ts`, its tests, and `apps/chat/.env.example`
  (conditional on Grep 2 for the SDK key)
- `@forge/feature-flags` from `apps/chat/package.json` (conditional on Grep 2)
  - lockfile regen
- vitest `server-only` alias + `apps/chat/src/__mocks__/server-only.ts` —
  conditional on the server-only grep

**2. Revert (compile-forced where possible):**

- Route: drop the `resolveGate` member from `SeekerProxyHandlerInput`; restore
  kill-switch-only gating (the pre-feat-233 shape: `enabled:
isSeekerChatEnabled()` on `SeekerProxyConfig`, checked ahead of
  `config_missing` — see feat-205 plan / route.ts git history).
- Page: `seekerEnabled={isSeekerChatEnabled()}` in `page.tsx`; keep
  `force-dynamic` (load-bearing for env + identity reads regardless).
- Client: remove `"gate_denied"` from `REPLY_FAILURE_REASONS`, then follow the
  compiler — the exhaustive switch in `message-list.tsx` and the stub mapping
  in `chat-stub.ts` (`streamSeekerReply`) fail typecheck until cleaned.

**3. Keep — do NOT revert (the pieces a naive full-revert gets wrong):**

- `booleanVariationDetail` + `evaluateFlagDetail` + their types and tests in
  `packages/feature-flags` — permanent, backward-compatible shared
  infrastructure; `booleanVariation` delegates through it; web can adopt it.
- The `emailVerified` claim threading (`oauth-client.ts`, `session-cookie.ts`,
  callback route, `ChatIdentity`, + tests) — additive, harmless, and any
  future per-user feature needs it again.
- `SEEKER_CHAT_ENABLED` and `isSeekerChatEnabled()` — the pre-feat-233
  service-wide kill switch; it becomes the sole gate again.

**4. Docs re-amendment (U6 in reverse — skipping this leaves the docs lying
about the security posture):**

- `apps/chat/src/auth/identity.ts` JSDoc — carve-out language reverts to
  display-only (no per-user decisions).
- `apps/chat/src/auth/anon-id.ts` — comparison comment reverts.
- `apps/chat/src/app/api/seeker/route.ts` header — third rewrite: inbound
  per-user gate REMOVED by design; the rate cap (step 0) is now the documented
  spend bound.
- `apps/chat/CLAUDE.md` — the feat-233 mentions across Architecture,
  Mastra Connection, Authentication, Intentionally Absent, and Development
  (local dogfood recipe reverts to env-var-only).
- `CONCEPTS.md` "Seeker Dogfood Gate" section (~line 430) — mark retired,
  pointing here.
- Registry description gone with the entry (step 1).

**5. Operator teardown (dashboard/Railway work — NOT claimable from a merged
PR; check off separately):**

- LaunchDarkly: archive the `forge.chat.seekerDogfood` flag; decommission the
  dedicated chat LD environment if Runbook step 1 created one; disband the R16
  targeting-write operator group.
- Railway (chat service): remove `LAUNCHDARKLY_SDK_KEY` (if Grep-2-conditional
  deletion happened); confirm `FORGE_CHAT_SEEKER_DOGFOOD_DEFAULT` was never
  set. Sequencing is forgiving in this direction: leftover vars are inert once
  the code stops reading them (all `.optional()`), and an archived flag would
  only ever serve the fail-closed fallback.
- Discard the KTD8 sub↔email dogfooder mapping record (wherever the flip owner
  homed it).
- Re-run the exposure check in
  `docs/solutions/auth/public-repo-oauth-seed-railway-domain-exposure-calculus.md`
  — required at any widening, and public release is the maximal widening.

## Constraints

- **Step 0 is non-negotiable.** No merge of the gate-removal PR before a
  per-caller rate/concurrency cap is live on `/api/seeker`. The feat-233 plan
  accepted the missing cap ONLY for a hand-picked roster with the R15 grant
  log as compensating control; public release removes both the roster and the
  log's usefulness as a bound.
- **This ticket is the widen-to-public arm only.** Do not repurpose it to
  widen the gate to "all signed-in users" — that path requires session
  revocation + a membership gate first (feat-233 plan R13/Scope Boundaries)
  and is a different feature.
- **Keep-list is binding** (What To Build step 3): `booleanVariationDetail`,
  the `emailVerified` threading, and `SEEKER_CHAT_ENABLED` survive. A wholesale
  `git revert` of the feat-233 PR is the wrong move.
- Written 2026-07-07, alongside the gate PR. The dogfood phase will move the
  code underneath this recipe (rate-cap ticket reshaping the route, feat-209
  touching `conversations.ts`, chat possibly adopting a second LD flag —
  which flips the Grep-2-conditional deletions to KEEP). The greps are the
  source of truth, not the file list.

## Verification

- `grep -rn "resolveSeekerGate\|chatSeekerDogfood\|gate_denied\|FORGE_CHAT_SEEKER_DOGFOOD_DEFAULT" apps/chat/src packages/feature-flags/src` → empty.
- `pnpm --filter @forge/chat test`, `typecheck`, `lint` green (typecheck green
  is the proof the union removal was followed to every client site).
- `pnpm --filter @forge/feature-flags test` green with the detail variant
  suite INTACT (proves the keep-list held).
- Deployed walk: anonymous visitor and a signed-in user both stream real
  seeker replies; `[seeker-gate]` lines no longer appear in Railway logs; the
  rate cap observably enforces (per its own ticket's verification).
- Operator checklist (What To Build step 5) confirmed by the flip owner.
