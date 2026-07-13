---
id: feat-240
title: "Admin fleet search key provisioning + rollout preconditions"
owner: urim
priority: P1
status: not-started
start_date: "2026-07-09"
duration: 3
depends_on: []
blocks:
  - feat-241
tags:
  - search
  - infrastructure
  - tv
  - mobile
---

## Problem

TV and mobile search returns `401 UNAUTHENTICATED` on TestFlight/production: admin's
`SEARCH_AUTH_REQUIRED` gate is active but the clients ship no consumer bearer, because
provisioning it was embargoed (every install carries the same baked-in key, and admin
bucketed a consumer bearer flat as `consumer:<key>`, so provisioning would collapse the
whole fleet into one 60/min bucket). PR #1493 ships the admin per-IP fleet-bucketing
(`consumer:<key>:<ip>`) that removes the self-DoS risk — but a fleet token still must NOT
ship until admin lands two blocking preconditions and mints the dedicated fleet keys. This
ticket is the admin-side rollout; feat-241 is the client side.

**Admin-owner handoff:** the steps below (Cloudflare AOP, edge/global rate-limit, `forge-admin`
Doppler, admin deploy) are the admin CMS owner's to execute. `owner: urim` here tracks
coordination of the end-to-end search unblock, not admin ownership.

## Entry Points - Read These First

1. `docs/plans/2026-07-08-002-feat-admin-fleet-aware-rate-limit-bucketing-plan.md` - the plan;
   see Key Flow F1 (rollout) and its two blocking preconditions.
2. `apps/admin/CLAUDE.md` - section "Fleet-aware rate-limit bucketing (apps/tv + apps/mobile)":
   deploy ordering, F1 preconditions, disjointness, abuse-incident runbook.
3. `apps/admin/src/graphql/plugins/rate-limit.ts` - `getTrustedClientIp` (cf-connecting-ip only)
   and the fleet branch that R8's unspoofability depends on.
4. `apps/admin/src/config/env.ts` - `FLEET_ADMIN_API_KEYS` in `BEARER_CSV_KEYS` +
   `assertBearerCsvsDisjoint` (a reused value fails admin boot).
5. `forge-admin` Doppler project - where `FLEET_ADMIN_API_KEYS` is set.

## Grep These

- `FLEET_ADMIN_API_KEYS`
- `getTrustedClientIp`
- `cf-connecting-ip`
- `source=fleet`
- `assertBearerCsvsDisjoint`

## What To Do

1. **AOP precondition (blocking).** Confirm Cloudflare Authenticated Origin Pulls is enforced
   on the admin service AND the raw `*.up.railway.app` origin is unreachable/403 — probe and
   record the result. R8's `cf-connecting-ip` unspoofability rests entirely on this.
2. **Abuse-ceiling precondition (blocking).** Land a real per-fleet-key ceiling on the search
   path: a Cloudflare edge rate-limit keyed on the fleet bearer, or an app-level global
   per-fleet-key counter, with anomaly alerting. Per-IP alone does not bound an attacker
   rotating IPs with the bundle-extractable key.
3. **Mint keys.** Generate a dedicated fleet key per surface (`openssl rand -base64 32`, one
   for TV, one for mobile — never share). Add them to `FLEET_ADMIN_API_KEYS` in `forge-admin`
   Doppler, disjoint from every other bearer CSV.
4. **Deploy admin receiver-first** — the keys must be live in admin BEFORE feat-241 sets the
   EAS token, or the clients' first calls 401. Hand the key values to the TV/mobile owner over
   a secure channel for feat-241.

## Constraints

- Do NOT provision any fleet token (feat-241) until both preconditions (1) and (2) are done.
- Receiver-first: admin deploys the keys before the clients ship them.
- Fresh, unique key values only — a value shared with another bearer CSV fails admin boot
  (fail-fast, redacted); it is a new deploy-time failure mode to expect if misconfigured.
- These are admin-owned actions; coordinate the handoff, do not edit admin without the owner.

## Verification

1. Anonymous `SemanticSearch` against admin still returns `401 UNAUTHENTICATED`.
2. A request carrying a minted fleet key returns `200` and logs `auth=bearer source=fleet` in
   the per-request search log, bucketing `consumer:<key>:<ip>`.
3. Admin boots cleanly (the disjointness invariant passes with the new keys).
4. The edge/global abuse ceiling is active and alerting on anomalous fleet-key volume.
