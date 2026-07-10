---
title: Bearer-as-passport multi-CSV composition pattern
date: 2026-05-18
last_updated: "2026-06-12"
problem_type: best_practice
category: architecture-patterns
component: authentication
root_cause: missing_workflow_step
resolution_type: code_fix
severity: medium
tags:
  - auth
  - bearer
  - validator-composition
  - rate-limit
  - admin
  - public-api
  - phased-rollout
related:
  - docs/solutions/architecture-patterns/consumer-bearer-rate-limit-identity-pattern-20260513.md
  - docs/solutions/architecture-patterns/parity-bearer-narrow-carveout-pattern-20260513.md
  - docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md
---

# Bearer-as-passport multi-CSV composition pattern

## Problem

When adding bearer-key authentication to a public API surface (e.g.,
admin's `/api/search` + `Query.search`), the naïve design is "issue a
new dedicated bearer to every internal caller + every external
partner". For a repo where internal apps already carry bearers for
_other_ reasons (rate-limit identity, workflow-trigger access), this
creates a coordination nightmare: apps/web, apps/mobile, the manager
proxy, the eval harness, and every external partner would each need
a new env var, a new deployment, and operator-driven key issuance —
all synchronized BEFORE the auth gate could flip required.

The deeper question is: **what does the bearer mean?**

## Symptoms

- A "small" auth addition expands to multi-app, multi-PR
  coordination across teams.
- The auth gate becomes hard to flip because too many callers must
  migrate in lockstep.
- Internal apps already carry bearers (for rate-limit identity, for
  workflow triggers) but those don't satisfy the new gate, so they'd
  need to carry a SECOND bearer just for this surface.
- HTTP doesn't allow two `Authorization` headers on one request, so
  callers face the choice of which bearer to send and lose the other
  surface's benefit.

## What didn't work

- **Single-CSV check.** Initial design: search-bearer validator reads
  only its own `SEARCH_API_KEYS` CSV. Forced apps/web SSR to either
  (a) migrate off Apollo's consumer-bearer to a separate fetch
  wrapper for search, (b) carry a side-channel `X-Search-Authorization`
  header, or (c) get 401'd after the required-auth flip. None of
  these options were free.
- **Sharing key values across CSVs.** Could "paste the WEB_ADMIN
  bearer into SEARCH_API_KEYS too" so it matches both. Breaks the
  boot-time disjointness invariant that prevents accidental
  privilege widening during rotation.

## Solution

**Distinguish the bearer's _role_ from the bearer's _identity_.**

A bearer can play one of two roles:

1. **Budget** — answers "how much can you call?". Per-key
   rate-limit bucket, partner-specific quotas, etc.
2. **Passport** — answers "are you allowed to call this at all?".
   Pass/fail. No budget, no permissions beyond access.

When the bearer is a _passport_, ANY validated known-caller bearer
satisfies it. The composition is OR across all known-caller CSVs,
not AND or single-source.

### Composition shape

```ts
// apps/admin/src/auth/search-bearer.ts

export function isValidSearchBearer(authHeader: string | null): boolean {
  // Narrow: reads only SEARCH_API_KEYS. Constant-time compare,
  // Buffer.byteLength precheck for UTF-8 safety, no short-circuit.
  // ... (mirrors workflow-bearer.ts shape)
}

/**
 * Returns true if `Authorization: Bearer <key>` matches ANY of the
 * known-caller bearer allowlists. The search-passport check answers
 * "are you a known caller?", not "do you have permission to call
 * search?". Anyone holding a workflow-trigger key or a consumer-
 * bearer key already proves they're a known caller — requiring them
 * to ALSO present a SEARCH_API_KEY would be incoherent.
 */
export function isAnyKnownBearer(authHeader: string | null): boolean {
  return (
    safeCheck("search", () => isValidSearchBearer(authHeader)) ||
    safeCheck("consumer", () => isValidConsumerBearer(authHeader).valid) ||
    safeCheck("workflow", () => isValidWorkflowBearer(authHeader))
  )
}
```

The boot-time disjointness invariant guarantees no key VALUE appears
in multiple CSVs:

```ts
// apps/admin/src/config/env.ts

const BEARER_CSV_KEYS = [
  "WORKFLOW_API_KEYS",
  "WEB_ADMIN_API_KEYS",
  "BACKUP_DOWNLOAD_API_KEYS",
  "SEARCH_API_KEYS",
] as const

// The `satisfies` clause makes the compiler enforce that
// BEARER_CSV_KEYS and BearerCsvSnapshot stay aligned.
const _check: ReadonlyArray<keyof BearerCsvSnapshot> =
  BEARER_CSV_KEYS satisfies ReadonlyArray<keyof BearerCsvSnapshot>

export function assertBearerCsvsDisjoint(snapshot: BearerCsvSnapshot): void {
  // Collects ALL overlapping pairs into one fail-fast error.
  // Boot-time invariant — fires on every import of `env`.
}
```

Two invariants coexist:

- **Disjointness at the key-value level.** Each opaque key value
  lives in exactly one CSV. An operator pasting the same value into
  two CSVs hits a fail-fast boot error.
- **Union at the validator level.** The OR composition accepts any
  validated key VALUE regardless of which CSV it lives in.

### Rate-limit-before-auth

The bearer is NOT a budget, so rate-limit is identity-agnostic — per
IP, applied to every request before the auth check. Junk bearers
spamming the endpoint get 429'd just like any other caller:

```ts
// apps/admin/src/app/api/search/route.ts
// Rate-limit FIRST (every request drains the per-IP bucket),
// auth check SECOND.

const limit = await rateLimitAuthRoute(...)
if (!limit.allowed) return tooManyRequests()

const authValid = isAnyKnownBearer(request.headers.get("authorization"))
if (!authValid && env.SEARCH_AUTH_REQUIRED === "true") {
  return authenticationRequired(...)
}
```

## Why this works

- **Internal apps ALREADY SENDING a bearer need NO code change.**
  apps/web SSR was already sending
  `Authorization: Bearer <WEB_ADMIN_API_KEYS first entry>`
  (the consumer-bearer for graphql rate-limit identity). When admin
  added the search-passport check via `isAnyKnownBearer`, web's
  existing bearer began satisfying both the rate-limit identity AND
  the search passport — no migration, no new env var, no
  coordinated deploy. **This zero-migration property does NOT extend
  to fleet clients that were fully anonymous** (apps/mobile,
  apps/tv): they need bearer plumbing added explicitly, scoped to
  the gated Search operation only — never globally, or the whole
  fleet collapses into one `consumer:<key>` rate-limit bucket. The
  mobile Discover outage of 2026-06-12 was exactly this gap: Unit 7
  consumer plumbing never landed for mobile, so the auth flip broke
  it. See
  [`fleet-client-bearer-must-be-operation-scoped-not-global.md`](./fleet-client-bearer-must-be-operation-scoped-not-global.md).
- **External partners get a dedicated slot.** `SEARCH_API_KEYS` is
  reserved for callers who don't already hold an internal bearer.
  Slack-DM + Doppler-paste is sufficient onboarding.
- **The phased rollout collapses.** With single-CSV design, Phase 3
  was "migrate every internal app's fetch wrapper to carry the new
  bearer". With multi-CSV composition, Phase 3 disappears for
  internal apps and shrinks to "provision keys for external
  partners".
- **The threat model holds.** Anyone with workflow-trigger access
  can already fire admin's most privileged mutations — granting
  them search read access is a strict permission narrowing. Anyone
  with consumer-bearer access is, by definition, a known internal
  caller. Neither population needs additional vetting for search.

## Prevention / How to apply

**When to reach for this pattern:**

The OR-composition is the right design when ALL of:

1. The new auth gate's purpose is "known caller" (passport),
   not "specific quota" (budget) or "specific permission" (capability).
2. Internal callers already carry bearers for other reasons in the
   same monorepo.
3. The endpoint is low-sensitivity enough that "any known internal
   caller" is the appropriate trust level. Public read-only data,
   for example. NOT applicable for write surfaces or PII reads.

**When NOT to use it:**

- The bearer needs to encode permissions (then it's a capability,
  not a passport — use scope-auth or principal mint instead).
- The bearer needs per-key rate-limit identity (then it's a budget;
  the validator must surface the matched key as a bucket identifier,
  like `consumer-bearer.ts` does).
- Different bearers must grant different access (then OR-composition
  is wrong; each gate needs its own narrow check).

**Implementation checklist:**

1. **Each per-CSV validator stays narrow.** Reads only its own env
   var, returns boolean. Constant-time compare, `Buffer.byteLength`
   precheck, full-allowlist iteration without short-circuit.
2. **`parseAllowlist` is duplicated by design** across the per-CSV
   validators. A source-grep test (see
   `apps/admin/src/auth/permissions.test.ts`) asserts each module
   reads only its own env var — DRYing this defeats the isolation
   guarantee.
3. **Boot-time disjointness invariant** at module load in env.ts.
   Use `const BEARER_CSV_KEYS = [...] as const satisfies ReadonlyArray<keyof BearerCsvSnapshot>`
   so adding a 5th CSV requires touching both the type and the
   constant.
4. **Collect-all-overlaps error message.** A chaotic Doppler
   rotation can produce multiple overlapping pairs simultaneously;
   the boot error must surface every pair so the cleanup is one
   redeploy, not N.
5. **Defensive try/catch around each composed validator.** None of
   the validators throw today (length-prechecks guard against
   `timingSafeEqual` RangeError), but a future logging side-effect
   throw could otherwise convert a single buggy validator into a
   500 on every request. Cheap defense for the highest-volume
   endpoint.
6. **Rate-limit fires BEFORE auth.** Junk bearer spam still drains
   the per-IP bucket; the per-IP rate-limit is the volumetric
   defense.
7. **Three-state structured log** (`bearer | invalid_bearer |
anonymous`) so operators can identify un-migrated callers
   BEFORE flipping required-auth.
8. **Excluded CSVs deserve an active rejection test.** Doc'd
   exclusions (e.g., `BACKUP_DOWNLOAD_API_KEYS`) need a test that
   populates the excluded CSV with a distinct value and asserts
   the value does NOT satisfy the composer.

## Cross-references

- **Fleet-client corollary:**
  `docs/solutions/architecture-patterns/fleet-client-bearer-must-be-operation-scoped-not-global.md`
  — what the passport rollout looks like from a device-fleet
  consumer (mobile/TV): explicit operation-scoped plumbing, never a
  global header.
- **Sibling pattern (rate-limit identity):**
  `docs/solutions/architecture-patterns/consumer-bearer-rate-limit-identity-pattern-20260513.md`
  — explains why consumer-bearer mints a principal AND surfaces a
  bucketKey. Different role (budget identity), same module style.
- **Sibling pattern (narrow carveout):**
  `docs/solutions/architecture-patterns/parity-bearer-narrow-carveout-pattern-20260513.md`
  — the canonical multi-principal precedent for narrow permission
  allowlists + runtime disjointness invariant.
- **Cross-app trigger pattern (asymmetric receiver-CSV /
  caller-single-key):**
  `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`
  — the receiver-first deploy ordering rule that any bearer rotation
  must follow.
- **Source files:**
  - `apps/admin/src/auth/search-bearer.ts` (`isAnyKnownBearer`)
  - `apps/admin/src/config/env.ts` (`assertBearerCsvsDisjoint` +
    `BEARER_CSV_KEYS`)
  - `apps/admin/src/app/api/search/route.ts` (rate-limit-before-auth
    - WWW-Authenticate header)
  - `apps/admin/src/graphql/queries/hybrid-search.ts` (GraphQL
    resolver-body check with typed GraphQLError on 401)
- **Brainstorm + plan:**
  - `docs/brainstorms/2026-05-17-search-api-auth-requirements.md`
  - `docs/plans/2026-05-17-002-feat-search-api-auth-plan.md`
- **PRs:** #968 (Phase 1 admin code), #970 (observability fix).
