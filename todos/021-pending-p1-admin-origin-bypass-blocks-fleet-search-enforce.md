---
status: pending
priority: p1
issue_id: "021"
title: Admin raw-origin bypass still open — gates fleet-search enforcement (feat-240 step 1)
labels:
  - admin
  - security
  - infrastructure
  - search
  - feat-240
created_at: 2026-07-16
---

# Problem

`forgeadmin-production-f4d1.up.railway.app/api/graphql` still returns `200` directly
(`server: railway-hikari`, no `cf-ray`) — re-confirmed 2026-07-16, unchanged since the
2026-07-13 probe. The raw Railway origin is reachable un-fronted by Cloudflare, so
`cf-connecting-ip` is spoofable and Cloudflare WAF / edge rate-limits are skippable on that
path. This is feat-240's blocking precondition #1 and it is NOT remediated.

# Why It Matters

TV/mobile ship a bundle-extractable fleet key (`EXPO_PUBLIC_*` is inlined at build time by
design). With the key plus this open origin, an attacker hits the raw origin directly,
rotating `x-viewer-id` / `cf-connecting-ip`, defeating the per-IP fleet bucket (PR #1493).
The app-level global per-fleet-key ceiling (PR #1577) is the compensating bound — but
`FLEET_SEARCH_CEILING_ENFORCE=false` today, so right now this is unmetered free
`Query.search` (cost + availability abuse). App-level auth still applies, so it is not an
anonymous bypass — it defeats Cloudflare, per-IP limiting, and IP trust.

# Evidence

- `curl -s -o /dev/null -w '%{http_code}' https://forgeadmin-production-f4d1.up.railway.app/api/graphql` → `200`
- Root `HEAD` → `server: railway-hikari`, no `cf-ray` (raw origin, not via Cloudflare).
- feat-240 ticket step 1: `docs/roadmap/platform/feat-240-admin-fleet-search-key-provisioning.md`.

# Proposed Fix

Admin CMS owner (not editable from the TV/mobile side):

1. Remove/lock the generated `*.up.railway.app` public domain on `@forge/admin`, keeping only
   the Cloudflare-fronted `admin.jesusfilm.org` (lowest blast radius).
2. Or enforce mTLS Authenticated Origin Pulls / a Cloudflare-injected secret header admin
   requires — BUT exempt the private Railway network (`forgeadmin.railway.internal`) so web
   SSR is not broken.
3. Pre-flight: enumerate admin callers/endpoints to confirm nothing legit depends on the
   `*.up.railway.app` URL (health check, webhook, CI probe).

# Acceptance Criteria

- Re-probe `…up.railway.app/api/graphql` → connection refused / `403` (NOT `200`).
- `admin.jesusfilm.org` (Cloudflare) and web SSR via `forgeadmin.railway.internal` still work.
- Then unblock the downstream sequence: calibrate + flip `FLEET_SEARCH_CEILING_ENFORCE=true`.
