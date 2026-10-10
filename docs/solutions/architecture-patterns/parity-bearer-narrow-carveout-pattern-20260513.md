---
module: apps/admin
date: "2026-05-13"
problem_type: architecture_pattern
component: authentication
severity: high
applies_when:
  - A service-layer rule deliberately hides resources from an existing bearer-minted principal (e.g., admin's R9 hides templates from CONSUMER_BEARER)
  - A narrower surface (verification harness, migration tool) needs to read exactly those hidden resources
  - The existing principal is consumed by many surfaces, so widening it propagates the new permission everywhere
  - You already have one or more bearer-minted principals and are about to introduce a third
related_components:
  - apps/admin
  - packages/graphql
tags:
  - bearer-auth
  - defense-in-depth
  - least-privilege
  - parity-harness
  - consumer-migration
  - pothos-scope-auth
  - rate-limit-identity
  - disjointness-invariant
---

# PARITY_BEARER narrow-carve-out pattern

A second bearer-minted principal that grants exactly one permission to a verification surface — without widening the existing principal that other surfaces share. Three load-bearing pieces: (1) a narrow permission-key allowlist, (2) a runtime disjointness invariant across all bearer CSVs, (3) a distinct rate-limit namespace per role. Companion to and deliberate extension of the [CONSUMER_BEARER identity pattern](./consumer-bearer-rate-limit-identity-pattern-20260513.md).

## Context

Admin's R9 rule hides template Experiences from CONSUMER_BEARER (web/mobile/TV SSR) at the service layer so a consumer can never render a template as a real page. The pre-cutover batch-verification harness in `packages/graphql/scripts/run-batch-verification.ts` must enumerate templates to prove Strapi↔admin parity before the env flip — but the harness runs as CONSUMER_BEARER and is therefore blind to admin's templates.

Two design paths existed:

1. **Widen CONSUMER_BEARER.** Add `read:experience-templates` to `CONSUMER_BEARER_PERMISSIONS`. Five-character diff. Defeats R9 for every consumer SSR surface in the process — web, mobile, TV all suddenly gain the ability to fetch templates by slug.

2. **Mint a sibling principal.** New `PARITY_BEARER` role, new `PARITY_API_KEYS` env var, single narrow grant: `read:experience-templates` and nothing else. R9 stays intact for consumer SSR; the harness gets exactly what it needs and nothing more.

Path 2 shipped (PR #935). The diff is larger but the security boundary is preserved.

This pattern generalizes: when an existing principal is too narrow for a new caller AND too widely shared to safely widen, mint a sibling.

## Guidance

Eight components, each load-bearing:

### 1. Add the role to the shared `Role` union and document the bucket namespace

`apps/admin/src/auth/principal.ts`:

```ts
export type Role =
  | "ADMIN"
  | "EDITOR"
  | "VIEWER"
  | "PUBLIC"
  | "SYSTEM"
  | "WORKFLOW_TRIGGER"
  | "CONSUMER_BEARER"
  | "PARITY_BEARER"
```

The principal factory mirrors `CONSUMER_BEARER_PRINCIPAL` byte-for-byte. The `rateLimitBucketKey` JSDoc must explicitly enumerate which roles use it AND which namespace each role gets — without that, the next contributor will assume "set only on CONSUMER_BEARER" and miss the per-role contract.

### 2. Mirror the bearer-validator file byte-for-byte except for the env var

`apps/admin/src/auth/parity-bearer.ts` clones `consumer-bearer.ts`. The only diff is `env.PARITY_API_KEYS` vs `env.WEB_ADMIN_API_KEYS`. Same `timingSafeEqual` walk (no first-match short-circuit), same `Buffer.byteLength` length guard (UTF-8 mismatch crashes `timingSafeEqual` otherwise), same "never logs the header or matched key" discipline.

Boring is the point. Security primitives shouldn't drift between siblings.

### 3. Define the permission key at a sensible tier, then carve it out with a single-entry allowlist

```ts
// apps/admin/src/auth/permissions.ts
export type PermissionKey =
  | "read:experiences"
  | "read:experience-templates"  // PR-C: narrow R9 carve-out
  | ...

const permissionMatrix: Record<PermissionKey, MinTier> = {
  "read:experiences": "VIEWER",
  "read:experience-templates": "VIEWER",  // VIEWER+ (editorial staff) AND PARITY_BEARER via allowlist
  ...
}

const PARITY_BEARER_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  "read:experience-templates",
])

export function hasPermission(user, key) {
  const role = principalRole(user)
  if (role === "WORKFLOW_TRIGGER") return WORKFLOW_TRIGGER_PERMISSIONS.has(key)
  if (role === "CONSUMER_BEARER") return CONSUMER_BEARER_PERMISSIONS.has(key)
  if (role === "PARITY_BEARER") return PARITY_BEARER_PERMISSIONS.has(key)
  return meetsTier(role, permissionMatrix[key])
}
```

Two paths grant the new permission:

- **VIEWER+ via the editorial tier ladder** — staff translators/reviewers legitimately need to inspect templates.
- **PARITY_BEARER via the explicit allowlist** — the harness.

PUBLIC and CONSUMER_BEARER fall through to the tier ladder, fail it (PUBLIC tier doesn't include the key, CONSUMER's allowlist is empty), and are correctly denied. R9's defense-in-depth holds for consumer SSR.

The early-return for PARITY_BEARER makes the contract explicit at the call site. A reader doesn't have to derive "narrow set" from the tier ladder.

### 4. Declare the env var `.optional()`, then enforce three-way disjointness at module load

```ts
// apps/admin/src/config/env.ts
PARITY_API_KEYS: z.string().optional(),
```

`.optional()` is load-bearing: required-without-default bricks Railway deploys for environments without the harness (preview, dev) per [the required-env-var learning](../runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md).

Then assert disjointness across all three bearer CSVs at module load:

```ts
function parseBearerCsvSet(csv: string | undefined): ReadonlySet<string> {
  if (!csv || csv.trim() === "") return new Set()
  return new Set(csv.split(",").map((s) => s.trim()).filter((s) => s.length > 0))
}

export function assertBearerCsvsDisjoint(snapshot: BearerCsvSnapshot): void {
  const workflow = parseBearerCsvSet(snapshot.WORKFLOW_API_KEYS)
  const consumer = parseBearerCsvSet(snapshot.WEB_ADMIN_API_KEYS)
  const parity = parseBearerCsvSet(snapshot.PARITY_API_KEYS)
  for (const [aName, aSet, bName, bSet] of pairs(workflow, consumer, parity)) {
    for (const key of aSet) {
      if (bSet.has(key)) {
        throw new Error(
          `Bearer API key value appears in multiple CSVs: ${aName} and ${bName} ` +
            `must be disjoint... key value redacted.`,
        )
      }
    }
  }
}

assertBearerCsvsDisjoint({ ... })  // Fires on every import of env.
```

The error message **never includes the offending key value** — only the env var names. A key value that appears in `assertBearerCsvsDisjoint`'s error log is itself a leak.

Disjointness matters because the context auth chain (`workflow → parity → consumer → public`) silently mints the higher-tier principal if a key value appears in two CSVs. A pasting mistake during rotation could otherwise grant the harness's key WORKFLOW_TRIGGER's `write:scene-embeddings` reach.

### 5. Resolve auth in fixed precedence: session > narrowest-bearer > broader-bearer > public

`apps/admin/src/graphql/context.ts`:

```ts
let user = sessionUser
if (user == null) {
  const authHeader = request.headers.get("authorization")
  if (isValidWorkflowBearer(authHeader)) {
    user = WORKFLOW_TRIGGER_PRINCIPAL
  } else {
    const parity = isValidParityBearer(authHeader)
    if (parity.valid) {
      user = PARITY_BEARER_PRINCIPAL({ rateLimitBucketKey: parity.bucketKey })
    } else {
      const consumer = isValidConsumerBearer(authHeader)
      if (consumer.valid) {
        user = CONSUMER_BEARER_PRINCIPAL({
          rateLimitBucketKey: consumer.bucketKey,
        })
      } else {
        user = null
      }
    }
  }
}
```

Two invariants:

- **Session wins.** An editor with a session cookie who also forwards a bearer header isn't silently downgraded.
- **Narrowest bearer wins on collision.** If disjointness ever drifts (the §4 assertion is a safety net, not a guarantee), the narrowest-allowlist principal wins. Workflow's blast radius is tighter than parity's; parity's is tighter than consumer's.

### 6. Bucket the new role in its own rate-limit namespace

`apps/admin/src/graphql/plugins/rate-limit.ts`:

```ts
export function identifyForRateLimit(ctx): string {
  if (ctx.user?.id) return ctx.user.id
  if (
    ctx.user?.role === "CONSUMER_BEARER" &&
    ctx.user.rateLimitBucketKey != null
  ) {
    return `consumer:${ctx.user.rateLimitBucketKey}`
  }
  if (
    ctx.user?.role === "PARITY_BEARER" &&
    ctx.user.rateLimitBucketKey != null
  ) {
    return `parity:${ctx.user.rateLimitBucketKey}`
  }
  return `public:${getClientIp(ctx.request)}`
}
```

Distinct prefix per role. Without this, the harness falls through to `public:<egress-ip>` and self-DoSes against its own IP — the exact scenario `BearerMissingError` exists to prevent.

Distinct from `consumer:` (not shared) so a gate run can't chew through web SSR's quota and vice versa. Independent quotas, forensically separable in the rate-limit store.

### 7. Gate one Pothos field with the new permission key

`apps/admin/src/graphql/types/experience.ts`:

```ts
experienceTemplates: t.prismaField({
  type: ["ExperienceLocale"],
  nullable: false,
  authScopes: { hasPermission: "read:experience-templates" },
  description:
    "INTERNAL — pre-cutover parity verification only; will be removed at R8 cutover.",
  args: {
    locale: t.arg.string({ required: true }),
    limit: t.arg.int({ required: false, defaultValue: 50 }),
    offset: t.arg.int({ required: false, defaultValue: 0 }),
  },
  resolve: (query, _root, args, ctx) =>
    ctx.services.experience.listTemplateLocales({
      ...args,
      user: ctx.user,
      query,
    }),
})
```

`INTERNAL — ...will be removed at R8 cutover` in the description is clearer than `@deprecated`, which would mislead the harness team (whose job IS to call this field). Pagination is required even on an internal field — an authenticated PARITY/VIEWER caller can otherwise drive unbounded scans.

The service-layer mirror gates the same key:

```ts
async listTemplateLocales({ locale, limit, offset, user, query }) {
  if (!hasPermission(user, "read:experience-templates")) {
    throw new ForbiddenError()
  }
  return this.prisma.experienceLocale.findMany({ ... })
}
```

Defense in depth — scope-auth could be bypassed by a future contributor who edits the field's `authScopes` without noticing; the service layer catches that.

### 8. Consumer of the new principal prefers it, falls back gracefully, and surfaces the choice

`packages/graphql/src/parity/batch-verification.ts`:

```ts
export type BearerResolution = {
  readonly bearer: string | null
  readonly templatesPermitted: boolean
  readonly source: "parity" | "consumer" | "anonymous"
}

export function readBearerFromEnv(env, anonymous): BearerResolution {
  if (anonymous) return { bearer: null, templatesPermitted: false, source: "anonymous" }
  const parity = firstCsvEntry(env.PARITY_API_KEYS)
  if (parity !== null) return { bearer: parity, templatesPermitted: true, source: "parity" }
  const consumer = firstCsvEntry(env.WEB_ADMIN_API_KEYS)
  if (consumer !== null) return { bearer: consumer, templatesPermitted: false, source: "consumer" }
  throw new BearerMissingError(...)
}
```

The consumer writes one stderr line at startup so reviewers reading the gate report know which mode ran:

```
[run-batch-verification] running with PARITY_API_KEYS — templates included in corpus.
```

And in fallback mode:

```
[run-batch-verification] WARN: running with WEB_ADMIN_API_KEYS (CONSUMER_BEARER)
  — templates are excluded from this gate run. Set PARITY_API_KEYS to enable
  template parity coverage.
```

Both modes are valid; the warn is informational. Silent fallback would be the bug — operators must know which class of coverage the gate run produced.

## Why This Matters

**Widening a multi-tenant principal to serve one new surface is permission scope-creep with no audit trail.** R9 exists because templates aren't real consumer pages. Letting CONSUMER_BEARER read them once "for the harness" leaves the carve-out permanently widened for web/mobile/TV SSR even after the harness is decommissioned. Removing the widening later requires social coordination ("does anything still depend on this?"); minting a sibling means deletion is mechanical (drop the role, drop the env var, drop the permission key — one diff).

**The pattern is also defense-in-depth-preserving for non-target surfaces.** Even if a future bug accidentally hands the consumer Apollo client a `PARITY_API_KEYS` value, the disjointness invariant trips at module load. Widening would have offered no such safety net.

**The reviewer cost matters too.** PR-C's 11-persona code review surfaced four P1 issues, but each was about _enforcement_ (rate-limit bucket, disjointness check, untested critical paths, unbounded query) — not about the _shape_ of the carve-out. Security, correctness, and project-standards reviewers all endorsed the sibling-principal direction. If the design had widened CONSUMER_BEARER instead, the reviewer pass would have been a fundamentally different conversation — and a longer one (session history).

## When To Apply

Apply when **all four** are true:

1. An existing rule (R9-style ABAC, scope-auth gate, service-layer filter) intentionally hides resources from an existing bearer-minted principal.
2. A new surface needs to read exactly those hidden resources.
3. The new surface is narrower than the existing principal's consumer set (one verification harness vs every SSR identity).
4. The new permission is temporary (lives until cutover) OR materially distinct in purpose (verification, not consumption).

Do NOT apply when:

- The new permission is genuinely additive for all consumers of the existing principal — then widen the existing role with deliberate blast-radius analysis.
- The cost of the sibling (new env var, new CSV-disjointness invariant, new rate-limit namespace, new Doppler entry, new deploy ordering) outweighs the security delta. For one-off internal scripts with no public surface, a SYSTEM-tier session is often enough.
- You can use an existing narrow role (e.g., extending `WORKFLOW_TRIGGER_PERMISSIONS` with a single new key) and the audience is genuinely the same.

## Operational follow-through

When introducing the sibling:

- **Doppler provisioning is receiver-first.** Per [the cross-app trigger pattern](../platform/admin-manager-enrichment-trigger-endpoint-20260506.md), the principal that holds the keyring (admin) must deploy with the new CSV before the caller (harness operator workstation) ships a value. Reverse order produces a dead minute where the first call 401s.
- **Rotation is symmetric to the existing bearer rotation procedures.** Generate via `openssl rand -base64 32`. Stage new key into the receiver's CSV → deploy receiver → reconfigure caller → drop old key → redeploy receiver.
- **Threat-model delta from CONSUMER_BEARER.** A leaked `PARITY_API_KEYS` value grants template Experience read access (not just rate-limit budget abuse as with CONSUMER_BEARER's empty permission set). Rotation urgency is real, not operational.
- **Disjointness invariant must hold across the keyring lifetime.** Rotating one CSV must not collide with values in the others. The module-load assertion catches drift at boot, but a leak during the staging window between "new key added to CSV A" and "old key removed from CSV B" is a real window — minimize it by completing rotations within one deploy.

## Test surface

Three layers of coverage are necessary; missing any layer is the regression failure mode:

1. **Permission-matrix walk** (`apps/admin/src/auth/permissions.test.ts`) — enumerate every `PermissionKey` and assert `hasPermission(PARITY_BEARER, key)` returns `true` only for `read:experience-templates`.
2. **Service-layer `hasPermission` gate** (`apps/admin/src/services/experience.service.test.ts`) — PUBLIC and CONSUMER_BEARER throw `ForbiddenError`; PARITY/VIEWER/EDITOR/ADMIN pass through.
3. **Source-file disjointness check** (`apps/admin/src/auth/permissions.test.ts`) — assert each bearer module references only its own env var (the source-grep test) AND assert `assertBearerCsvsDisjoint` throws on synthetic overlaps with redacted error messages.

A real-DB integration test for the resolver-end-to-end path is ideal but optional — the three layers above provide sufficient defense for shipping. Add the integration test when a Pothos test harness lands as its own ce-work scope.

## Counter-example (don't do this)

Widening `CONSUMER_BEARER_PERMISSIONS` from `{}` to `{"read:experience-templates"}` would have been a five-character diff and a thirty-line learning doc about how every web SSR call now leaks templates. The empty-set invariant on CONSUMER_BEARER is explicitly load-bearing — see the JSDoc on `CONSUMER_BEARER_PERMISSIONS`.

A more subtle anti-pattern: extending the existing `experienceBySlug` resolver with an `includeTemplates: Boolean = false` arg. Trivially bypasses R9 — any CONSUMER_BEARER caller can flip the flag and see templates. Defense in depth collapses entirely.

## Related patterns

- [CONSUMER_BEARER identity-for-rate-limiting pattern](./consumer-bearer-rate-limit-identity-pattern-20260513.md) — the predecessor and direct parent. PARITY extends along three axes: N-way disjointness, narrow non-empty allowlist, distinct rate-limit namespace.
- [Pothos PUBLIC-widening multi-layer coordination](../graphql/pothos-public-widening-multi-layer-coordination-20260511.md) — `authScopes: { hasPermission }` + `unauthorizedResolver: () => null` mechanics; the regression-test pattern from `public-resolvers.regression.test.ts` is the model for verifying gated-resolver intent stays intact.
- [admin↔manager enrichment trigger endpoint](../platform/admin-manager-enrichment-trigger-endpoint-20260506.md) — receiver-deploys-first ordering rule transfers verbatim.
- [Required env var without default broke Railway deploy](../runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md) — `.optional()` requirement for the new env var.

## Key files

- `apps/admin/src/auth/principal.ts`
- `apps/admin/src/auth/parity-bearer.ts`
- `apps/admin/src/auth/permissions.ts`
- `apps/admin/src/config/env.ts`
- `apps/admin/src/graphql/context.ts`
- `apps/admin/src/graphql/plugins/rate-limit.ts`
- `apps/admin/src/graphql/types/experience.ts`
- `apps/admin/src/services/experience.service.ts`
- `packages/graphql/src/parity/batch-verification.ts`
- `packages/graphql/scripts/run-batch-verification.ts`

## Worked from

PR #935 (`feat/admin-consumer-migration-pr-c`), shipping 2026-05-13. Three commits across base implementation + multi-persona code-review fixes (4 P1, 6 of 8 P2, 5 of 7 P3 applied with documented pushback on the rest).
