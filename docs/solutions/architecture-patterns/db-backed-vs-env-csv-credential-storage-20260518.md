---
title: "DB-backed vs env-CSV credential storage — the decision matrix for bearer-key surfaces"
category: "architecture-patterns"
problem_type: "best_practice"
component: "authentication"
root_cause: "missing_workflow_step"
resolution_type: "workflow_improvement"
severity: "medium"
module: "apps/admin"
tags:
  - bearer-auth
  - credential-storage
  - architecture
  - audit
  - revocation
  - rotation
  - operational
  - partner-credentials
  - internal-credentials
date: "2026-05-18"
related_prs:
  - "JesusFilm/forge#976"
  - "JesusFilm/forge#966"
---

## Problem

When adding a new bearer-key surface to a service, the storage choice
matters more than the cryptographic primitive. Two viable options:

1. **Env-CSV** — a comma-separated list in Doppler / Railway / your
   secrets manager (e.g., `WORKFLOW_API_KEYS=key-a,key-b,key-c`),
   parsed at boot and matched in constant time against the presented
   bearer.
2. **DB-backed** — a Prisma / Postgres table (`PartnerApiKey`,
   `ApiKey`, etc.) storing `sha256(rawToken)` plus per-key metadata,
   queried per request.

The right choice depends on the **threat model + operator pattern**
of the caller class — not on the credential count, not on perceived
"sophistication" of the storage. Picking the wrong storage produces
either pointless complexity (DB for internal M2M) or unacceptable
operational gaps (env-CSV for external partners).

## The decision matrix

| Dimension                    | Env-CSV is right                                                                                                      | DB-backed is right                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Threat model**             | Doppler-access ≈ impersonation-ability already (caller is internal). A leak of the secret store is already game-over. | External partners; secrets must be safe-at-rest even from operators with full Doppler access. |
| **Audit requirement**        | "Did SOMEONE on team X call us?" (binary, by-CSV).                                                                    | "Which partner called this week, at what rate?" (per-key).                                    |
| **Revocation latency**       | Acceptable to wait one redeploy cycle (~3 min on Railway).                                                            | Sub-second revocation required (leaked-key incident response).                                |
| **Per-key metadata**         | None needed. Caller is the service, not a person.                                                                     | Owner contact, created_at, last_used_at, notes for offboarding.                               |
| **Caller population**        | Bounded, known set (apps/web, manager, eval CLI) — 1-10 entries.                                                      | Unbounded or growing partner population — 5-100+ entries.                                     |
| **Operator UX for issuance** | Edit Doppler CSV, redeploy.                                                                                           | CLI command + plaintext-once banner + Slack share.                                            |
| **Rotation cadence**         | Rare, planned.                                                                                                        | On-demand per partner; rolling.                                                               |
| **Plaintext exposure**       | Plaintext in Doppler is acceptable (same trust boundary as the running service).                                      | Plaintext NEVER persists — sha256 hash only; plaintext shown once at issuance.                |

If 4+ rows of "env-CSV is right" apply: **use env-CSV**. If 4+ rows
of "DB-backed is right" apply: **use DB-backed**. Mixed cases lean
toward env-CSV by default (less code, fewer failure modes) unless a
specific "DB-backed is right" row is load-bearing (audit, sub-second
revocation, plaintext-at-rest).

## Why this matters

The mistake to avoid is choosing storage by **credential count** or
**perceived modernity**. Both lead astray:

- **"We have 10+ keys, so we need a DB."** Wrong axis. 10 internal
  M2M keys live happily in env-CSV; the threat model didn't change.
- **"DB storage is more secure / professional."** Not for internal
  M2M where Doppler-access already implies impersonation-ability.
  DB storage adds: a hot-path Prisma round-trip per request, a
  fire-and-forget `lastUsedAt` write fan-out, a CLI surface, a
  dashboard view, schema migrations on every change — all to gain
  nothing the env-CSV didn't already provide for that caller class.
- **"Env-CSV is fine for partners — operators with Doppler access are
  trusted."** Wrong threat model. Partner credentials are EXTERNAL
  credentials. Industry baseline (Stripe, GitHub, Vercel) stores them
  hashed; ops staff with secret-store access should not be able to
  impersonate external customers.

## Worked instance: admin's `/api/search` surface (JFP Forge)

> **Status update 2026-07-23 (admin #1622).** The surface this instance was built
> on is gone — the `/api/search` route, `isAnyKnownBearer`, and `search-bearer.ts`
> were all deleted. The `PartnerApiKey` table, the `partner-keys` CLI, and the
> read-only dashboard still exist, but `verifyPartnerToken` now has **no caller in
> any request path**: the store is orphaned, not merely idle. Treat the
> storage-choice reasoning below as sound and still applicable; do not assume a
> partner token presented today is checked by anything. Whether to re-point the
> store at `watchSearch` or retire it is an open decision.

Admin's `/api/search` had ONE bearer-key surface (`SEARCH_API_KEYS`
env CSV, Plan 002, shipped 2026-05-17). Three months later, the
question was whether to:

1. Add more env-CSV slots for partners (`SEARCH_API_KEYS` already
   served that role), or
2. Move partner keys to DB-backed storage.

The four "DB-backed is right" rows that applied:

- **Threat model.** Partners are external; their credentials must
  survive Doppler-access leaks.
- **Audit requirement.** Operators needed `keyId=` per-request log
  threading to answer "which partner called this week?"
- **Revocation latency.** SC2 spec'd sub-30s revocation for leaked
  keys. Doppler edit + Railway redeploy is ~3 min.
- **Per-key metadata.** Owner email + lastUsedAt + soft-revoke
  audit trail.

The four "env-CSV is right" rows for the other bearer surfaces:

- `WORKFLOW_API_KEYS` (manager → admin workflow triggers): internal
  service-to-service. Threat model collapses (Doppler-access ≈
  impersonation-ability of the manager service).
- `WEB_ADMIN_API_KEYS` (apps/web SSR consumer-bearer): internal,
  bounded caller set.
- `BACKUP_DOWNLOAD_API_KEYS` (presigned video-DB backup downloader):
  internal, narrow surface, rare rotation.

**Decision** (Plan 003, PR #976):

- Partner credentials → DB-backed (`PartnerApiKey` table, Plan 003).
- Internal credentials → stay on env-CSV.
- The `isAnyKnownBearer` composer OR-composes them via a four-branch
  validator chain: DB-backed PARTNER (first) → env-CSV CONSUMER →
  env-CSV WORKFLOW. The legacy `SEARCH_API_KEYS` env-CSV partner
  branch was retired the same PR.

Result: no internal-bearer migration cost, no env-CSV operator
disruption, no DB hot-path overhead for the 3 internal callers. The
DB-backed surface is reserved for the caller class whose threat
model actually warrants it.

## What didn't work

### Migrating internal bearers to DB-backed for "consistency"

Considered briefly. Rejected: zero upside (internal callers don't
need audit / sub-second revocation / metadata), real downside
(every workflow trigger now eats a Prisma round-trip on the hot
path). The plan documented this explicitly:

> Internal bearers don't have these problems and shouldn't be
> migrated in v1 — different threat model, different operator
> pattern, the CSV is right for them.

### Keeping partners on env-CSV with prefixed keys (`sk_search_<id>_<random>`)

Considered as a cheaper alternative. Rejected: solves the audit
problem (keyId greppable in logs) but leaves plaintext-in-Doppler
and redeploy-latency revocation. Only marginally better than today;
doesn't satisfy SC2.

### Storing partner keys in DB but cached in-process

Considered for hot-path performance. Rejected for v1: cache adds
slot-leak surface (per
`docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md`),
multi-replica revocation skew, and a new TTL parameter. Prisma
unique-index lookup is 5-15ms on Railway internal network — fine
for the traffic profile. Revisit if `pg_stat_statements` shows the
lookup as a hot path.

### Single-key partner credentials via JWT or OAuth

Considered as a "more standard" option. Rejected: introduces
signing-key rotation pain for zero benefit at this scale. Partners
do server-to-server calls; OAuth/JWT shape is overkill.

## When to apply this matrix

- **Any new bearer-key surface** — before writing the storage code,
  walk the table and document which rows apply for the caller class.
- **Reviewing an existing env-CSV surface** that's about to gain a
  new caller class — if the new caller is external (partner, customer,
  third-party integration), the env-CSV doesn't fit even if the
  existing internal callers are fine on it.
- **Reviewing an existing DB-backed surface** that's slow on the hot
  path — confirm the audit / revocation / metadata requirements
  actually apply. If they don't, the DB is solving a problem you
  don't have.

## When NOT to apply this matrix

- **One-time API keys** (e.g., a webhook signing secret, a
  service-account token) — these are config, not credentials.
  Env-only, never CSV-or-DB.
- **Per-user session tokens** — different problem (session storage),
  different patterns (cookies, JWT, Redis session store). The matrix
  here is for SERVICE-TO-SERVICE bearer credentials.
- **Mobile / SPA OAuth tokens** — handled by an identity provider,
  not by the application's storage choice.

## Implementation patterns

### Env-CSV (the existing pattern, codified)

Reference: `apps/admin/src/auth/consumer-bearer.ts`,
`apps/admin/src/auth/workflow-bearer.ts`.

```ts
// One narrow validator per env-CSV. Length-mismatched candidates
// skipped (operator-chosen length isn't the secret). `timingSafeEqual`
// on equal-length Buffers. Iterates without short-circuiting so
// timing doesn't reveal which slot matched.
function parseAllowlist(envValue: string | undefined): string[] {
  if (!envValue) return []
  return envValue
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
}

export function isValidXBearer(authHeader: string | null): boolean {
  if (!authHeader || !BEARER_PREFIX.test(authHeader)) return false
  if (authHeader.length > MAX_BEARER_LENGTH) return false
  const presented = Buffer.from(authHeader.replace(BEARER_PREFIX, ""))
  if (presented.length === 0) return false

  let matched = false
  for (const key of parseAllowlist(env.X_API_KEYS)) {
    const keyBuf = Buffer.from(key)
    if (keyBuf.length !== presented.length) continue
    if (timingSafeEqual(presented, keyBuf)) matched = true
  }
  return matched
}
```

Boot-time `assertBearerCsvsDisjoint` invariant guarantees each
key VALUE lives in exactly one CSV.

### DB-backed (the Plan 003 pattern, codified)

Reference: `apps/admin/src/services/partner-api-key.service.ts`,
`apps/admin/src/auth/partner-token.ts`.

Token shape: `<prefix>_<surface>_<keyId>_<random>` (e.g.,
`jfp_search_ABC123abc456_<43-char-base64url>`). `keyId` is the
operator-visible identifier; `random` is 32 bytes of entropy
(base64url-encoded). Stored form is `sha256(rawToken)` hex (64
chars). `timingSafeEqual` on decoded 32-byte buffers.

Required disciplines:

- **Hot-path lookup wrapped in `Promise.race`** against a budget
  shorter than upstream caller's. See
  `outbound-timeout-shorter-than-caller-budget-20260506`.
- **`lastUsedAt` fire-and-forget** — never `await`, always `.catch()`.
  See `in-memory-slot-reservation-fire-and-forget-20260506`.
- **Soft-revoke via conditional `updateMany`** for concurrent-revoke
  safety. See
  `db-lock-must-be-atomic-update-not-select-for-update.md`.
- **Plaintext printed ONCE to stderr** at issuance; never persisted,
  never re-emitted, never landed in stdout JSON events.
- **Pre-verification log fields use a distinct namespace**
  (`attemptedKeyId=`, not `keyId=`). See
  `pre-verification-log-field-namespace-pollution-20260518`.
- **No in-process cache in v1** unless production profiling shows
  the lookup is a hot path. Cache adds revocation lag + slot-leak
  surface.

## Composer pattern for mixed surfaces

When a single endpoint accepts MULTIPLE caller classes (some env-CSV,
some DB-backed), OR-compose the validators. Run the DB-backed branch
FIRST so seeded rows take precedence over identical-plaintext env-CSV
matches:

```ts
export async function isAnyKnownBearer(
  authHeader: string | null,
): Promise<BearerCheckResult> {
  // PARTNER (DB-backed) first — the prefix parse is cheap and falls
  // through (no DB call) for tokens that aren't `<prefix>_*`-shaped.
  const partner = await safeCheckAsync("partner", () =>
    verifyPartnerToken(authHeader),
  )
  if (partner.valid) {
    return { valid: true, source: "partner", keyId: partner.keyId }
  }

  // Env-CSV fall-through (synchronous, no DB I/O).
  if (safeCheck("consumer", () => isValidConsumerBearer(authHeader).valid)) {
    return { valid: true, source: "consumer" }
  }
  if (safeCheck("workflow", () => isValidWorkflowBearer(authHeader))) {
    return { valid: true, source: "workflow" }
  }
  return { valid: false }
}
```

The composer's return type carries `source` (which branch matched)
and optional `keyId` (only populated for DB-backed branches that
surface per-key identity in logs).

## Related learnings

- `docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md`
  — the OR-composition pattern this generalizes. That doc documents
  three env-CSV branches; this doc extends it with the DB-backed
  fourth branch.
- `docs/solutions/architecture-patterns/consumer-bearer-rate-limit-identity-pattern-20260513.md`
  — sibling: env-CSV bearer that mints a rate-limit-only principal,
  no permissions.
- `docs/solutions/architecture-patterns/parity-bearer-narrow-carveout-pattern-20260513.md`
  — sibling: narrowest carveout for a single mutation, not a full
  surface.
- `docs/solutions/database-issues/db-lock-must-be-atomic-update-not-select-for-update.md`
  — the conditional-`updateMany` discipline that makes DB-backed
  revoke safe under concurrent operators.
- `docs/solutions/security-issues/pre-verification-log-field-namespace-pollution-20260518.md`
  — `attemptedKeyId=` vs `keyId=` discipline that DB-backed surfaces
  must follow.
- `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`
  — the `Promise.race` budget discipline for the hot-path Prisma
  lookup.
- `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`
  — env-CSV vars must be `.optional()` so dropping one (as Plan 003
  did for `SEARCH_API_KEYS`) doesn't brick Railway boot.
- Plan: `docs/plans/2026-05-18-001-feat-partner-api-key-store-plan.md`
- Brainstorm: `docs/brainstorms/2026-05-18-002-partner-api-key-store-requirements.md`
