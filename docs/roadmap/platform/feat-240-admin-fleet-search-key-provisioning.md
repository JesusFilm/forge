---
id: feat-240
title: "Admin fleet search key provisioning + rollout preconditions"
owner: urim
priority: P1
status: in-progress
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

> **Status 2026-07-16:** Preconditions #2–#4 DONE — abuse ceiling shipped (PR #1577, `enforce=false`),
> two distinct fleet keys minted in `forge-admin` Doppler + admin deployed, fleet requests verified `200`
> with `source=fleet`. Alerting monitors added as code (PR #1591, `infra/datadog-monitors/`) but NOT yet
> created in Datadog (operator runs `create.sh`). **Precondition #1 (origin bypass) RE-CONFIRMED OPEN
> 2026-07-16** — `forgeadmin-production-f4d1.up.railway.app/api/graphql` still returns `200`
> (`server: railway-hikari`, no `cf-ray`); it is the sole remaining blocker (tracked in `todos/021`),
> and the admin CMS owner has committed to closing it. REMAINING: close the origin bypass, calibrate +
> flip `FLEET_SEARCH_CEILING_ENFORCE=true`, confirm `SEARCH_AUTH_REQUIRED=true`, and run `create.sh`.
>
> **Pre-flight (2026-07-14, re-verified 2026-07-16):** no in-repo caller depends on the raw origin, so
> removing the public `*.up.railway.app` domain remains the lowest-blast-radius fix — step 1 stands as
> written. The runbook's auth-CNAME warning (feat-105's `auth.jesusfilm.org` → f4d1) is **FALSE and
> must not be acted on**: that domain moved to the standalone `@forge/auth` service on 2026-05-12 and
> now serves `{"service":"forge-auth"}` — feat-105's line-135 CNAME prose predates the split. Runbook
> (read with that correction): `docs/handoffs/2026-07-14-feat-240-fleet-search-origin-preflight.md`.

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

1. **Close the origin bypass (blocking) — CONFIRMED OPEN 2026-07-13; active remediation, not a probe.**
   Empirical finding: `https://forgeadmin-production-f4d1.up.railway.app/api/graphql` returns `200`
   directly (`server: railway-hikari`, no `cf-ray`) — the raw Railway origin is reachable, bypassing
   Cloudflare. So `cf-connecting-ip` is spoofable on that path and any Cloudflare-edge protection is
   skippable; R8's whole trust basis is void until this is closed. With an extractable fleet key +
   this bypass, an attacker rotates `x-viewer-id`/`cf-connecting-ip` against the origin for unlimited
   free `Query.search` (cost + availability abuse). MUST close before any fleet token ships.
   - **Fix (lowest blast radius): remove/lock the generated `*.up.railway.app` public domain** on the
     admin Railway service, keeping only the Cloudflare-fronted custom domain (`admin.jesusfilm.org`).
     If that URL is load-bearing for Cloudflare's origin, instead enforce mTLS Authenticated Origin
     Pulls, or a Cloudflare-injected secret header that admin requires.
   - **Preserve legit callers — block ONLY the public origin.** Web SSR reaches admin over the PRIVATE
     Railway network (`forgeadmin.railway.internal`); manager + TV/mobile use Cloudflare
     (`admin.jesusfilm.org`). Neither uses the public `*.up.railway.app`, so removing it is safe — but
     a blanket "reject non-Cloudflare" (secret-header) approach breaks web SSR's private-network calls
     unless the private network is exempted.
   - **Pre-flight:** enumerate every admin caller + endpoint to confirm nothing legit depends on the
     `*.up.railway.app` URL (health check, webhook, CI probe).
   - **Re-verify:** re-probe `…up.railway.app/api/graphql` → must return refused/`403`, not `200`.
   - With the abuse ceiling (#2) potentially lagging, this bypass being open makes #1 the SOLE
     protection for the search surface — not optional.
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

1. **Origin bypass closed:** re-probe `https://forgeadmin-production-f4d1.up.railway.app/api/graphql`
   → connection refused / `403` (NOT `200`). Legit callers still work: `admin.jesusfilm.org`
   (Cloudflare) and web SSR via `forgeadmin.railway.internal` are unaffected.
2. Anonymous `SemanticSearch` against admin still returns `401 UNAUTHENTICATED`.
3. A request carrying a minted fleet key returns `200` and logs `auth=bearer source=fleet` in the
   per-request search log, bucketing `consumer:<key>:v:<viewer_id>` (or `:<ip>`).
4. Admin boots cleanly (the disjointness invariant passes with the new keys).
5. The edge/global abuse ceiling is active and alerting on anomalous fleet-key volume.
