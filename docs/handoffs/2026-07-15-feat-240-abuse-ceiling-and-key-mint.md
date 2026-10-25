# feat-240 — Fleet-key global abuse ceiling + key mint (admin handoff)

> This is a spec for the **admin owner's PR**. Nothing here is applied. It merges the reference design with three adversarial reviews (security, reliability, correctness); every valid fix is folded in, and each place two reviews disagreed carries a one-line **Decision** callout choosing the safer option. All paths are absolute under `/Users/urimchae/Documents/GitHub/forge/.claude/worktrees/feat-241-tv-mobile-fleet-search-token/`.

---

## 1. Context & ownership

**Already shipped — do NOT redesign:**

- **Per-device fleet bucketing (PR #1493, merged)** in `identifyForRateLimit` at `apps/admin/src/graphql/plugins/rate-limit.ts`. A fleet CONSUMER_BEARER buckets `consumer:<key>:v:<viewer_id>` (from `x-viewer-id`) or `consumer:<key>:<ip>` (cf-connecting-ip only). Web SSR stays flat `consumer:<key>`. Leave untouched.
- **`FLEET_ADMIN_API_KEYS`** already exists as a disjoint bearer CSV in `apps/admin/src/config/env.ts` (`BEARER_CSV_KEYS` + `assertBearerCsvsDisjoint`). Minting keys = adding **values**, not re-declaring the var.
- The per-request search log already emits `source=fleet` for fleet keys via `search-bearer.ts` / `isAnyKnownBearer`.

**What THIS delivers (F1 precondition #2):** a **global per-fleet-key abuse ceiling** keyed `fleet-global:<fleetKeyId>` on the search path, spanning all IPs and `x-viewer-id`s, on **both** entry points — GraphQL `Query.search` (`apps/admin/src/graphql/queries/hybrid-search.ts`) and REST `GET /api/search` (`apps/admin/src/app/api/search/route.ts`). It is the sole bound on an attacker who extracts the bundle-baked fleet key and rotates IP + viewer_id (each rotation is a fresh per-device 60/min bucket, so that layer does not bound them). A near-ceiling log lets a Datadog monitor page **before** any hard block.

**Owner:** the admin CMS owner lands this PR (Urim does not own/edit `apps/admin`). This handoff is the implementation spec.

**Hard dependency, separately owned:** origin-bypass precondition #1 (locking the raw `*.up.railway.app` origin) is owned by the admin CMS owner and must ALSO be closed before any client token ships. Noted as a dependency only; not specced here.

**The ceiling is real only in composition with `SEARCH_AUTH_REQUIRED=true`** (security review #2). Both guards fire only when `source === "fleet"` — an abuser who simply _omits_ the key stays anonymous and is bounded only per-IP 30/min (IP-rotation-evadable). While `SEARCH_AUTH_REQUIRED=false`, anonymous search succeeds and the ceiling is a no-op. So feat-241's token ship is gated on **"ceiling merged AND `SEARCH_AUTH_REQUIRED=true`"**, not on "ceiling merged" alone. See the runbook (§7).

---

## 2. Design decisions & risks

### 2.1 Hard-block vs alert-first — ship enforcement OFF first, then flip

A single `fleet-global:<key>` bucket with a hard 429 is a **shared-fate fleet-wide outage switch** (reliability R1): an attacker holding the key can drive a surface to `ceiling` and 429 every legit tv/mobile user on it; the fixed window means a breach 429s the _rest of that 60s window_ for everyone; and a correlated-legit spike (push notification, app-store update wave) can trip it on real traffic. This re-introduces the exact self-DoS per-device bucketing was built to prevent.

The design argued "do NOT run alert-only" — but that is about the **steady state**, not the **first production exposure**.

> **Decision (design §c "no alert-only" vs reliability R1 "ship enforce-off"):** Reconcile via a staged rollout. Add `FLEET_SEARCH_CEILING_ENFORCE` (`z.enum(["true","false"]).optional().default("false")`). Ship with **block OFF, near/exceeded WARN ON**, calibrate the ceiling off observed `count=` during the token rollout, then flip enforcement on with one Doppler change. End state is still a hard block — day-one just cannot self-DoS the fleet. This is strictly safer than shipping the block cold.

### 2.2 Redis fail-mode — honor a per-replica local cap at the FULL ceiling (not pure fail-open, not `ceiling/replicas`)

When Redis is unreachable, `incrementFixedWindow` falls back to the in-process `localLimit`, which already enforces the passed limit (the full ceiling) **per replica**. Three positions were on the table: design = pure fail-open (`overCeiling:false` always); security #1 = block at `ceiling/replicas` (needs a `FLEET_CEILING_EXPECTED_REPLICAS` env var); reliability R6 = block only when a replica's local count exceeds the **full** ceiling.

> **Decision (design fail-open vs security `ceiling/replicas` vs reliability R6 full-ceiling):** Adopt **R6**. On `source === "local"`, return `overCeiling = !result.allowed` (the local limit is already set to the full ceiling). This is safe on **both** axes: a single-replica attack blast during an outage is bounded at `ceiling × replicas` instead of unbounded (closes security #1's "Redis outage = unlimited" bypass), while legit fleet traffic — which never fills a full ceiling on one replica — is never 429'd during an outage. It needs no replica-count env var (simpler than security's proposal) and, because the local cap is also gated by `FLEET_SEARCH_CEILING_ENFORCE`, it is inert during the alert-only rollout. Trade-off, stated plainly for the abuse runbook (R6): while enforcement is off, or across the outage window before a replica fills, attacker embedding/pgvector cost is bounded only by per-IP/per-replica limits; a sustained attack is answered by the incident runbook (§7), and the `degraded`/`redis_unavailable` logs make the gap observable.

### 2.3 Sizing the ceiling — catastrophic backstop, not a quota

Its job is bounding blast radius + embedding/pgvector cost, not rationing normal traffic. A too-low ceiling self-DoSes the fleet (the failure #1493 fixed), so the `6000`/min (100 rps/surface) default is deliberately generous and is a **placeholder to calibrate**.

- **Size above retry-storm peak, not steady peak** (reliability R2): a downstream slowdown (OpenRouter embeddings / pgvector) makes Apollo clients retry, and each retry re-enters the resolver and increments `fleet-global` — the ceiling can turn a yellow incident red. Budget 2–3× baseline for retry storms; the alert-first rollout (§2.1) is the real mitigation (an operator paged at 80% raises the ceiling in Doppler before it blackouts).
- **Account for the fixed-window 2× boundary** (security #4): the reused `INCR`+`PEXPIRE` primitive is a fixed window, so an attacker straddling the boundary can land `2 × ceiling` in a sub-second span. > **Decision (security #4 sliding-window vs keep fixed):** keep the fixed window (reuse the existing, already-shipped primitive verbatim — a sliding sorted-set window is a larger, divergent change) and **document that the true worst-case minute is `2 × FLEET_SEARCH_GLOBAL_CEILING_PER_MIN`**; size the ceiling with that in mind.
- **Account for rotation overlap** (security #6): during the multi-week overlap `FLEET_ADMIN_API_KEYS` holds old+new keys → two `fleetKeyId`s → two buckets → aggregate `2 × ceiling` for one surface. Inherent to per-key bucketing; size with it in mind.
- **Calibrate down** from observed `event=fleet_ceiling.near` `count=` once token-bearing builds reach users, to ~3–5× observed p99 aggregate, never below realistic concurrent-fleet peak. Server-tunable (Doppler + redeploy); no logic change.

### 2.4 Response posture (composes with `apps/admin/CLAUDE.md` abuse runbook)

The **80% near-ceiling WARN is the primary response trigger**, not the block. First operator move on `.near`: a surgical **Cloudflare edge block** of the abusive pattern (ASN / IP range / UA) — no legit-user impact — escalating to `FLEET_ADMIN_API_KEYS` rotation + redeploy only if the key is confirmed compromised (fleet-wide revoke; breaks fleet search until a new build ships — last resort; env-CSV keys have no sub-second revocation).

### 2.5 Known residuals (accept + document)

- **Sibling pgvector cost surfaces uncovered** (security #3): `sceneRecommendations` + `/api/scene-embedding/recommendations` + `/api/search/health` run the same embedding/pgvector class of work, are public, and are bounded only per-IP 30/5 min (IP-rotation-evadable). > **Decision (security #3 scope-and-document vs generalize-the-bucket):** for this PR, **scope the ceiling to `search` and record the sibling surfaces as a known, accepted residual** backed by an edge (Cloudflare) rate-limit; recommend generalizing `incrementFixedWindow("fleet-global:<id>", …)` into a shared per-fleet-key cost bucket that scene-recommendations/health also debit as a fast-follow. Do not describe the search ceiling as "the fleet key is now fully bounded."
- **GraphQL alias/batch amplification** (reliability R4): one HTTP request `{ a: search b: search … }` increments `fleet-global` N times while the attacker's own per-device bucket sees 1 — a cheaper shared-ceiling DoS. Bounded only if GraphQL Armor `maxAliases` + request-batching caps are on (verify — §8). A single logical fleet search hits only GraphQL **or** only REST, so there is no cross-surface double-count.
- The same fleet CONSUMER_BEARER unlocks the whole public GraphQL surface (`watchSetting`, `experienceBySlug`, `videoBySlug`), bounded only by the per-device Yoga bucket — not the embedding/pgvector cost driver, out of scope here.
- Redis `maxmemory-policy` eviction of `fleet-global:<id>` under pressure resets the window early (attacker gets more). Pin the ceiling key to a non-evicting policy or accept as an operational dependency.

### 2.6 Verified-correct (do not re-litigate)

Both surfaces resolve through the same `isAnyKnownBearer → safeConsumer → isValidConsumerBearer` and derive `fleetKeyId = sha256(matched.key).slice(0,12)` from the canonical CSV value, so GraphQL and REST **INCR the same counter** for the same key. Exact `timingSafeEqual` + the disjointness invariant mean an attacker's key deterministically matches the fleet branch (no relabel to `consumer`/`partner` to dodge). The bucket keys on `fleetKeyId` alone — no IP / viewer*id / `x-forwarded-for` — so per-device rotation cannot reset it. Raw key never enters a bucket name or a log. Env boots unprovisioned (`.optional().default`). Down-Redis latency is bounded by `enableOfflineQueue:false` + `maxRetriesPerRequest:1` (redis.ts) — only \_slow*-Redis is exposed (fixed by §2.7 / R3).

### 2.7 Blocking-before-enable items pulled into this PR

- **R3 `commandTimeout`:** a connected-but-slow Redis has no per-command ceiling today, and the ceiling adds a _second_ serial `eval` on the REST hot path (per-IP + fleet) and the _first_ in-resolver `eval` on the GraphQL hot path. Add an explicit `commandTimeout` (250ms) to the ioredis client so both limiters fail-fast to local under slow-Redis. **Blocking before enabling the block in prod.**

---

## 3. Reference diff

Files touched (all absolute under the worktree root):

- NEW `apps/admin/src/auth/fleet-key-id.ts`
- NEW `apps/admin/src/auth/fleet-ceiling.ts`
- EDIT `apps/admin/src/auth/rate-limit.ts`
- EDIT `apps/admin/src/auth/search-bearer.ts`
- EDIT `apps/admin/src/config/env.ts`
- EDIT `apps/admin/src/infra/redis.ts` _(R3)_
- EDIT `apps/admin/src/graphql/queries/hybrid-search.ts`
- EDIT `apps/admin/src/app/api/search/route.ts`
- Tests (§5)

### D1 — NEW `src/auth/fleet-key-id.ts` (pure, `node:crypto` only)

```ts
import { createHash } from "node:crypto"

/**
 * Stable, non-secret per-fleet-key identity: first 12 hex chars of
 * sha256(rawKey). Safe to bucket on and to log — not reversible to the key,
 * collision-free at 2–4 keys (the raw key is `openssl rand -base64 32`).
 * SECURITY: the raw key must never appear in a bucket name or a log line.
 */
export function fleetKeyIdFromRawKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex").slice(0, 12)
}
```

Own module (only `node:crypto`) so `search-bearer.ts` gets the hash without pulling Redis/env, and it unit-tests trivially pure.

### D2 — NEW `src/auth/fleet-ceiling.ts`

Embeds the merged decisions: enforce-flag gate (R1), `=== threshold` crossing logs (R5), `ceiling===0` kill-switch (R7), full-ceiling local cap (R6/security #1). Plain-string logs per the Railway logsV2 rule.

```ts
// Global per-fleet-key abuse ceiling for the public search path (F1 #2).
// The per-device fleet buckets (identifyForRateLimit, PR #1493) give each
// rotated IP / x-viewer-id its OWN 60/min bucket, so an attacker who extracts
// the bundle-baked fleet key and rotates both is UNBOUNDED by that layer. This
// one global counter per fleet key — spanning all IPs/viewer_ids, on BOTH
// search entry points — is the sole abuse bound.
//
// SECURITY: the bucket + every log line key on `fleetKeyId` (a sha256 prefix),
// NEVER the raw key. Plain-string logs per the Railway logsV2 silencing rule.

import { env } from "@/config/env"
import { incrementFixedWindow } from "@/auth/rate-limit"

export const FLEET_GLOBAL_WINDOW_MS = 60_000
const NEAR_CEILING_RATIO = 0.8

export type FleetCeilingDecision = { overCeiling: boolean }

export async function checkFleetGlobalCeiling(
  fleetKeyId: string,
  path: "graphql" | "rest",
): Promise<FleetCeilingDecision> {
  const ceiling = env.FLEET_SEARCH_GLOBAL_CEILING_PER_MIN
  if (ceiling === 0) return { overCeiling: false } // R7: 0 = operator kill-switch

  const enforce = env.FLEET_SEARCH_CEILING_ENFORCE === "true" // R1: alert-first
  const result = await incrementFixedWindow(
    `fleet-global:${fleetKeyId}`,
    ceiling,
    FLEET_GLOBAL_WINDOW_MS,
  )

  // R5: fire ONCE per window per key on the threshold crossing (INCR is +1),
  // not on every over-threshold request — no log flood during an incident.
  if (result.count === Math.floor(ceiling * NEAR_CEILING_RATIO)) {
    console.warn(
      `[search] event=fleet_ceiling.near path=${path} fleetKey=${fleetKeyId} count=${result.count} ceiling=${ceiling} rl=${result.source}`,
    )
  }

  if (result.source === "local") {
    // R6/security#1: Redis degraded → honor the per-replica local cap (already
    // the FULL ceiling). Bounds a single-replica attack blast at ceiling×replicas
    // instead of infinity; legit fleet traffic never fills a full ceiling on one
    // replica, so real users are not 429'd during an outage. Gated by `enforce`.
    const overLocal = !result.allowed
    if (overLocal) {
      console.warn(
        `[search] event=fleet_ceiling.degraded path=${path} fleetKey=${fleetKeyId} count=${result.count} ceiling=${ceiling} enforce=${enforce} blocked=${enforce && overLocal}`,
      )
    }
    return { overCeiling: enforce && overLocal }
  }

  if (result.count === ceiling + 1) {
    // R5: first-over only (redis INCR grows unbounded past the ceiling).
    console.error(
      `[search] event=fleet_ceiling.exceeded path=${path} fleetKey=${fleetKeyId} count=${result.count} ceiling=${ceiling} enforce=${enforce} rl=redis`,
    )
  }
  return { overCeiling: enforce && !result.allowed }
}
```

### D3 — EDIT `src/auth/rate-limit.ts` (extract the shared primitive)

Add `count` to the result, hoist the Lua, add `incrementFixedWindow`, and — per correctness #2 — convert the pre-existing `redis_unavailable` warn to **plain-string** (the fleet path now routes through this function, so the JSON form would be Railway-silenced on the ceiling path too).

```
  RateLimitResult { allowed: boolean; source: "local" | "redis"; count: number }
```

```ts
const INCR_PEXPIRE_LUA =
  "local c = redis.call('INCR', KEYS[1]) if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end return c"

export async function incrementFixedWindow(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const redis = getRedisClient()
  if (!redis) return localLimit(key, limit, windowMs)
  try {
    const count = (await redis.eval(
      INCR_PEXPIRE_LUA,
      1,
      key,
      windowMs,
    )) as number
    return { allowed: count <= limit, source: "redis", count }
  } catch (err) {
    // correctness#2: plain-string (Railway logsV2 silences JSON from runtime
    // routes); keyPrefix is "search" | "fleet-global" — NEVER the id.
    console.warn(
      `[ratelimit] event=rate_limit.redis_unavailable keyPrefix=${key.split(":")[0]} error=${err instanceof Error ? err.message : String(err)}`,
    )
    return localLimit(key, limit, windowMs)
  }
}

// thin caller — behavior byte-identical to the pre-extraction route limiter
export async function rateLimitAuthRoute({
  limit,
  request,
  route,
  windowMs,
}: {
  limit: number
  request: Request
  route: string
  windowMs: number
}): Promise<RateLimitResult> {
  return incrementFixedWindow(
    `${route}:${getClientIp(request)}`,
    limit,
    windowMs,
  )
}
```

`localLimit` returns `count: attempts.length` on **both** its `allowed:false` and `allowed:true` branches. The fleet ceiling does NOT route through `getClientIp` (which trusts `x-forwarded-for`) — the fleet key is IP-independent by design.

### D4 — EDIT `src/auth/search-bearer.ts`

```
+ import { fleetKeyIdFromRawKey } from "@/auth/fleet-key-id"

  export type BearerCheckResult =
-   | { valid: true; source: BearerSource; keyId?: string }
+   | { valid: true; source: BearerSource; keyId?: string; fleetKeyId?: string }
    | { valid: false }
```

Fleet branch (replace the existing `consumer.valid` block ~99–104):

```ts
const consumer = safeConsumer(authHeader)
if (consumer.valid) {
  // Fleet keys carry a stable, non-secret fleetKeyId (sha256 prefix of the
  // matched key) so the global ceiling buckets per KEY across all IPs/viewer_ids
  // without ever seeing the raw key. Web SSR (source=consumer) has no ceiling.
  if (consumer.fleet) {
    return {
      valid: true,
      source: "fleet",
      fleetKeyId: fleetKeyIdFromRawKey(consumer.bucketKey),
    }
  }
  return { valid: true, source: "consumer" }
}
```

`FLEET_SEARCH_*` are numeric/flag env vars, **not** bearer CSVs → NOT added to `BEARER_CSV_KEYS` or `assertBearerCsvsDisjoint`. Invariant untouched.

### D5 — EDIT `src/infra/redis.ts` (R3)

Beside `maxRetriesPerRequest: 1` / `enableOfflineQueue: false`:

```ts
  // R3: fail-fast to local under a slow-but-connected Redis. Both limiters
  // (per-IP + fleet ceiling) inherit this from the shared client, so a Redis
  // slowdown can't stack unbounded latency on the search hot path.
  commandTimeout: 250,
```

### D6 — EDIT `src/graphql/queries/hybrid-search.ts`

Import after line 15; insert between line 222 (`SEARCH_AUTH_REQUIRED` gate close) and line 224 (`const query = args.q.trim()`) — sheds before query validation / embedding / pgvector.

```ts
import { checkFleetGlobalCeiling } from "@/auth/fleet-ceiling"
```

```ts
      }

      // Global per-fleet-key abuse ceiling (F1 #2). Keyed on authResult (same
      // source as the auth log) so detection + counter never diverge, and on the
      // non-secret fleetKeyId — never the raw key.
      if (authResult.valid && authResult.source === "fleet") {
        if (!authResult.fleetKeyId) {
          // security#5 invariant: a fleet bearer must always carry a fleetKeyId.
          // Loud-degrade (log + allow) — never a silent skip, never a fleet-wide
          // block from a derivation bug. A Datadog monitor pages on this event.
          console.error("[search] event=fleet_ceiling.missing_key_id path=graphql")
        } else {
          const { overCeiling } = await checkFleetGlobalCeiling(authResult.fleetKeyId, "graphql")
          if (overCeiling) {
            throw new GraphQLError("Rate limit exceeded", {
              extensions: { code: "RATE_LIMITED", http: { status: 429 } },
            })
          }
        }
      }

      const query = args.q.trim()
```

> **Decision (design silent-skip via `&& fleetKeyId` vs security #5 "block or loud-degrade"):** **loud-degrade** — log `fleet_ceiling.missing_key_id` and allow. Satisfies security's "never silently allow" while avoiding a fleet-wide 429 from a future derivation bug (the availability weight the reliability review carries). The `/^[0-9a-f]{12}$/` invariant is enforced at test time (§5) and paged on in prod (§6).

**Keying off `authResult` (not `ctx.user`):** REST never builds a principal, so `authResult` is the only signal there — using it on both surfaces gives ONE detection mechanism. A request presenting the fleet key _and_ a valid admin session counts against the fleet ceiling (harmless; any presentation of the extracted key should count against its budget).

### D7 — EDIT `src/app/api/search/route.ts`

Import after line 11; insert the SECOND gate after the 401 gate (after line 154), before `new URL(request.url)`. The existing per-IP gate (lines 86–92) stays **before** auth (junk-bearer protection); the fleet ceiling runs **after** auth because it needs `source === "fleet"`.

```ts
import { checkFleetGlobalCeiling } from "@/auth/fleet-ceiling"
```

```ts
if (!authResult.valid && env.SEARCH_AUTH_REQUIRED === "true") {
  return authenticationRequired(authTag as "invalid_bearer" | "anonymous")
}

// Global per-fleet-key abuse ceiling (F1 #2) — a SECOND gate after auth. The
// per-IP gate can't bound an IP-rotating attacker holding the extracted key.
if (authResult.valid && authResult.source === "fleet") {
  if (!authResult.fleetKeyId) {
    console.error("[search] event=fleet_ceiling.missing_key_id path=rest")
  } else {
    const { overCeiling } = await checkFleetGlobalCeiling(
      authResult.fleetKeyId,
      "rest",
    )
    if (overCeiling) return tooManyRequests()
  }
}

const { searchParams } = new URL(request.url)
```

Optional (additive, at end of the line per field-ordering convention): append `fleetKey=${authResult.fleetKeyId}` to the per-request `search.request` log so operators can correlate normal fleet volume.

---

## 4. New env var(s)

Two new opt-in vars + one client-config change. Both vars `.optional()` with a runtime default (unprovisioned Railway env still boots).

**`FLEET_SEARCH_GLOBAL_CEILING_PER_MIN`** — global per-fleet-key ceiling (count/min).

```ts
// Fragment (~after line 139, beside other numeric fragments). R7: .min(0), with
// 0 = operator kill-switch, so a well-intentioned `=0` can't brick admin boot.
// Sized as a CATASTROPHIC cap above expected AGGREGATE fleet peak (incl. retry
// storms + the 2× fixed-window boundary); tune DOWN from event=fleet_ceiling.near
// counts, never below realistic concurrent-fleet peak.
export const fleetSearchGlobalCeilingPerMinEnvSchema = z.coerce
  .number()
  .int()
  .min(0)
  .optional()
  .default(6000)
```

> **Decision (design `.min(1)` vs reliability R7 `.min(0)`):** **`.min(0)`**. `.min(1)` rejects `0` and bricks boot for an operator who sets `=0` intending "disable." `0` now short-circuits `checkFleetGlobalCeiling` to `{ overCeiling:false }` (a fail-safe runtime disable that can't self-brick).

**`FLEET_SEARCH_CEILING_ENFORCE`** — enforcement flag (R1); ship `"false"`, flip after calibration.

```ts
// R1: alert-first rollout. "false" = compute + WARN/ERROR only (no 429); "true"
// = hard-block at the ceiling. Mirrors the SEARCH_AUTH_REQUIRED string-enum style.
export const fleetSearchCeilingEnforceEnvSchema = z
  .enum(["true", "false"])
  .optional()
  .default("false")
```

Server block (after `FLEET_ADMIN_API_KEYS`, ~line 258, for locality):

```ts
    FLEET_SEARCH_GLOBAL_CEILING_PER_MIN: fleetSearchGlobalCeilingPerMinEnvSchema,
    FLEET_SEARCH_CEILING_ENFORCE: fleetSearchCeilingEnforceEnvSchema,
```

`runtimeEnv` (after line 646):

```ts
    FLEET_SEARCH_GLOBAL_CEILING_PER_MIN: emptyToUndefined(process.env.FLEET_SEARCH_GLOBAL_CEILING_PER_MIN),
    FLEET_SEARCH_CEILING_ENFORCE: emptyToUndefined(process.env.FLEET_SEARCH_CEILING_ENFORCE),
```

**`redis.ts` client config (not an env var):** add `commandTimeout: 250` (§D5 / R3).

---

## 5. Test spec (pure-unit, matching `rate-limit.test.ts` / `search-bearer.test.ts` — no live Redis/DB)

**`src/auth/fleet-key-id.test.ts` (NEW, no mocks):** returns 12-char lowercase hex; **stable** (same input → same output); **distinct** (tv key ≠ mobile key); **never the raw key** (`id !== rawKey`, `rawKey` not a substring of `id`).

**`src/auth/fleet-ceiling.test.ts` (NEW):** `vi.mock("@/config/env")` → `{ FLEET_SEARCH_GLOBAL_CEILING_PER_MIN: 10, FLEET_SEARCH_CEILING_ENFORCE: "true" }`; `vi.mock("@/auth/rate-limit")` so `incrementFixedWindow` returns scripted `{ allowed, source, count }`; spy `console.warn`/`console.error`.

- **under, redis** (`allowed:true, redis, count:5`) → `{overCeiling:false}`; no `.exceeded`/`.near`.
- **over, redis** (`allowed:false, redis, count:11`) → `{overCeiling:true}` + `console.error … event=fleet_ceiling.exceeded … rl=redis`.
- **first-over ===** (R5): `count:11` emits `.exceeded`; `count:12` does NOT (only the `=== ceiling+1` boundary matches).
- **near-crossing ===** (R5): `count:8` (= floor(10×0.8)) with `allowed:true` emits `.near`; `count:7` and `count:9` do NOT.
- **fail-open local cap** (R6/security#1): `allowed:false, source:"local", count:11` → `{overCeiling:true}` + `console.warn … fleet_ceiling.degraded … blocked=true`. **Only this branch matches** — deleting the `source==="local"` handling flips behavior and fails the test.
- **local under cap:** `allowed:true, source:"local", count:5` → `{overCeiling:false}`, no `.degraded`.
- **enforce=false** (R1): re-mock env `FLEET_SEARCH_CEILING_ENFORCE:"false"`; `allowed:false, redis, count:11` → `{overCeiling:false}` but `.exceeded` STILL logged (calibration signal). The **only** branch where over-ceiling does not block.
- **kill-switch** (R7): env `…CEILING_PER_MIN:0` → `{overCeiling:false}` and `incrementFixedWindow` NOT called.
- **path tag / no raw key:** `path:"graphql"` vs `"rest"` appears verbatim; every spy-call arg contains `fleetKey=<id>` and no raw-key-shaped value (structural — the fn only receives `fleetKeyId`).

**`src/auth/search-bearer.test.ts` (EXTEND):**

- fleet case (existing lines 59–68): now `{ valid:true, source:"fleet", fleetKeyId }`; assert `fleetKeyId` matches `/^[0-9a-f]{12}$/`, `!==` the raw key, and does not contain it. **security#5 invariant test:** assert every `source==="fleet"` result carries a `/^[0-9a-f]{12}$/` id.
- consumer/web-SSR case (lines 49–57): `toEqual({ valid:true, source:"consumer" })` — no `fleetKeyId` (discriminator: non-fleet keys carry no ceiling identity).

**`src/auth/rate-limit.test.ts` (EXTEND + FIX — correctness #1):**

- **FIX** the three exact-equality assertions at lines 26, 35, 53: `toEqual({ allowed, source })` now fails because the result carries `count`. Switch to `toMatchObject` or add `count` to each expected literal.
- **NEW** `incrementFixedWindow`: with `getRedisClient()→null`, `incrementFixedWindow("k",3,60_000)` returns `source:"local"` with `count` 1,2,3 then `allowed:false` at the 4th.
- existing two-IP independence cases stay green (extraction preserved behavior).

**Route-mock typecheck fixes — correctness #1 (`count` is required on `RateLimitResult`):** add `count` to the `rateLimitAuthRoute` mock return literals in:

- `src/app/api/search/route.test.ts:83-92`
- `src/app/api/search/health/route.test.ts:37-45`
- `src/app/api/scene-embedding/recommendations/route.test.ts:27-35`

Without these three edits the typecheck goes red (`vi.mocked(...).mockResolvedValue({ allowed, source })` is missing `count`). This is a hard failure, not a "confirm."

**`src/graphql/queries/hybrid-search.test.ts` (EXTEND):** mock `isAnyKnownBearer` + `checkFleetGlobalCeiling` + `HybridSearchService`.

- fleet + `{overCeiling:true}` → throws `GraphQLError`, `extensions.http.status===429`, `code==="RATE_LIMITED"`, service `search` NOT called (shed before work).
- fleet + `{overCeiling:false}` → service called.
- `source:"consumer"` → `checkFleetGlobalCeiling` NOT called.
- **missing-id** (security#5): fleet result with no `fleetKeyId` → `console.error … missing_key_id path=graphql`, `checkFleetGlobalCeiling` NOT called, request PROCEEDS (loud-degrade, not block).

**`src/app/api/search/route.test.ts` (EXTEND):** fleet + `{overCeiling:true}` → 429, service NOT called; fleet + under → 200; non-fleet → ceiling not consulted; top per-IP gate still fires first (existing test unaffected); missing-id → `missing_key_id path=rest` + proceeds.

---

## 6. Datadog monitor query

Source = plain-string admin logs forwarded via `src/observability/datadog-logs.ts` (service `forge-admin`). Group by `@fleetKey` so tv and mobile alert independently.

**Warn (fires BEFORE hard-block — the primary trigger):**

```
logs("service:forge-admin \"event=fleet_ceiling.near\" rl:redis")
  .rollup("count").by("@fleetKey").last("5m") > 0
```

With R5's `=== threshold` crossing, one `.near` per window per key. `rl:redis` excludes per-replica local-fallback noise during an outage — **load-bearing** (correctness #3).

**Page (hard-block reached):**

```
logs("service:forge-admin \"event=fleet_ceiling.exceeded\"")
  .rollup("count").by("@fleetKey").last("5m") > 0
```

**Invariant-violation page (security#5):**

```
logs("service:forge-admin \"event=fleet_ceiling.missing_key_id\"")
  .rollup("count").last("5m") > 0
```

**Redis-degraded (info/warn):** monitor `event=fleet_ceiling.degraded` and `event=rate_limit.redis_unavailable keyPrefix:fleet-global` to see when the ceiling is on the local-cap path.

**Dependency:** grouping by `@fleetKey` needs a Datadog log-pipeline **keyvalue (grok) parser** over `[search] event=… key=value` extracting `fleetKey`, `count`, `ceiling`, `rl`, `path`, `enforce`. If none exists, match on raw message substring (no per-key grouping). Recommend a **log-based metric** (`fleet_ceiling.near` faceted by `fleetKey` + `path`) + a dashboard widget of `count` vs `ceiling` per key for cheap long-term monitoring and calibration.

---

## 7. Mint keys + receiver-first deploy runbook

**Mint (one key per surface — NEVER shared):**

```
openssl rand -base64 32   # → TV fleet key
openssl rand -base64 32   # → mobile fleet key
```

Add both as **values** in `FLEET_ADMIN_API_KEYS` in the **forge-admin Doppler** project, disjoint from every other bearer CSV (a reused value fails admin boot via `assertBearerCsvsDisjoint`, redacted). Per-surface keys keep the shared-fate radius to one surface: a mobile-key attack only 429s mobile users.

**Sequence (receiver-first — keys live in admin BEFORE any client ships them, or first calls 401):**

1. **Land + deploy the abuse-ceiling PR** (this handoff) with `FLEET_SEARCH_CEILING_ENFORCE=false` (alert-only) and `commandTimeout` in place.
2. **Mint keys → add to Doppler → deploy admin.**
3. **feat-241 provisions `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN` in EAS + rebuilds** tv/mobile.
4. **Calibrate + flip enforcement:** as token-bearing builds reach users, read `event=fleet_ceiling.near` `count=` distributions, ratchet `FLEET_SEARCH_GLOBAL_CEILING_PER_MIN` to ~3–5× observed p99 aggregate, then set `FLEET_SEARCH_CEILING_ENFORCE=true` (Doppler + redeploy).
5. **Flip required-auth:** confirm `auth=anonymous` has drained from search logs, then set `SEARCH_AUTH_REQUIRED=true`. **Only after this is the ceiling a real abuse bound** (security#2). The abuse-ceiling PR alone does NOT satisfy F1 precondition #2.

**Separately-owned dependency:** origin-bypass precondition #1 (locking the raw `*.up.railway.app` origin) is owned by the admin CMS owner and must ALSO be closed before any token ships (§1). Not specced here.

**Rotation overlap + incident response:** keep the old fleet key valid for a multi-week rotation overlap (expect aggregate `2 × ceiling` per surface during overlap — security#6). Env-CSV keys have **no** sub-second revocation: incident response = rotate the CSV + redeploy (revokes fleet-wide but breaks fleet search until a new build ships), with a **Cloudflare edge block** of the abusive pattern as the no-user-impact interim (§2.4).

---

## 8. Verification checklist

**Code / tests**

- [ ] `fleet-key-id.ts` + `fleet-ceiling.ts` added; `search-bearer.ts` fleet branch surfaces `fleetKeyId`; both guards handle missing-id as loud-degrade.
- [ ] `incrementFixedWindow` extracted; `rateLimitAuthRoute` byte-identical; `count` threaded on both `localLimit` branches; `redis_unavailable` warn converted to **plain-string** (correctness#2).
- [ ] `redis.ts` `commandTimeout: 250` added (R3) — **blocking before enabling the block**.
- [ ] Env: `FLEET_SEARCH_GLOBAL_CEILING_PER_MIN` (`.min(0).optional().default(6000)`, `0`=disable) + `FLEET_SEARCH_CEILING_ENFORCE` (`enum["true","false"].optional().default("false")`) in fragment, server block, `runtimeEnv`; NOT in `BEARER_CSV_KEYS` / `assertBearerCsvsDisjoint`.
- [ ] The **four** test files correctness#1 flags compile + pass (rate-limit `toEqual`→count on 3 assertions; 3 route mocks add `count`).
- [ ] New tests green: every discriminator has a branch-only-match test — over/under, first-over `===`, near `===`, fail-open local cap (only local+over), enforce=false (only non-blocking over), kill-switch, fleet-vs-consumer, missing-id, GraphQL + REST.
- [ ] `pnpm --filter @forge/admin typecheck && test` green.

**Config / infra**

- [ ] GraphQL Armor `maxAliases` + request-batching caps confirmed ON on `/api/graphql` (reliability R4) — else the ceiling's cost bound is defeated by one crafted request.
- [ ] Datadog keyvalue/grok parser facets `[search] event=…` into `@fleetKey`/`count`/`ceiling`/`rl`/`path`/`enforce`; three monitors created (`.near` warn, `.exceeded` page, `.missing_key_id` page) + `.degraded`/`redis_unavailable` visibility.
- [ ] Redis ceiling key on a non-evicting `maxmemory-policy` (or residual accepted — §2.5).

**Rollout gates**

- [ ] Ship with `FLEET_SEARCH_CEILING_ENFORCE=false`; verify `.near`/`.exceeded` logs appear with `enforce=false blocked=false` and no 429s.
- [ ] After calibration: `FLEET_SEARCH_CEILING_ENFORCE=true`; verify a synthetic over-ceiling fleet key gets 429 on **both** GraphQL and REST and the service is not invoked.
- [ ] `auth=anonymous` drained → `SEARCH_AUTH_REQUIRED=true`; only then treat F1 precondition #2 as satisfied.
- [ ] Origin-bypass precondition #1 confirmed closed by the admin CMS owner before any token ships.
