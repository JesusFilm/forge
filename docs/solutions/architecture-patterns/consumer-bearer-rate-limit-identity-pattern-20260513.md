---
module: apps/admin
date: "2026-05-13"
last_updated: "2026-06-12"
problem_type: architecture_pattern
component: authentication
severity: medium
applies_when:
  - Multiple SSR app instances share a single egress IP behind a Railway service
  - A downstream API enforces per-IP rate limits that would collapse under shared-IP SSR traffic
  - You need to bucket or label inbound traffic by caller identity without granting any data permissions
  - A new auth principal is needed purely for rate-limit bucketing, not authorization
related_components:
  - apps/web
  - packages/graphql
tags:
  - rate-limiting
  - bearer-token
  - auth-principal
  - ssr-traffic
  - railway
  - identity-labeling
  - consumer-migration
  - architecture-pattern
---

# CONSUMER_BEARER identity-for-rate-limiting pattern

A bearer-key auth principal whose entire purpose is to label SSR traffic for rate-limit bucketing. Has ZERO data permissions; isn't an authorization credential. Solves the shared-egress-IP collision that hits server-side rendering services routed through one Railway egress NAT.

## Context

Web's SSR rendering on Railway runs multiple concurrent requests that share a single egress IP (Railway's outbound NAT). Admin's rate-limit `identifyFn` was bucketing anonymous traffic as `public:<cf-connecting-ip>`. With 100 concurrent SSR renders, all 100 hits landed on one bucket — admin rate-limited web's SSR traffic as if a single IP was hammering it, causing self-DoS during traffic spikes. The core issue: shared-egress callers collapse to one rate-limit slot.

Mobile and TV don't share this problem. Each device hits admin from its own IP (mobile-carrier NAT or device egress), so the anonymous-IP bucket naturally distributes across the device population. The fix is only needed when a known service routes through a shared upstream IP.

**Correction (2026-07-13):** the claim above is only partly true. Under IPv4 carrier-grade NAT (CGNAT), many mobile devices DO egress through one shared public IP and collapse into a single per-IP bucket. And once TV/mobile ship a shared baked-in fleet bearer, the anonymous-IP path no longer applies at all — that bearer buckets `consumer:<key>` and needs per-device sub-keying. The direct-to-device fleet answer is per-device bucketing via a client-generated `viewer_id` — see [`rate-limit-bucket-key-availability-not-abuse-ceiling.md`](./rate-limit-bucket-key-availability-not-abuse-ceiling.md).

**Fleet-client corollary (2026-06-12).** The inverse also holds and is a real failure mode, not a no-op: a device fleet that ships one baked-in consumer bearer and attaches it globally collapses every install into the single `consumer:<key>` bucket — strictly worse than the anonymous per-IP bucketing the fleet already gets for free. When a fleet client presents the bearer on a search operation, scope it to exactly that operation and leave all public queries anonymous. See [`fleet-client-bearer-must-be-operation-scoped-not-global.md`](./fleet-client-bearer-must-be-operation-scoped-not-global.md). **Updated 2026-07-23:** this originally read "for a gated operation (e.g. `Query.search` under `SEARCH_AUTH_REQUIRED`)". Since admin #1622 the operation is `watchSearch` and it is not gated at all — the bearer buys bucket identity, not admission. Scoping matters more now, not less: a mismatch no longer fails loudly.

The pattern adds a dedicated principal role — `CONSUMER_BEARER` — that identifies web's SSR traffic to admin using a bearer key, giving the rate-limiter a per-app stable identity to bucket against instead of the shared egress IP.

## Guidance

Three components work together:

### a. Define a service-account principal with a literally empty permission set

Not "limited" — `CONSUMER_BEARER_PERMISSIONS` is `new Set()`, and `hasPermission` short-circuits explicitly for this role before it even reaches the tier ladder:

```ts
// apps/admin/src/auth/permissions.ts
const CONSUMER_BEARER_PERMISSIONS: ReadonlySet<PermissionKey> = new Set()

export function hasPermission(
  user: Principal | null,
  key: PermissionKey,
): boolean {
  const role = principalRole(user)
  // ...workflow path...
  if (role === "CONSUMER_BEARER") {
    return CONSUMER_BEARER_PERMISSIONS.has(key) // always false
  }
  // ...editorial tier ladder...
}
```

The explicit early-return makes the zero-permission contract visible at the call site rather than requiring the reader to derive it from `meetsTier`'s ladder.

### b. Validate via `timingSafeEqual` against a CSV keyring env var

Mirror the `workflow-bearer.ts` pattern — same structure, different env var (`WEB_ADMIN_API_KEYS` vs `WORKFLOW_API_KEYS`). Iterate the full allowlist without short-circuiting on first match. Use `Buffer.byteLength` to guard against UTF-8/UTF-16 length mismatch before calling `timingSafeEqual` (which throws `RangeError` on unequal-length buffers).

```ts
// apps/admin/src/auth/consumer-bearer.ts
export function isValidConsumerBearer(
  authHeader: string | null,
): ConsumerBearerResult {
  // ...null/prefix checks...
  let matchedKey: string | null = null
  const presentedBuf = Buffer.from(presented)
  for (const key of keys) {
    const keyBuf = Buffer.from(key)
    if (keyBuf.length !== presentedBuf.length) continue
    if (timingSafeEqual(presentedBuf, keyBuf)) matchedKey = key
  }
  if (matchedKey === null) return { valid: false, bucketKey: null }
  return { valid: true, bucketKey: matchedKey }
}
```

### c. Mint the principal carrying `rateLimitBucketKey` so identifyFn never re-inspects headers

```ts
// apps/admin/src/auth/principal.ts
export function CONSUMER_BEARER_PRINCIPAL({
  rateLimitBucketKey,
}: {
  rateLimitBucketKey: string
}): Principal {
  return { id: null, role: "CONSUMER_BEARER", rateLimitBucketKey }
}

// apps/admin/src/graphql/context.ts
// Resolution chain: session → workflow-bearer → consumer-bearer → PUBLIC
const consumer = isValidConsumerBearer(authHeader)
if (consumer.valid) {
  user = CONSUMER_BEARER_PRINCIPAL({ rateLimitBucketKey: consumer.bucketKey })
}

// apps/admin/src/graphql/plugins/rate-limit.ts
export function identifyForRateLimit(ctx: ContextShape): string {
  if (ctx.user?.id) return ctx.user.id
  if (
    ctx.user?.role === "CONSUMER_BEARER" &&
    ctx.user.rateLimitBucketKey != null
  ) {
    return `consumer:${ctx.user.rateLimitBucketKey}`
  }
  return `public:${getClientIp(ctx.request)}`
}
```

Resolution chain order matters: session wins, then workflow-bearer, then consumer-bearer, then PUBLIC. Workflow before consumer ensures a mistakenly overlapping key doesn't silently downgrade a workflow caller to a permissionless bucket.

## Why This Matters

**Public-equivalent permissions, no widening risk.** `CONSUMER_BEARER_PERMISSIONS` is specifically empty so the bearer can't access anything an anonymous public request can't. Editorial data, drafts, workflow triggers — all remain behind their existing gates. The caller gains a stable rate-limit identity, nothing else.

The empty-set property is specific to CONSUMER_BEARER's purpose (rate-limit bucketing, not authorization). Other bearer-minted principals may carry narrow non-empty permission sets — see [PARITY_BEARER narrow-carve-out pattern](./parity-bearer-narrow-carveout-pattern-20260513.md) for the carve-out variant.

**Per-app isolation.** Each consumer service gets its own `WEB_ADMIN_API_KEYS` CSV entry. One app's traffic can't exhaust another's rate-limit budget; they get separate buckets keyed by their distinct bearer values.

**CI-enforced empty permissions across two surfaces.** The zero-permission invariant is not just a comment — it's asserted in tests:

1. The permissions test enumerates every `PermissionKey` and asserts `hasPermission(CONSUMER_BEARER_PRINCIPAL("any"), key) === false` for all of them (editorial surface).
2. A separate assertion verifies `CONSUMER_BEARER` has no workflow-trigger permissions and that `WEB_ADMIN_API_KEYS !== WORKFLOW_API_KEYS` (workflow-trigger isolation).

Adding any key to `CONSUMER_BEARER_PERMISSIONS` is a CI failure, not a documentation violation.

**Threat model: rate-limit budget abuse, not data exposure.** A leaked `WEB_ADMIN_API_KEYS` entry lets an attacker impersonate web's SSR bucket and consume its rate-limit quota. It does NOT grant access to any data. This is categorically different from a leaked session token or workflow bearer (which has a narrow but real permission set). Communicate this distinction when rotating keys — the rotation urgency is operational, not a breach.

## When to Apply

Apply this pattern when all four conditions hold:

1. The caller is a known service (web SSR, internal tool, another app) with a stable, operator-controlled identity.
2. The caller's traffic routes through a shared upstream IP — Railway egress NAT, a proxy cluster, a VPC egress, or any shared NAT that collapses multiple logical clients onto one IP.
3. You need rate-limit isolation for the caller, NOT permission elevation. If the caller needs to satisfy any permission key, either extend `WORKFLOW_TRIGGER_PERMISSIONS` with deliberate blast-radius analysis (when the audience is genuinely the same) OR mint a new bearer role with its own narrow allowlist (see [PARITY_BEARER pattern](./parity-bearer-narrow-carveout-pattern-20260513.md)).
4. Per-device callers (mobile, TV, end-user browsers) don't need this — their IPs are already distinct and distribute naturally across the anonymous-IP bucket. **Never attach a consumer bearer globally from a fleet client** — that pools the whole fleet onto one bucket; if a fleet must satisfy a gated operation, scope the bearer to that operation only (see [`fleet-client-bearer-must-be-operation-scoped-not-global.md`](./fleet-client-bearer-must-be-operation-scoped-not-global.md)).

## Examples

**Empty permission set declaration:**

```ts
const CONSUMER_BEARER_PERMISSIONS: ReadonlySet<PermissionKey> = new Set()
```

**`hasPermission` early-return for the role:**

```ts
if (role === "CONSUMER_BEARER") {
  return CONSUMER_BEARER_PERMISSIONS.has(key) // always false
}
```

**Principal factory carrying `rateLimitBucketKey`:**

```ts
export function CONSUMER_BEARER_PRINCIPAL({
  rateLimitBucketKey,
}: {
  rateLimitBucketKey: string
}): Principal {
  return { id: null, role: "CONSUMER_BEARER", rateLimitBucketKey }
}
```

**`identifyFn` extension returning `consumer:${bucketKey}`:**

```ts
if (
  ctx.user?.role === "CONSUMER_BEARER" &&
  ctx.user.rateLimitBucketKey != null
) {
  return `consumer:${ctx.user.rateLimitBucketKey}`
}
```

**CI-assertion test pattern (both surfaces):**

```ts
// Surface 1 — editorial: every PermissionKey returns false
for (const key of ALL_PERMISSION_KEYS) {
  expect(hasPermission(CONSUMER_BEARER_PRINCIPAL("test-key"), key)).toBe(false)
}

// Surface 2 — workflow-trigger isolation
expect(WORKFLOW_TRIGGER_PERMISSIONS.has("some:key")).toBe(false)
expect(env.WEB_ADMIN_API_KEYS).not.toBe(env.WORKFLOW_API_KEYS)
```

## Related Patterns

- [`docs/solutions/architecture-patterns/fleet-client-bearer-must-be-operation-scoped-not-global.md`](./fleet-client-bearer-must-be-operation-scoped-not-global.md) — **the fleet-client corollary**: what happens when a device fleet presents this bearer globally (single-bucket collapse), and the operation-scoped ApolloLink shape that avoids it.
- [`docs/solutions/architecture-patterns/parity-bearer-narrow-carveout-pattern-20260513.md`](./parity-bearer-narrow-carveout-pattern-20260513.md) — **second worked instance**, extending this pattern in three ways: (1) narrow non-empty permission allowlist (one key grant rather than the empty set), (2) three-way disjointness invariant across N bearer CSVs with module-load assertion, (3) distinct rate-limit namespace prefixes per role so siblings don't share quotas. Read first when introducing a third bearer-minted principal — the two-way `WEB_ADMIN_API_KEYS !== WORKFLOW_API_KEYS` assertion in this doc doesn't generalize to N siblings.
- [`docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`](../platform/admin-manager-enrichment-trigger-endpoint-20260506.md) — cross-app receiver-first rotation rule. Apply the same deploy-receiver-first ordering when rotating `WEB_ADMIN_API_KEYS`: update admin's keyring CSV first, deploy admin, then update web's value, then deploy web. Reverse ordering produces a dead window where the caller's request 401s.
- [`docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`](../runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md) — `WEB_ADMIN_API_KEYS` must be `.optional()` in both web and admin env schemas. Required-without-default has bricked Railway deploys before; opt-in scaffolding env vars need defensive optionality.
- [`docs/solutions/auth/spike-auth-header-must-be-env-gated.md`](../auth/spike-auth-header-must-be-env-gated.md) — contrast note: spike auth-header patterns grant a role; CONSUMER_BEARER grants nothing. The patterns are kin but on opposite ends of the "permissions granted by a header" spectrum.

## Notes

- **Threat-model communication.** When documenting key rotation procedures, explicitly distinguish "leaked CONSUMER_BEARER = rate-limit budget abuse" from "leaked workflow bearer or session token = data access." Operators reading the runbook should not over-escalate a rotation that's operational, not a breach.
- **Plan-003 cutover sourcing.** This pattern was introduced in PR #932 (`feat(admin): admin-core consumer migration — CONSUMER_BEARER principal (Unit 1)`) on branch `feat/admin-consumer-migration-pr-a`. Cutover plan: [`docs/plans/2026-05-11-003-feat-web-admin-direct-cutover-plan.md`](../../plans/2026-05-11-003-feat-web-admin-direct-cutover-plan.md). Brainstorm: [`docs/brainstorms/2026-05-11-consumer-migration-u5b-strapi-sunset-strategy-requirements.md`](../../brainstorms/2026-05-11-consumer-migration-u5b-strapi-sunset-strategy-requirements.md).
- **Session-history search:** skipped on the 2026-05-13 compound run due to context-budget constraints. The pattern documented here was newly authored in this session; no prior-session investigation was needed.
- **Discoverability check:** root `CLAUDE.md` Known Patterns list should add a one-line entry referencing this doc and the `docs/solutions/` index so future planner brainstorms grep it. Filed as `PS-001` in the parallel ce-code-review pass; intentional follow-up.
- **2026-05-13 update:** PARITY_BEARER landed as the second worked instance of this pattern (PR #935). Three sections in this doc were softened to acknowledge that the empty-permission-set property is specific to CONSUMER_BEARER's rate-limit-bucketing purpose, not a universal property of the bearer-identity pattern. The sibling doc carries the carve-out variant.
