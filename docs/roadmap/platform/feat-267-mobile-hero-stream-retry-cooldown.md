---
id: "feat-267"
title: "Mobile hero stream retry cooldown (idle-Home unbounded retry loop)"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-07-22"
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "mobile"
  - "reliability"
  - "observability"
---

## Problem

An idle mobile Home screen manufactures GraphQL requests indefinitely under
network failure. The hero pager auto-advances; each slide resolves its stream
via `useHeroStream` with `fetchPolicy: "cache-first"`; a failed/aborted query
never populates the Apollo cache, and a failed slide is skipped (the pager
advances) — so rotation degrades into an unbounded, no-backoff retry loop.
On a stalled network the loop is clocked by the 15s `fetchWithTimeout` budget
(each attempt holds a connection the full 15s); in true offline it spins
faster and every failure is a RUM-reported `TypeError("Network request
failed")`; during an admin outage every idle device in the fleet retries
every ~15s. Diagnosed from real Datadog data: one 16-minute idle preview
session produced 258 RUM errors with zero user actions (Jul 15 storm).

## Entry Points — Read These First

1. `docs/solutions/integration-issues/datadog-rum-apollo-abort-error-double-reporting.md` — full diagnosis; "The idle-session amplifier" paragraph and Open Follow-ups are this ticket's spec
2. `apps/mobile/src/hooks/useHeroStream.ts` — `useHeroStream` (per-slide resolution, stale-response guard, `failed` flag the pager skips on) and `prefetchHeroStream` (releases a failed slug for retry in its `.catch`, so it participates in the loop)
3. `apps/mobile/src/lib/apolloClient.ts` — `fetchWithTimeout` (15s budget) for the failure cadence; do not change it here
4. `apps/mobile/src/components/home/HomeHeroPager.tsx` — consumes `HeroStreamState.failed` to skip slides
5. `docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md` — remount-safety law if any hook-lifetime state is added

## Grep These

- `useHeroStream` — all consumers
- `prefetchHeroStream` — prefetch call sites
- `prefetchedSlugs` — the existing module-scope dedupe set (pattern to mirror for the cooldown map)
- `hero_stream.failed` — the existing structured warn emitted per failure

## What To Build

1. A module-scope per-slug failure cooldown in `useHeroStream.ts`: after a
   query for a slug fails, do not re-attempt that slug for a cooldown window
   (start ~60s, exponential backoff per consecutive failure, cap ~10min).
   Within the window, `useHeroStream` returns `failed: true` immediately
   (no network) and `prefetchHeroStream` no-ops for that slug.
2. A first success for the slug clears its cooldown state entirely (the
   Apollo cache then makes later lookups a network no-op, as today).
3. Optional second layer if cheap: after K consecutive distinct-slug failures
   (K ~= 3), latch hero resolution off until app foreground or the next
   cooldown expiry — the pager already knows every slide is failing.
4. Emit one structured log when a cooldown suppresses an attempt
   (`hero_stream.cooldown_skip` with slug + remaining ms) at most once per
   slug per window, so the behavior is observable without being a new flood.

## Constraints

- Module-scope state (mirroring `prefetchedSlugs`), NOT hook-lifetime refs —
  avoids the StrictMode remount trap and keeps `useHeroStream`'s existing
  stale-response guard untouched.
- Do not add `@react-native-community/netinfo` — reachability sensing stays
  deferred (see the observability plan); the cooldown must work from failure
  signals alone.
- Do not change `fetchWithTimeout`, the abort guard in
  `reportGraphqlOperationError`, or the pager's skip-on-fail contract.
- No `Date.now()` stubbing gaps: cooldown expiry logic must be testable with
  jest fake timers.
- Per the mocked-shape META law: every cooldown branch needs a test only IT
  can satisfy (e.g., a test where ONLY the expiry path allows a refetch).

## Verification

- `cd apps/mobile && npx jest src/hooks/useHeroStream` — new fake-timer tests:
  failed slug not refetched within the window; refetched after expiry;
  backoff grows per consecutive failure; success clears state; prefetch
  respects the same cooldown.
- `npx jest && npx tsc --noEmit` — full suite green.
- Simulator smoke (Expo Go against local Metro): boot Home, kill network
  (Mac Wi-Fi off), watch Metro logs — request attempts must stop within one
  cooldown window instead of firing every rotation; restore network and
  confirm the hero recovers on the next attempt.
