---
id: "2026-07-13-001"
title: "Per-viewer_id fleet rate-limit bucketing (CGNAT-immune)"
type: feat
status: in-progress
owner: urim
origin: docs/plans/2026-07-08-002-feat-admin-fleet-aware-rate-limit-bucketing-plan.md
pr: 1493
---

## Problem

PR #1493 buckets fleet search per client IP (`consumer:<key>:<cf-connecting-ip>`). That
sidesteps the Cloudflare-single-IP problem (it reads the unspoofable `CF-Connecting-IP`,
not the transport IP) but leaves the **carrier-NAT residual**: on IPv4 CGNAT (e.g. 2degrees
mobile, where mobile IPv6 isn't yet deployed) many devices egress through one shared IP, so
they collapse into one bucket.

The web app can't help here — its search runs **server-side** under a shared consumer key,
an option that only exists because a trusted server funnels all users; TV/mobile call admin
directly from the device, so a shared key would collapse the whole fleet into one bucket.

But the web app has a reusable primitive: a locally-generated **`viewer_id`**
(`apps/web/src/lib/viewer-id.ts` — a `crypto.randomUUID()` persisted in `localStorage`,
used today for Mux analytics). Replicated on TV/mobile and sent on the search request, it
gives each install a stable identity admin can bucket on **instead of** IP — one bucket per
device, immune to CGNAT and Cloudflare-single-IP.

## Goal & Scope

Extend fleet bucketing to prefer a client-provided `x-viewer-id` over the client IP, and
wire TV + mobile to generate and send it. Additive to PR #1493, inert until clients send
the header.

### Scope boundaries (non-goals)

- **Not an abuse ceiling.** `viewer_id` is client-generated and freely resettable — it
  spreads _honest_ load (each real device its own bucket) but an attacker rotating ids gets
  unlimited buckets. Abuse is still bounded by the **F1 global per-fleet-key ceiling**
  (Cloudflare edge / global counter) — unchanged from PR #1493. `cf-connecting-ip` has the
  same property (an attacker rotates IPv6), so this changes availability, not the threat model.
- **IP stays as the fallback** — no client sending the header ⇒ behavior identical to today.
- **Web unchanged** — web search keeps its flat server-side `consumer:<key>` bucket.
- **No new client dependency** — reuse the repo's `globalThis.crypto.randomUUID` + Hermes
  fallback pattern (`apps/tv/src/lib/watchSearchLog.ts`).
- **No login/OAuth** — that's the separate longer-term per-account identity path; `viewer_id`
  is the anonymous stepping stone that later merges into an account (as web does).

## Requirements

- **R1** — In `identifyForRateLimit`, the fleet branch keys `consumer:<key>:v:<viewer_id>`
  when a valid `x-viewer-id` header is present; else `consumer:<key>:<ip>` (PR #1493 behavior,
  unchanged); else `consumer:<key>:unknown`.
- **R2** — The `v:` namespace prefix prevents a spoofed `viewer_id` (e.g. `1.2.3.4`) from
  colliding with a real IP bucket. IP-bucket format stays `consumer:<key>:<ip>` (no churn to
  reviewed fleet tests/behavior).
- **R3** — `viewer_id` is sanitized: trim, require length 1–64 and charset `[A-Za-z0-9._-]`;
  anything else is treated as absent (→ IP fallback). This blocks log-injection (no CR/LF/`:`/
  spaces) and bounds Redis key cardinality.
- **R4** — `viewer_id` is a pure spoofable **bucket label**: never an authz/identity signal,
  grants nothing, and is never logged raw (the limiter already never logs the bucket key).
- **R5** — TV + mobile generate a stable per-install `viewer_id` (persisted via AsyncStorage,
  in-memory cached, sync getter) and attach `x-viewer-id` on their search operation
  (`SemanticSearch` / `Search`) alongside the existing consumer bearer.
- **R6** — Additive/inert: `FLEET_ADMIN_API_KEYS` unset ⇒ no fleet principal ⇒ `x-viewer-id`
  is ignored; and web-SSR (`consumer:<key>`, non-fleet) is untouched.

## Key Decisions

- **Prefer viewer_id, fall back to IP** (not viewer_id-only): robust to clients that don't
  send it (mixed fleet during rollout buckets each device correctly by whatever it provides).
- **Namespaced subkeys** (`v:` for viewer, bare for IP) to make spoof-collision impossible.
- **In-memory cache + async hydrate** on the client: AsyncStorage is async but the auth-header
  path is sync, so hydrate at module load and expose a sync `getViewerId()` that returns the
  cached value (generating+persisting on first miss). Startup race (a fresh id before hydrate)
  is acceptable — availability only, and searches occur well after startup.
- **No new dependency**: mirror `watchSearchLog.ts`'s `randomUUID` + manual-UUID fallback.

## Implementation Units

### U1 — Admin: per-viewer_id fleet bucket (`apps/admin`)

- `src/graphql/plugins/rate-limit.ts`:
  - Add `sanitizeViewerId(raw: string | null): string | null` (R3).
  - Fleet branch (currently `getTrustedClientIp` → `consumer:<key>:<ip>`): first read + sanitize
    `ctx.request.headers.get("x-viewer-id")`; if valid return `consumer:<key>:v:<viewer_id>`;
    else keep the existing IP path.
- `src/graphql/plugins/rate-limit.test.ts`: viewer present → `v:` bucket; two viewer_ids →
  two buckets (same IP); invalid/oversized/empty viewer_id → IP fallback; no viewer + IP →
  unchanged `consumer:<key>:<ip>`; spoofed `viewer_id="1.2.3.4"` ≠ IP bucket; non-fleet
  consumer bearer ignores `x-viewer-id` (still flat `consumer:<key>`).
- `apps/admin/CLAUDE.md`: extend the fleet section — viewer_id preferred over IP, CGNAT-immune,
  spoofable→availability-only (F1 ceiling still required), sanitization, `x-viewer-id` header.

### U2 — TV client: viewer_id + header (`apps/tv`)

- `src/lib/viewer-id.ts`: `getViewerId(): string` — in-memory cache, AsyncStorage key
  `forge.viewer_id`, RN-safe UUID (mirror `watchSearchLog.ts`), async `hydrateViewerId()`
  called at app start.
- `src/lib/authHeaders.ts`: `authHeadersForOperation(op, token, viewerId?)` adds
  `{ "x-viewer-id": viewerId }` for the search op (alongside/independent of the bearer).
- `src/lib/apolloClient.ts`: pass `getViewerId()` into `authHeadersForOperation`; kick
  `hydrateViewerId()` at client/app init.
- Tests: `viewer-id.test.ts` (generates+persists+caches; stable across calls); `authHeaders`
  test (search op includes `x-viewer-id`; non-search omits it; token absent still sends viewer).

### U3 — Mobile client: viewer_id + header (`apps/mobile`)

- Same as U2, mirrored, with search op name `Search`. Reuse the existing
  `src/lib/__tests__/authHeaders.test.ts` for the header assertions.

## Verification

1. `pnpm --filter @forge/admin test` (incl. new rate-limit cases) + `typecheck` + `lint`.
2. `pnpm --filter @forge/tv typecheck` + tv unit tests; `pnpm --filter @forge/mobile typecheck`
   - mobile unit tests.
3. Bucket-shape smoke (admin, unit-level through `identifyForRateLimit`): a fleet principal +
   `x-viewer-id: abc` → `consumer:<key>:v:abc`; same principal, two viewer_ids → two buckets.
4. No-regression: full admin suite green; PR #1493 CI all-green after push.

## Risks

- **Spoofability** → availability-only; abuse bounded by the F1 global ceiling (unchanged). R4.
- **Cardinality** (attacker spams random ids) → length cap + Redis window TTL + global ceiling.
- **Startup race** (fresh id before hydrate) → acceptable; availability only; search is post-startup.
- **Mixed rollout** (some devices send viewer_id, some don't) → each buckets correctly by what
  it provides; `v:`/IP namespaces never collide.
