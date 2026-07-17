# feat-240 — Fleet search origin lock + rollout: pre-flight & runbook

**Date:** 2026-07-14 · **Owner (coordination):** urim · **Landed via:** `docs/tv-and-feat240-doc-records`

Unblocks TV/mobile search on TestFlight/prod. Admin fleet bucketing (PR #1493) is
merged and dormant; feat-240 (this doc) lands the admin preconditions + mints the
keys, then feat-241 provisions the client token and rebuilds.

## TL;DR

- **Pre-flight is clear at the code level.** A 6-agent repo sweep + a live origin
  probe found **no in-repo caller depends on the raw public Railway origin**
  (`forgeadmin-production-f4d1.up.railway.app`). It appears only in 5 doc files.
- **One finding changes _how_ you lock it:** an auth CNAME may point at that exact
  host — prefer AOP/secret-header gating over deleting the domain (see below).
  **Superseded 2026-07-16 — the CNAME risk is FALSE; domain removal is safe. See
  the dated correction in the auth-CNAME section.**
- **Abuse ceiling: use the app-level per-fleet-key counter** — it's how the whole
  repo rate-limits (no Cloudflare rate-limit rules exist in the codebase) and it
  extends the `identifyForRateLimit` mechanism #1493 already added.
- Five out-of-repo confirmations remain before flipping; all are dashboard checks.

## Pre-flight clearance (agent-verified 2026-07-14)

Live re-probe: `https://forgeadmin-production-f4d1.up.railway.app/api/graphql` still
returns `HTTP/2 200`, `server: railway-hikari`, **no `cf-ray`** → bypass confirmed open.

Every admin caller and the host it uses:

| Caller                                                | Host                                           | Evidence                                                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| web SSR (Apollo default/user/search + REST manifests) | (b) private `forgeadmin.railway.internal:8080` | `admin-client.ts:37,51,76` read `env.ADMIN_GRAPHQL_URL`; prod pinned to private host per feat-217 (complete), `env.test.ts:106`, `web/CLAUDE.md:36` |
| mobile (Apollo + thumbnails)                          | (a) Cloudflare `admin.jesusfilm.org`           | `mobile/src/env.ts:12` hardcodes the Cloudflare default; `config.ts:4`                                                                              |
| tv (Apollo + Datadog hosts)                           | (a) Cloudflare (EAS-injected)                  | `tv/.env.example:5`; `config.ts:5`; `build-android.md` corroborates                                                                                 |
| manager (embed-trigger, video-lookup, session, jobs)  | (a) Cloudflare (Doppler-set)                   | `manager/src/config/env.ts:62` (optional, no default); doc-pinned in `manager/CLAUDE.md:111` + plan 2026-05-05                                      |
| mastra (ingest/agent-tools/search-eval)               | env-driven, optional, prod value in Doppler    | `mastra/src/config/env.ts:91-104`; internal routes, not host (c) in code                                                                            |
| yt-video-mapper-backend (catalog sync)                | env-driven, optional, prod value in Railway    | `yt-video-mapper-backend/src/config/env.ts:12`                                                                                                      |
| chat                                                  | n/a — not an admin caller                      | calls mastra + auth only                                                                                                                            |
| auth prod OAuth client (`jfp_admin_production`)       | (a) Cloudflare                                 | `auth/src/domain/apps.ts:120-122` pins redirect/origins to `admin.jesusfilm.org`                                                                    |

**Conclusion:** locking host (c) breaks no in-repo caller. The raw-origin literal is
docs-only (feat-240, feat-104, feat-105). Two _tolerances_ (not dependencies) noted:
web's `ADMIN_GRAPHQL_URL` allowlist accepts a `.railway.app` suffix silently, and
auth's preview-redirect regex matches the host shape but only for preview/staging
OAuth clients — never prod.

## The finding that changes the lock: auth CNAME

> **Correction (2026-07-16): this finding is FALSE — do not act on it.**
> `auth.jesusfilm.org` moved to the standalone `@forge/auth` service on 2026-05-12
> (`apps/auth/docs/railway-deployment.md`) and serves `{"service":"forge-auth"}` live;
> feat-105's line-135 CNAME prose predates the split. No CNAME depends on the raw
> origin, so removing the public `*.up.railway.app` domain is the lowest-blast-radius
> lock. The section below is kept as the original 2026-07-14 reasoning.

`feat-105-admin-sso-firebase-auth-wiring.md:135` instructs:
`Cloudflare: add CNAME auth → forgeadmin-production-f4d1.up.railway.app`.

If that CNAME is still live, the choice of lock mechanism matters:

- **AOP / secret-header gating** (origin rejects any non-Cloudflare request) — the
  CNAME survives; auth SSO keeps resolving. **Recommended.**
- **Deleting/renaming the Railway public service domain** — would break a live
  `auth.jesusfilm.org` CNAME and admin SSO with it. Only safe after confirming the
  auth record does not depend on that hostname.

**Action before Step 1:** in the Cloudflare DNS dashboard (jesusfilm.org zone),
inspect the `auth` record's target + proxy status. Decide lock semantics from what
you find.

## Out-of-repo confirmations (yours, before locking)

The repo can't see deployed env values, DNS, or external monitors. Confirm:

1. **Auth CNAME** (above) — highest consequence; sets the lock mechanism.
   **Resolved 2026-07-16: FALSE alarm — no dependency; domain removal is safe
   (see correction above).**
2. **web Railway `ADMIN_GRAPHQL_URL`** resolves to `forgeadmin.railway.internal:8080`
   (the `RAILWAY_PRIVATE_DOMAIN` reference), not any `*.up.railway.app` value.
3. **Doppler `forge-manager`** (`ADMIN_GRAPHQL_URL`, `ADMIN_MANAGER_SESSION_URL`) and
   **mastra** (`ADMIN_*_INGEST_URL`, `ADMIN_AGENT_TOOLS_URL`, `ADMIN_SEARCH_*_URL`) +
   **Railway yt-video-mapper** (`ADMIN_GRAPHQL_URL`) — each Cloudflare or private, not host (c).
4. **EAS** tv/mobile baked `EXPO_PUBLIC_*` values + any shipped store builds / OTA
   channels point at `admin.jesusfilm.org` (not a past raw-origin build).
5. **External monitors / partners** — scan admin prod logs for `Host =
forgeadmin-production-f4d1.up.railway.app` OR requests lacking `cf-ray` over 7–14
   days; check Datadog Synthetics / any uptime service.

## Runbook

### Step 1 — Close the origin bypass · YOU (Railway/Cloudflare dashboard)

- Pick the mechanism from the auth-CNAME check: **AOP/secret-header (recommended)**
  or public-domain removal.
- Preserve legit callers: web SSR uses the private network (exempt any secret-header
  rule from the private path); manager/tv/mobile use Cloudflare.
- Re-verify probes:

```bash
# 1. Raw origin GraphQL must be closed (expect 403 or refused, NOT 200; no cf-ray)
curl -sS -m 15 -o /dev/null -w 'HTTP %{http_code}\n' -X POST \
  https://forgeadmin-production-f4d1.up.railway.app/api/graphql \
  -H 'content-type: application/json' -d '{"query":"{ __typename }"}'
# 2. Raw origin health also closed
curl -sS -m 15 -i https://forgeadmin-production-f4d1.up.railway.app/api/health | head -20
# 3. Cloudflare path still works AND is proxied (cf-ray present)
curl -sS -m 15 -i https://admin.jesusfilm.org/api/health | grep -iE '^HTTP|cf-ray'
# 4. Cloudflare GraphQL still serves consumer callers (real WEB_ADMIN_API_KEYS bearer)
curl -sS -m 20 -o /dev/null -w 'HTTP %{http_code}\n' -X POST \
  https://admin.jesusfilm.org/api/graphql -H 'content-type: application/json' \
  -H 'authorization: Bearer <consumer-key>' -d '{"query":"{ __typename }"}'
# 5. auth subdomain still resolves + serves (guards the feat-105 CNAME risk)
dig +short auth.jesusfilm.org && curl -sS -m 15 -o /dev/null -w 'HTTP %{http_code}\n' \
  https://auth.jesusfilm.org/api/auth/login
# 6. web still renders (its private admin path works); confirm in admin logs
curl -sS -m 20 -o /dev/null -w 'HTTP %{http_code}\n' https://web.jesusfilm.org/watch
```

- **Companion hardening (mine, apps/web):** after locking, drop `.railway.app` from
  `ADMIN_GRAPHQL_URL_HOST_ALLOWLIST_SUFFIXES` in `apps/web/src/env.ts` (keep
  `.railway.internal`) so the bypass can't be reintroduced by a future config typo.
  Ready to apply on this branch on your go.

### Step 2 — Abuse ceiling · YOU/admin-owner (admin PR) + operator (Datadog)

> **Status 2026-07-16: shipped.** PR #1577 landed the global per-fleet-key ceiling
> (`FLEET_SEARCH_CEILING_ENFORCE=false`, alert-first); monitors landed as code in
> PR #1591 (`infra/datadog-monitors/`) — the operator still runs `create.sh`.

**Chosen approach: app-level per-fleet-key counter** (consistent with the repo — all
rate-limiting is app-level; no Cloudflare rate-limit rules exist in-code).

Spec (extends `apps/admin/src/graphql/plugins/rate-limit.ts`):

- Keep the existing per-IP / per-`viewer_id` fleet bucket (`consumer:<key>:v:<vid>` /
  `consumer:<key>:<ip>`) — that bounds a single device.
- Add a **coarser global ceiling per fleet key** (`fleet-global:<key>`) as a second
  limiter dimension, sized above legit aggregate fleet traffic but below abuse. This
  is the piece that bounds an attacker rotating IPs/viewer_ids with an extracted key —
  the per-IP bucket alone doesn't. Confirm the Pothos limiter supports a second
  dimension, else add a lightweight counter check for `ctx.user.fleet`.
- Emit a metric/log when a fleet key nears the ceiling for the monitor below.

Datadog monitor (operator creates; query I can finalize):

- Count admin search requests where `source=fleet`, grouped by fleet key, over a
  rolling window; alert when a single key exceeds an anomalous rate or spikes N×.

### Step 3 — Mint keys · YOU (Doppler)

> **Status 2026-07-16: done.** Both fleet keys minted in `forge-admin` Doppler.

```bash
openssl rand -base64 32   # run once per surface — one for TV, one for mobile, never shared
```

Add both to `FLEET_ADMIN_API_KEYS` in `forge-admin` Doppler, **disjoint** from every
other bearer CSV (a reused value fails admin boot via `assertBearerCsvsDisjoint`).
Generate these yourself — production secrets don't pass through the agent session.

### Step 4 — Deploy admin receiver-first · YOU (PR merge → Railway autodeploy)

> **Status 2026-07-16: done.** Admin deployed; fleet requests verified `200` with
> `source=fleet`, and feat-241 client tokens verified on Android TV / Android
> mobile / Apple TV (no 401).

Keys must be live in admin **before** feat-241 sets the client token, or the first
client calls 401. Hand the key values to yourself (TV/mobile owner) over a secure
channel for feat-241.

## Responsibility split

| Work                                                      | Who                                       |
| --------------------------------------------------------- | ----------------------------------------- |
| Pre-flight caller enumeration + live probe                | **Me — done**                             |
| feat-240 runbook + out-of-repo checklist (this doc)       | **Me — done**                             |
| web allowlist hardening (drop `.railway.app`)             | **Me** — apps/web, ready on your go       |
| App-level per-key counter spec + reference diff           | **Me** — spec here; you land the admin PR |
| Datadog monitor query draft                               | **Me** — on request                       |
| Auth-CNAME check + lock-mechanism decision                | **You** (Cloudflare DNS)                  |
| Origin lock (AOP or domain removal)                       | **You** (Railway/Cloudflare)              |
| Deployed-env confirmations (Railway/Doppler/EAS)          | **You**                                   |
| Cloudflare rule (only if you pick the edge route instead) | **You**                                   |
| Mint + Doppler key add                                    | **You**                                   |
| Admin deploy (receiver-first)                             | **You**                                   |
| Datadog monitor creation                                  | **You** (operator)                        |

## Provenance

Pre-flight: 6-agent workflow (5 sweep angles + adversarial completeness), 2026-07-14.
Verdict `needs-more-checks` (repo clean, `publicOriginDependencies: []`; out-of-repo
confirmations pending). Live origin probe same day. See PR #1493 (merged) for the
fleet-bucketing implementation this unblocks.
