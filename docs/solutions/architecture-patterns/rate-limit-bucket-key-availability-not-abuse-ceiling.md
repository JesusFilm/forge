---
title: "Per-identity fleet rate-limit bucketing: the bucket key is availability, not an abuse ceiling"
description: "Prefer a sanitized, namespaced client viewer_id over per-IP for rate-limit bucketing on untrusted direct-to-device clients (CGNAT-immune); bound abuse with a separate global per-key ceiling."
module: "apps/admin GraphQL rate-limit plugin; apps/tv + apps/mobile search clients"
date: 2026-07-13
problem_type: architecture_pattern
component: service_object
severity: high
category: architecture-patterns
applies_when:
  - "Untrusted direct-to-device clients (RN/Expo) share ONE baked-in credential and call a rate-limited backend (e.g. admin Query.search) directly"
  - "A per-IP rate-limit bucket self-throttles co-egress clients behind carrier-grade NAT (CGNAT)"
  - "Choosing a rate-limit bucket key and needing to separate availability spreading from an abuse ceiling"
  - "Namespacing and sanitizing a client-controlled/spoofable sub-key (e.g. x-viewer-id) into a rate-limit identity"
  - "Deciding server-side clients (web SSR) can share a flat bucket while direct-to-device clients need per-identity"
resolution_type: code_fix
related_components:
  - "apps/admin/src/graphql/plugins/rate-limit.ts"
  - "apps/tv/src/lib/viewer-id.ts"
  - "apps/mobile/src/lib/viewer-id.ts"
  - "authHeaders.ts"
  - "apolloClient.ts"
tags:
  - "rate-limiting"
  - "cgnat"
  - "availability"
  - "viewer-id"
  - "bucketing"
  - "graphql"
  - "abuse-ceiling"
  - "fleet"
---

# Per-identity fleet rate-limit bucketing: the bucket key is availability, not an abuse ceiling

## Context

`apps/tv` and `apps/mobile` are untrusted React Native clients that call admin's
GraphQL search field directly (`Query.search` when this was written; `watchSearch`
since admin #1622 — the field was renamed, the bucketing problem is unchanged). Both ship the SAME consumer-bearer key baked
into every install (`EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN`), because there is no
per-user secret to hand a store binary. Admin rate-limits by principal identity
(`identifyForRateLimit`), so the naive bucket for that shared key —
`consumer:<key>` — would collapse the WHOLE fleet into a single 60/min limit.
One popular hour and the fleet 429s itself: a self-DoS with no attacker
involved.

`apps/web` does not have this problem even though it also carries a shared
consumer bearer, because web search runs SERVER-SIDE. A bounded set of trusted
Next.js SSR servers is an aggregation point: admin sees a handful of egress IPs
that already fan many users into few callers, so a flat `consumer:<key>` bucket
is fine there. Direct-to-device clients have NO aggregation point — every user's
phone or TV is its own caller — so the backend has to manufacture one.

The first fix was to sub-key fleet traffic by client IP
(`consumer:<key>:<ip>`, using the Cloudflare-authoritative `cf-connecting-ip`).
That spreads most of the fleet, but it has a carrier-NAT residual: mobile
devices on an IPv4 carrier-grade NAT (e.g. NZ 2degrees, where mobile IPv6 is not
deployed) all egress through one public IP, land in one bucket, and 429 each
other. Per-IP re-scopes the self-DoS from "whole fleet" down to "everyone behind
one carrier egress" — better, but the cellular fleet is exactly the population
most likely to share an egress.

## Guidance

Prefer a **client-generated per-device identifier** (`viewer_id`) as the bucket
sub-key over IP. The client generates a stable-per-launch id and sends it as
`x-viewer-id` on the search operation only; the backend buckets
`consumer:<key>:v:<viewer_id>` when the header is valid, falling back to the IP
bucket (then `:unknown`) when it is absent or malformed.

The client id needs no new dependency and no persistence. Hermes lacks
`crypto.randomUUID`, so use the runtime crypto when present and an RFC4122
`Math.random` fallback otherwise, cached in-memory for the process lifetime
(`apps/tv/src/lib/viewer-id.ts`, mirrored in `apps/mobile`):

```ts
let cachedViewerId: string | undefined

// RFC4122 v4 without a dependency — Hermes lacks crypto.randomUUID.
export function uuidV4Fallback(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function getViewerId(): string {
  if (cachedViewerId) return cachedViewerId
  const runtimeCrypto = (
    globalThis as { crypto?: { randomUUID?: () => string } }
  ).crypto
  cachedViewerId = runtimeCrypto?.randomUUID?.() ?? uuidV4Fallback()
  return cachedViewerId
}
```

The header rides ONLY on the gated search operation, alongside the bearer, and
never on public operations (`apps/tv/src/lib/authHeaders.ts`):

```ts
export function authHeadersForOperation(
  operationName: string | undefined,
  token: string | undefined,
  viewerId?: string,
): Record<string, string> {
  if (operationName !== SEARCH_OPERATION_NAME) return {}
  const headers = buildAuthHeaders(token)
  // x-viewer-id lets admin bucket per-install (CGNAT-immune) instead of per-IP;
  // spoofable, so admin treats it as an availability label only.
  if (viewerId) headers["x-viewer-id"] = viewerId
  return headers
}
```

The backend forms the bucket in `identifyForRateLimit`
(`apps/admin/src/graphql/plugins/rate-limit.ts`). The `viewer_id` branch is
preferred over IP, and both live under the fleet namespace:

```ts
if (ctx.user.fleet) {
  // Prefer a client-provided viewer_id (per-install, CGNAT-immune) over IP.
  // Spoofable → an availability label only; abuse stays bounded by the
  // edge/global per-key ceiling, never this key. See sanitizeViewerId.
  const viewerId = sanitizeViewerId(ctx.request.headers.get("x-viewer-id"))
  if (viewerId) {
    return `consumer:${ctx.user.rateLimitBucketKey}:v:${viewerId}`
  }
  const ip = getTrustedClientIp(ctx.request)
  return `consumer:${ctx.user.rateLimitBucketKey}:${ip}`
}
return `consumer:${ctx.user.rateLimitBucketKey}`
```

Four rules make this safe rather than just clever:

1. **A client-controlled bucket key is an availability-spreading mechanism, NOT
   an abuse ceiling.** `viewer_id` is a string in a loop — trivially rotatable,
   cheaper to rotate than an IP. Abuse MUST be bounded by a SEPARATE global
   per-key ceiling (a Cloudflare edge rate-limit keyed on the fleet bearer, or
   an app-level global per-fleet-key counter). Critically, per-IP was ALSO never
   an abuse ceiling — IPv6 rotation is cheap — so moving from IP to `viewer_id`
   does NOT change the threat model. Both bucket schemes assume the global
   ceiling is the real abuse bound.

2. **Namespace the spoofable sub-key.** The `viewer_id` bucket uses a `:v:`
   prefix (`consumer:<key>:v:<viewer_id>`) while the IP bucket is bare
   (`consumer:<key>:<ip>`). Without the prefix, a client that sends
   `x-viewer-id: 1.2.3.4` would land in — and could pin or poison — a real
   victim's IP bucket. Sanitize the header before use: charset
   `[A-Za-z0-9._-]`, length 1–64, reject `:`, CR, LF, and spaces. This bounds
   Redis key cardinality and prevents log-injection. Never log the bucket key.

   ```ts
   const VIEWER_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
   function sanitizeViewerId(raw: string | null): string | null {
     if (raw == null) return null
     const trimmed = raw.trim()
     return VIEWER_ID_PATTERN.test(trimmed) ? trimmed : null
   }
   ```

3. **This is one step on an architecture progression**, not the terminus:
   flat-shared-key (works only server-side, where a bounded set of servers is
   the aggregation point) → per-IP (CGNAT-limited) → per-client-`viewer_id`
   (CGNAT-immune, availability-only) → per-login-identity (an OAuth `sub`; the
   eventual clean per-account bound). `viewer_id` is the anonymous stepping
   stone that later merges into an account, the same way `apps/web` associates
   anonymous sessions with a login.

4. **Roll it out additive and inert.** An absent or malformed `x-viewer-id`
   falls back to the IP bucket, which is exactly the prior behavior. So the
   backend branch can ship dormant and only "turns on" once client builds start
   sending the header — no coordinated flip, no dead window.

## Why This Matters

The failure mode this prevents is a self-inflicted outage that looks like an
attack. Under a flat `consumer:<key>` bucket, a normal traffic spike makes the
fleet exhaust its own 60/min limit and every user gets 429s — with no attacker,
no bad actor, nothing to block. Under per-IP, the same outage re-scopes to
everyone sharing a carrier NAT, which for a mobile app is a large and unlucky
slice of real users. Per-`viewer_id` gives each install its own bucket
regardless of NAT, so co-egress devices stop colliding.

The subtle, load-bearing distinction is between an **availability label** and an
**abuse boundary**. It is tempting to reason "IP is unspoofable, so per-IP is
also our abuse control; `viewer_id` is spoofable, so switching to it weakens
security." That reasoning is wrong on both halves: `cf-connecting-ip` is
unspoofable but coarse (CGNAT collapses many users into one), `viewer_id` is
spoofable but granular (CGNAT-immune) — and NEITHER is the abuse boundary,
because an attacker holding the bundle-extractable fleet key can rotate IPs
(cheap in IPv6) just as easily as they can rotate a header. The abuse boundary
is, and always was, the global per-key ceiling. Once you internalize that, the
IP→`viewer_id` swap is a pure availability win with no security cost, and the
real security work (the global ceiling, plus Cloudflare Authenticated Origin
Pulls so the raw origin can't be hit unspoofed) is where it always belonged.

Getting the namespacing and sanitization wrong turns the availability win into a
new attack surface: an un-prefixed spoofable id lets one client evict or occupy
another's bucket, and an unsanitized value injects structure into logs or blows
up Redis key cardinality. These are cheap to get right and expensive to retrofit
after the header is live in shipped binaries.

## When to Apply

- Apply whenever multiple untrusted clients share ONE baked-in credential and
  hit a rate-limited backend directly, with no server-side aggregation point.
  Native mobile/TV apps are the canonical case.
- Reach for the `viewer_id` sub-key specifically when a per-IP bucket has a
  CGNAT/carrier-NAT residual — i.e. real users share an egress IP and 429 each
  other. If your fleet has no meaningful IP-sharing, per-IP may be enough.
- Do NOT rely on the client-controlled key as your abuse defense. It is safe to
  SHIP the scheme at any time (it's additive/inert), but it is only safe to TURN
  ON — i.e. depend on it for availability without regret — once the global
  per-key abuse ceiling is live. Treat that ceiling as a documented BLOCKING
  precondition, together with confirming Cloudflare AOP is enforced so the raw
  origin is unreachable. Env-CSV fleet keys also have no sub-second revocation,
  so plan the abuse-incident runbook (rotate + redeploy, Cloudflare edge block
  as the interim) before shipping the token.
- Skip it when a real per-account identity is already available; bucket on the
  login `sub` instead. `viewer_id` is the anonymous stepping stone for when it
  is not.

RN testability note: keeping the id in-memory (no AsyncStorage, no persistence)
keeps the module pure and trivially unit-testable — `tv`/`mobile` use jest, and
the UUID fallback is exported so the fallback path can be exercised directly
even though the Node test env has `crypto.randomUUID`. Persistence is only worth
adding for analytics or account-merge, never for rate-limiting.

## Examples

**Before — flat shared-key bucket (self-DoS on device fleets):**

```ts
// Every install ships the same key → one bucket for the whole fleet.
return `consumer:${ctx.user.rateLimitBucketKey}` // 60/min shared by everyone
```

A traffic spike exhausts the single bucket; all users 429.

**Intermediate — per-IP (CGNAT residual):**

```ts
const ip = getTrustedClientIp(ctx.request) // cf-connecting-ip only, never x-forwarded-for
return `consumer:${ctx.user.rateLimitBucketKey}:${ip}`
```

Co-egress carrier-NAT devices share one bucket and 429 each other. Note the
trusted-IP-only choice: a spoofable `x-forwarded-for` would let a fleet-key
holder mint buckets or pin a victim's, so only Cloudflare's `cf-connecting-ip`
is used.

**After — per-`viewer_id`, IP fallback (CGNAT-immune, availability-only):**

```ts
// backend: identifyForRateLimit, fleet branch
const viewerId = sanitizeViewerId(ctx.request.headers.get("x-viewer-id"))
if (viewerId) {
  return `consumer:${ctx.user.rateLimitBucketKey}:v:${viewerId}` // one bucket per app launch
}
const ip = getTrustedClientIp(ctx.request)
return `consumer:${ctx.user.rateLimitBucketKey}:${ip}` // additive fallback = prior behavior
```

```ts
// client: send the id only on the gated search op, alongside the bearer
const headers = authHeadersForOperation(operationName, token, getViewerId())
// → { Authorization: "Bearer …", "x-viewer-id": "3f2a…" } for Search only; {} otherwise
```

Each launch generates a fresh in-memory UUID, so a device gets its own bucket
regardless of NAT. The `:v:` prefix keeps a spoofed IP-shaped id
(`x-viewer-id: 1.2.3.4`) out of the real IP bucket namespace. Absent/malformed
headers degrade silently to the IP bucket, so old builds keep working and the
change ships dormant until new binaries reach the fleet.

## Related

- `apps/admin/CLAUDE.md` — "Fleet-aware rate-limit bucketing (apps/tv + apps/mobile)" and "Search API authentication" (the bearer-as-passport composer, the `FLEET_ADMIN_API_KEYS` CSV, the `source=fleet` log tag, and the two BLOCKING F1 preconditions).
- `apps/admin/src/graphql/plugins/rate-limit.ts` — `identifyForRateLimit`, `sanitizeViewerId`, `getTrustedClientIp`.
- `apps/tv/src/lib/viewer-id.ts` + `apps/tv/src/lib/authHeaders.ts` (mirrored in `apps/mobile/src/lib/`).
- `docs/plans/2026-07-13-001-feat-viewer-id-fleet-bucketing-plan.md` and `docs/plans/2026-07-08-002-feat-admin-fleet-aware-rate-limit-bucketing-plan.md`.
- `docs/solutions/architecture-patterns/consumer-bearer-rate-limit-identity-pattern-20260513.md` — the original consumer-bearer-as-rate-limit-identity pattern (server-side web SSR case); this doc supplies the direct-to-device fleet case it left open.
- `docs/solutions/architecture-patterns/fleet-client-bearer-must-be-operation-scoped-not-global.md` — the auth-side half (keep the bearer on the search op only); this is the availability-side half.
- `docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md` — the OR-composition + disjointness + rate-limit-before-auth foundation, and the identity-for-bucketing-is-not-authorization principle this extends.
