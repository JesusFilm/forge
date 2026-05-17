---
title: "feat: Add bearer-key auth to /api/search + Query.search"
type: feat
status: active
date: 2026-05-17
origin: docs/brainstorms/2026-05-17-search-api-auth-requirements.md
---

# feat: Add bearer-key auth to /api/search + Query.search

## Overview

Move admin's `GET /api/search` and its GraphQL twin `Query.search` from
public-anyone to public-bearer-key via a **phased dual-accept**
rollout. Reuses the established receiver-CSV / caller-single-key
bearer pattern already used by `WORKFLOW_API_KEYS` /
`WEB_ADMIN_API_KEYS` / `BACKUP_DOWNLOAD_API_KEYS`. The bearer is a
_passport_ (proves you're a known caller), not a budget — per-IP rate
limiting at today's 30/min stays unchanged.

## Problem Frame

Admin's `/api/search` is currently public with only a 30/min per-IP
Redis rate limit. An external partner wants to integrate and there's
no key-issuance story today. Known consumers (apps/web SSR,
apps/mobile, the eval harness, plus any unknown direct callers) all
hit the endpoint unauthenticated. We need to issue keys to named
callers and gate the surface — without coordinating a same-day
cutover across web + mobile + eval harness + partners.

(See origin: `docs/brainstorms/2026-05-17-search-api-auth-requirements.md`
for the full product framing, the three blocking decisions resolved
during brainstorm, and explicit scope boundaries.)

## Requirements Trace

- **R1.** Authorization header bearer matches `SEARCH_API_KEYS` CSV
  on admin → request is `auth=bearer`. (Units 1, 2, 3, 4)
- **R2.** During dual-accept window, anonymous and bearer both
  succeed; structured log tags each request `auth=bearer|anonymous`.
  (Units 3, 4)
- **R3.** `SEARCH_AUTH_REQUIRED` boolean flag (default `false`) flips
  the surface to required-auth: missing/invalid bearer returns 401.
  (Units 1, 3, 4, 8)
- **R4.** GraphQL `Query.search` follows the same rule as REST;
  `authScopes: { public: true }` stays — the gate is request-level
  in the resolver body, not scope-auth. (Unit 4)
- **R5.** Per-IP rate limiting at today's 30/min stays unchanged for
  both authed and anonymous traffic. (Verified — no code change
  needed for this requirement.)
- **R6.** Each known consumer holds one `SEARCH_API_KEY` env var;
  admin's CSV is the union. Rotation = add-to-CSV / migrate-callers /
  drop-from-CSV. (Units 6, 7, 8)
- **R7.** Opaque random base64url tokens (~32 bytes → 43-char). One-
  liner issuance documented in plan + admin/CLAUDE.md. (Units 6, 9)
- **R8.** Cloudflare WAF in front of admin must pass the
  `Authorization` header through unchanged. Pre-merge curl probe is
  the verification gate. (Unit 5)

## Scope Boundaries

- **No JWT, no short-lived tokens, no per-device token exchange.**
  Opaque CSV-allowlisted bearers, matching the existing pattern.
- **No per-key rate-limit buckets.** Per-IP stays — the bearer is
  authorization only, not budget.
- **No admin UI / partner portal for key issuance.** Slack-DM +
  Doppler-paste handshake in v1. CLI / UI is a deferred follow-up.
- **No stable per-key audit identifier in v1.** Logs carry
  `auth=bearer|anonymous` only — not which key matched. Per-key audit
  is a deferred follow-up; the upgrade path (prefixed tokens) is
  documented inline so a future PR has a low-friction landing.
- **No changes to `/api/search/health`.** The synthetic probe stays
  public — it intentionally has no payload-bearing surface and the
  Railway / external-uptime monitors that poll it must not need keys.

## Context & Research

### Relevant Code and Patterns

- **Existing bearer validator (pattern source):**
  `apps/admin/src/auth/workflow-bearer.ts` —
  `isValidWorkflowBearer(authHeader: string | null): boolean`.
  Length-bucketed `timingSafeEqual` iteration without short-circuit;
  `Buffer.byteLength` precheck guards against UTF-8 `RangeError`.
  Mirror this file structure verbatim. Companion test file
  `apps/admin/src/auth/workflow-bearer.test.ts` covers all relevant
  edge cases (length variation, UTF-8 non-ASCII, empty allowlist).
- **Variant pattern (different shape — DO NOT mirror):**
  `apps/admin/src/auth/consumer-bearer.ts`. Returns
  `{ valid, bucketKey }` because consumer-bearer's purpose is to
  feed a rate-limit identityFn. Search-bearer has no bucketKey
  concern (R5) — workflow-bearer's boolean shape is the right
  inspiration.
- **REST surface to modify:**
  `apps/admin/src/app/api/search/route.ts`. Today's flow:
  rateLimitAuthRoute → validate query params → service.search →
  Response.json. Insert auth check at the top, before rate-limit.
- **GraphQL surface to modify:**
  `apps/admin/src/graphql/queries/hybrid-search.ts`. Today's
  resolver pulls `ctx.request.headers.get('origin')` already;
  reading `ctx.request.headers.get('authorization')` is the same
  shape. `authScopes: { public: true }` stays — the new check is
  request-level inside the resolver body.
- **Env + disjointness invariant:**
  `apps/admin/src/config/env.ts`. Already exposes
  `parseBearerCsvSet` (file-local helper) and
  `assertBearerCsvsDisjoint` (called at module load, throws if any
  two of {WORKFLOW, WEB_ADMIN, BACKUP_DOWNLOAD} share a value).
  Adding SEARCH_API_KEYS to the snapshot extends the invariant.
- **Rate-limit primitive (unchanged):**
  `apps/admin/src/auth/rate-limit.ts`. `getClientIp` reads
  `cf-connecting-ip` → `x-forwarded-for[0]`. Confirms R5 — rate-limit
  identity is purely IP, no bearer integration. No code change here.

### Institutional Learnings

- **Receiver-CSV / caller-single-key pattern (load-bearing):**
  `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`
  documents the asymmetric bearer pattern across both admin↔manager
  directions and the Railway deploy-ordering invariant (receiver
  keyring lands FIRST). Same shape applies here: admin is the
  receiver (CSV), each consumer is a caller (single key value).
- **Opt-in scaffolding env vars must be `.optional()`:**
  `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`.
  Both new vars (`SEARCH_API_KEYS`, `SEARCH_AUTH_REQUIRED`) are
  opt-in scaffolding during the rollout window — must be
  `.optional()` (CSV) and `.default(false)` (flag) so admin still
  boots in environments where they aren't yet provisioned.
- **Tier-2 review mandatory pre-push:**
  `docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md`.
  This work crosses the "auth surface" threshold — `/ce-code-review`
  before push, with the security/correctness personas at default
  Apply bias for findings.
- **Mocked-shape vs real-contract testing:**
  `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`.
  Validator tests must use the real `timingSafeEqual` /
  `Buffer.byteLength` shape (the workflow-bearer suite already does).
  Don't generic-Error your way around the typed branches.

### External References

External research was skipped — the local pattern is well-established
across three sibling validators (workflow / consumer / backup-download)
and the requirements doc already resolved the product/scope decisions.

## Key Technical Decisions

- **Shared inline validator at both seams, NOT a context-level
  principal.** Reasoning: (a) the gate is conditional on
  `SEARCH_AUTH_REQUIRED`, which doesn't fit scope-auth's static
  authScopes pattern; (b) the search bearer carries no permissions
  (no scope-auth interaction) and no rate-limit identity (no
  identifyFn interaction) — minting a principal would be ceremony
  with no payoff; (c) REST and GraphQL go through different entry
  paths (App Router route handler vs Yoga createContext), so a
  context-level mint would only cover GraphQL anyway.
- **Boolean return from `isValidSearchBearer`, mirroring
  `isValidWorkflowBearer`.** No bucketKey, no result envelope.
- **`SEARCH_API_KEYS` joins the disjointness invariant set.** Without
  this, an operator who pastes a search key into `WORKFLOW_API_KEYS`
  by mistake silently widens that key to workflow-trigger access.
  Add to `assertBearerCsvsDisjoint` snapshot, the `BearerCsvSnapshot`
  type, and the existing test that covers disjointness.
- **GraphQL on 401: throw `new Error("Authentication required")`,
  not a custom scope-auth error.** Surfaces as `errors[0].message`
  in the GraphQL response, parallel to how `Query.search` already
  throws for `q is required` etc. Status stays 200 — clients branch
  on `errors[]`. This matches the existing resolver's posture.
- **REST on 401: `Response.json({ error: "Authentication required" }, { status: 401 })`.**
  Parallel to today's 400/429/503 handlers.
- **Structured log tag is the observability primitive.** Every
  request emits one JSON line:
  `{ event: "search.request", auth: "bearer" | "anonymous", route: "search", path: "rest" | "graphql" }`.
  This is what we grep before the SEARCH_AUTH_REQUIRED flip to
  confirm every known caller is presenting a bearer.
- **Search passport accepts any admin-internal known bearer**
  (search ∪ consumer ∪ workflow). `isAnyKnownBearer(authHeader)`
  in `auth/search-bearer.ts` OR-composes the three validators.
  apps/web SSR (consumer-bearer for graphql rate-limit identity)
  and apps/mobile (consumer-bearer via apolloClient) keep working
  WITHOUT code changes; workflow-trigger callers (manager → admin
  proxies) also continue working. External partners get their own
  `SEARCH_API_KEYS` slot. The disjointness invariant still holds —
  each key VALUE lives in exactly one CSV; the composition is
  about validator OR, not about key reuse. `BACKUP_DOWNLOAD_API_KEYS`
  is excluded — it's a narrow file-download surface, not an
  active-API bearer.
- **Rate-limit fires BEFORE the auth check** in the REST handler.
  Every request — anonymous, valid bearer, invalid bearer alike —
  drains the per-IP bucket at RATE_LIMIT_MAX/min. An attacker
  spamming junk Authorization headers gets 429'd just like any
  other caller; the bucket cannot be bypassed by garbage auth.
  GraphQL rate-limiting happens at the Yoga endpoint layer (not
  per-resolver), so the ordering question is moot there — every
  `/api/graphql` request is already rate-bucketed before the
  resolver runs.
- **Issuance is a documented one-liner, not a script.** Matches how
  `WORKFLOW_API_KEYS` is generated today. Adding `pnpm
--filter @forge/admin issue:search-key` is carrying-cost without
  payoff for a 5-line operator workflow.

## Open Questions

### Resolved During Planning

- **Q4 — Partner key issuance mechanism:** Slack-DM + Doppler-paste
  handshake. The `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
  one-liner is documented in admin/CLAUDE.md and in this plan.
- **Q5 — Audit / keyId upgrade path:** Not implemented in v1. Plan
  adds an inline comment in `search-bearer.ts` flagging the
  prefixed-token format (`sk_search_<labeledKeyId>_<random>`) as
  the natural upgrade when per-key audit becomes load-bearing.
- **Q6 — Partner discovery surface:** Slack-DM handshake. The
  "Search API authentication" section in admin/CLAUDE.md describes
  the onboarding + rotation flow; no public doc page or portal in
  v1.
- **Q7 — GraphQL validation seam:** Shared inline helper called
  from both REST handler and GraphQL resolver (see Key Decisions
  above). No createContext-level principal.
- **Q8 — Cloudflare WAF passthrough:** Verified pre-merge via curl
  probe in Unit 5. If WAF strips, that becomes a blocking subtask
  before any of Units 6-8 ship.

### Deferred to Implementation

- **Exact apps/web search-fetch wrapper file path** — Implementer
  locates by grepping for `/api/search` in `apps/web/src/lib/`.
  The wrapper exists (cms→admin cutover happened "last week" per
  the kickoff); needs one header addition.
- **Exact apps/mobile search-fetch wrapper file path** — Same
  shape, in `apps/mobile/src/`.
- **Eval harness location of search bearer plumbing** —
  `apps/admin/src/services/search-eval/search-client.ts`. The
  client today calls `${ADMIN_BASE_URL}/api/search`; add an
  optional `SEARCH_API_KEY` env var read at the call site.
- **Whether the `permissions.test.ts` source-grep already covers
  `search-bearer.ts` after the file lands** — The test pattern
  described in `env.ts:303-309` source-greps each bearer module
  for "reads only its own env var". Implementer extends the
  asserted module list to include `search-bearer.ts`.

## High-Level Technical Design

> _This illustrates the intended approach and is directional
> guidance for review, not implementation specification. The
> implementing agent should treat it as context, not code to
> reproduce._

```
┌─────────────┐                    ┌──────────────────────────┐
│   apps/web  │                    │       admin (receiver)   │
│  SSR fetch  │ ──── Authorization ───>  /api/search route    │
│             │      Bearer <SEARCH_API_KEY>                  │
└─────────────┘                    │       │                  │
                                   │       ▼                  │
┌─────────────┐                    │  isValidSearchBearer(    │
│ apps/mobile │ ──── Authorization ───>    request.headers    │
│  app fetch  │      Bearer <key>  │      .get('auth...'))    │
└─────────────┘                    │       │                  │
                                   │       ├── log {auth:...} │
┌─────────────┐                    │       │                  │
│ eval harn.  │ ──── Authorization ───>    │                  │
│ search-cli  │      Bearer <key>  │       ▼                  │
└─────────────┘                    │  SEARCH_AUTH_REQUIRED ?  │
                                   │  └─ !valid → 401         │
┌─────────────┐                    │  └─ valid → rate-limit → │
│  partner X  │ ──── Authorization ───>     existing pipeline │
│  curl/fetch │      Bearer <key>  │                          │
└─────────────┘                    │                          │
                                   │                          │
┌─────────────┐                    │  Query.search resolver:  │
│  GraphQL    │ ──── Authorization ───>  same check, throws   │
│  callers    │      Bearer <key>  │  on auth-required fail   │
└─────────────┘                    └──────────────────────────┘

Env on forge-admin:                Env on each consumer:
  SEARCH_API_KEYS=k1,k2,k3           SEARCH_API_KEY=k<n>   (one of them)
  SEARCH_AUTH_REQUIRED=false         (no flag needed)
                                       │
  ▲ boot-time disjointness             │ Rotation: add new key to admin
  invariant ensures no key             │ CSV (deploy admin), update
  appears in two CSVs                  │ consumer env (deploy consumer),
                                       │ remove old key from admin CSV
                                       │ (deploy admin).
```

## Implementation Units

- [ ] **Unit 1: Env vars + disjointness invariant extension**

**Goal:** Land the two new env vars and extend the boot-time
disjointness check so a leaked / duplicated key fails fast.

**Requirements:** R1, R3, R7

**Dependencies:** None — first unit.

**Files:**

- Modify: `apps/admin/src/config/env.ts`
- Modify: `apps/admin/src/config/env.test.ts`

**Approach:**

- Add to `server:` schema: `SEARCH_API_KEYS: z.string().optional()`
  and `SEARCH_AUTH_REQUIRED: z.coerce.boolean().optional().default(false)`.
- Add both to `runtimeEnv` block using `emptyToUndefined(process.env.SEARCH_API_KEYS)` (CSV)
  and the raw `process.env.SEARCH_AUTH_REQUIRED` (the `z.coerce.boolean()` handles empty/undefined).
- Extend `BearerCsvSnapshot` type with `SEARCH_API_KEYS?: string`.
- Extend `assertBearerCsvsDisjoint` `sets` tuple to include
  `["SEARCH_API_KEYS", parseBearerCsvSet(snapshot.SEARCH_API_KEYS)]`.
- Update the module-load `assertBearerCsvsDisjoint(...)` call at the
  bottom of the file to include `SEARCH_API_KEYS: env.SEARCH_API_KEYS`
  in the snapshot.
- Document each new var with a block comment (see env.ts's
  `WEB_ADMIN_API_KEYS` comment as the template).

**Patterns to follow:**

- `WEB_ADMIN_API_KEYS` shape in env.ts (CSV, optional, comment
  block explains intent + why optional).
- `WORKFLOW_RUNNER_ENABLED` shape for the boolean flag
  (z.enum-style or z.coerce.boolean with default).

**Test scenarios:**

- Disjointness asserts pass when SEARCH_API_KEYS is empty / unset
  AND all other CSVs are unset.
- Disjointness asserts pass when SEARCH_API_KEYS has values AND
  no other CSV shares any value.
- Disjointness asserts THROW when SEARCH_API_KEYS shares a value
  with WORKFLOW_API_KEYS.
- Disjointness asserts THROW when SEARCH_API_KEYS shares a value
  with WEB_ADMIN_API_KEYS.
- Disjointness asserts THROW when SEARCH_API_KEYS shares a value
  with BACKUP_DOWNLOAD_API_KEYS.
- Error message identifies BOTH offending CSV names but DOES NOT
  include the offending key value (existing redaction discipline).

**Verification:**

- Admin boots cleanly with SEARCH_API_KEYS unset.
- Admin boots cleanly with SEARCH_API_KEYS=k1,k2,k3 and no other
  CSV shared.
- Admin boot fails fast with a clear error if SEARCH_API_KEYS
  shares a key value with any other bearer CSV.

---

- [ ] **Unit 2: `isValidSearchBearer` validator**

**Goal:** Constant-time bearer validator against `SEARCH_API_KEYS`,
mirroring the `workflow-bearer.ts` shape.

**Requirements:** R1

**Dependencies:** Unit 1.

**Files:**

- Create: `apps/admin/src/auth/search-bearer.ts`
- Create: `apps/admin/src/auth/search-bearer.test.ts`
- Modify (if grep test exists for "each bearer module reads only its
  own env var"): `apps/admin/src/auth/permissions.test.ts`

**Approach:**

- Mirror `workflow-bearer.ts` line-for-line, substituting
  `env.WORKFLOW_API_KEYS` → `env.SEARCH_API_KEYS` and renaming the
  function `isValidSearchBearer`.
- Preserve the length-mismatch `continue` (NOT `return`),
  `Buffer.byteLength` precheck, and full-allowlist iteration
  without short-circuit.
- Add an inline comment at the top of the file noting the audit /
  keyId upgrade path: "When per-key audit becomes load-bearing, key
  format upgrades to `sk_search_<labeledKeyId>_<random>` and this
  validator parses the prefix to surface the keyId. v1 is opaque
  and emits no keyId."
- Update permissions.test.ts source-grep set (if present) to
  include `search-bearer.ts` in the asserted module list.

**Execution note:** Test-first. Port the workflow-bearer.test.ts
suite to search-bearer.test.ts FIRST, watch them fail, then drop in
the validator. The test suite is the contract.

**Patterns to follow:**

- `apps/admin/src/auth/workflow-bearer.ts` (boolean shape, not
  the `{ valid, bucketKey }` envelope from consumer-bearer.ts).
- `apps/admin/src/auth/workflow-bearer.test.ts` for the test
  scenarios — port every test verbatim with the env var rename.

**Test scenarios:**

- Accepts a valid bearer matching any allowlisted key.
- Accepts case-insensitive `Bearer` / `bearer` / `BEARER` prefix.
- Rejects an unknown key.
- Rejects null / empty / whitespace-only / no-key headers.
- Rejects non-Bearer schemes (`Basic key`, bare `key`).
- Rejects when `SEARCH_API_KEYS` is unset / empty / whitespace-only CSV.
- Trims whitespace around allowlist entries.
- Rejects prefix / partial matches (length mismatch ≠ valid).
- **Length-mismatch regression guard:** matches a valid key when
  the allowlist contains entries of differing lengths. (A regression
  flipping `continue` → `return` would skip later entries.)
- **UTF-8 byte-length guard:** does NOT throw RangeError when
  allowlist contains a non-ASCII entry that's UTF-16-length-equal
  but UTF-8-byte-length-unequal to the presented value.

**Verification:**

- All test scenarios pass.
- Source-grep test (if present) asserts `search-bearer.ts` reads
  only `env.SEARCH_API_KEYS`, never other bearer CSVs.

---

- [ ] **Unit 3: Wire REST `/api/search` handler**

**Goal:** Insert the auth check + structured log + conditional 401
into the REST route handler, before rate-limit.

**Requirements:** R1, R2, R3

**Dependencies:** Unit 2.

**Files:**

- Modify: `apps/admin/src/app/api/search/route.ts`
- Modify: `apps/admin/src/app/api/search/route.test.ts`

**Approach:**

- At the top of `GET(request)`, before `rateLimitAuthRoute`:
  - `const authValid = isValidSearchBearer(request.headers.get("authorization"))`
  - Emit one structured log line:
    `console.log(JSON.stringify({ event: "search.request", auth: authValid ? "bearer" : "anonymous", path: "rest" }))`.
    (Use admin's existing logger if one is preferred — match what
    other route handlers do; otherwise raw `console.log` is fine
    and consistent with existing search-route logging.)
  - If `!authValid && env.SEARCH_AUTH_REQUIRED`:
    `return Response.json({ error: "Authentication required" }, { status: 401 })`.
- Existing rate-limit, validation, and service.search calls stay
  untouched (R5).
- NEVER log the bearer value, header value, or matched key.
- DO NOT widen the 401 response body — `{ error: "Authentication required" }`
  with no further detail (no "valid keys are…" leakage).

**Patterns to follow:**

- `apps/admin/src/app/api/search/route.ts` existing 400/429/503
  shape for the new 401 response.
- `apps/admin/src/auth/workflow-bearer.test.ts` for assertion
  patterns on bearer validators.

**Test scenarios:**

- **Dual-accept mode (SEARCH_AUTH_REQUIRED=false):**
  - Anonymous request → 200 OK, log line shows `auth=anonymous`.
  - Valid bearer header → 200 OK, log line shows `auth=bearer`.
  - Invalid bearer header → 200 OK, log line shows `auth=anonymous`
    (an invalid bearer is treated as no-bearer for tagging — same
    practical outcome as omitting the header).
  - Existing scenarios (400 missing-q, 429 rate-limit, 503 service-
    error) still hold.
- **Required-auth mode (SEARCH_AUTH_REQUIRED=true):**
  - Anonymous request → 401 `{ error: "Authentication required" }`.
  - Invalid bearer → 401.
  - Valid bearer → 200 OK; existing pipeline unchanged.
  - Rate-limit still fires after auth (a valid-bearer 31st request
    in a minute returns 429, NOT 401).
- **Log discipline:**
  - Log line does NOT contain the bearer value, header value, or
    matched key (assert via mock console.log capture + regex).

**Verification:**

- Vitest run is green; structured log lines visible in test
  output match the asserted shapes.
- No new lint / typecheck errors.

---

- [ ] **Unit 4: Wire GraphQL `Query.search` resolver**

**Goal:** Same auth check + structured log + conditional throw
inside the resolver body, while keeping `authScopes: { public: true }`.

**Requirements:** R1, R2, R3, R4

**Dependencies:** Unit 2.

**Files:**

- Modify: `apps/admin/src/graphql/queries/hybrid-search.ts`
- Modify or Create: colocated test file for the resolver.
  Implementer locates the existing resolver test file (likely under
  `apps/admin/src/graphql/queries/` or a sibling); if absent, create
  `apps/admin/src/graphql/queries/hybrid-search.test.ts`.

**Approach:**

- Inside `resolve: async (_root, args, ctx)`, before the
  `const query = args.q.trim()` line:
  - `const authValid = isValidSearchBearer(ctx.request.headers.get("authorization"))`
  - Emit structured log line:
    `console.log(JSON.stringify({ event: "search.request", auth: authValid ? "bearer" : "anonymous", path: "graphql" }))`
  - If `!authValid && env.SEARCH_AUTH_REQUIRED`:
    `throw new Error("Authentication required")` (surfaces as
    `errors[0].message` to the client; Yoga renders HTTP 200 with
    `data: null`).
- Keep `authScopes: { public: true }` — the new gate is request-
  level inside the resolver body, NOT a scope-auth assertion.
- DO NOT add a new scope-auth scope. DO NOT modify createContext.

**Patterns to follow:**

- The existing `Query.search` resolver's `throw new Error("q is required")`
  shape for the new auth-required throw.
- The existing `Query.search` resolver's `ctx.request.headers.get('origin')`
  read for the new `ctx.request.headers.get('authorization')` read.

**Test scenarios:**

- **Dual-accept (SEARCH_AUTH_REQUIRED=false):**
  - GraphQL query without `Authorization` header → resolves, log shows
    `auth=anonymous path=graphql`.
  - GraphQL query with valid `Authorization: Bearer <k>` → resolves,
    log shows `auth=bearer path=graphql`.
  - Invalid bearer → resolves (treated as anonymous), log shows
    `auth=anonymous`.
- **Required-auth (SEARCH_AUTH_REQUIRED=true):**
  - Anonymous → `errors[0].message === "Authentication required"`,
    `data: null`.
  - Invalid bearer → same.
  - Valid bearer → resolves normally.

**Verification:**

- Vitest run is green.
- Schema test `apps/admin/src/graphql/schema.test.ts` still passes
  (the schema surface didn't change — only resolver behavior).

---

- [ ] **Unit 5: Cloudflare WAF passthrough verification (pre-merge)**

**Goal:** Empirically prove that Cloudflare in front of admin does
NOT strip the `Authorization` header on `/api/search` and
`/api/graphql` requests, BEFORE merging Units 1-4.

**Requirements:** R8

**Dependencies:** Units 1-4 deployed to a preview / staging
environment (anywhere behind Cloudflare).

**Files:**

- Document procedure in: `docs/handoffs/2026-05-17-add-search-api-auth-handoff.md`
  (the kickoff doc — append a "WAF verification" section).
- (No production code change in this unit.)

**Approach:**

- Generate one disposable test bearer:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
- Add it to `SEARCH_API_KEYS` on staging admin (or a preview env)
  Doppler. Verify admin boots without the disjointness invariant firing.
- From a laptop / external host:
  ```
  curl -i -H "Authorization: Bearer <test-key>" \
    "https://<staging-admin-host>/api/search?q=test&locale=en"
  ```
- Tail admin logs; expect to see a structured log line with
  `auth=bearer path=rest`. If it shows `auth=anonymous`, Cloudflare
  stripped the header somewhere upstream → escalate to WAF rule
  review.
- Repeat with a GraphQL POST to confirm `path=graphql` shows
  `auth=bearer` when the header is presented.
- Negative probe: same request without the Authorization header →
  log should show `auth=anonymous`.

**Test scenarios (manual):**

- `curl -H "Authorization: Bearer <valid>"` → admin log
  `auth=bearer`.
- `curl -H "Authorization: Bearer <invalid>"` → admin log
  `auth=anonymous`.
- `curl` (no auth header) → admin log `auth=anonymous`.

**Verification:**

- All three probes produce the expected log line.
- If Cloudflare WAF strips, this unit BLOCKS Units 6-8 until a
  WAF rule is added to preserve `Authorization` on
  `admin.jesusfilm.org/api/*`. Escalate to the platform team.

---

- [ ] **Unit 6: Doppler / Railway provisioning (admin receiver)**

**Goal:** Set `SEARCH_API_KEYS` on the `forge-admin` Doppler project
(prod + staging), keep `SEARCH_AUTH_REQUIRED=false`, deploy.

**Requirements:** R6, R7

**Dependencies:** Units 1-5 merged.

**Files:**

- (No source code change in this unit.)

**Approach:**

- Generate the initial key set. Recommended: one key per known
  consumer + one spare ("introduction" / partner-onboarding slot):
  ```
  node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
  ```
  Run N times; record which key is assigned to which consumer in a
  password-manager secure note.
- Set on `forge-admin` Doppler (prod + staging):
  - `SEARCH_API_KEYS=k1,k2,k3,…` (CSV of all live keys).
  - Leave `SEARCH_AUTH_REQUIRED` unset (default `false`).
- Verify on Railway:
  - Admin redeploys cleanly (no disjointness-invariant boot crash).
  - `GET /api/search?q=test&locale=en` from an unauthed client →
    200 + log `auth=anonymous` (dual-accept active).
- **Deploy-ordering invariant:** this MUST happen before Unit 7
  (consumer key deployment). Receiver-first per the cross-app
  trigger pattern. Reverse order is harmless during dual-accept
  but the discipline carries us cleanly through rotation later.

**Patterns to follow:**

- `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`
  §"Railway deploy-ordering invariant" — the load-bearing rule.
- `docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md`
  — when using `mcp__railway__updateServiceTool`, flush with
  `mcp__railway__accept-deploy(envId)`, NOT `redeploy`.

**Verification:**

- Doppler config on `forge-admin` (prod + staging) shows
  `SEARCH_API_KEYS` populated, `SEARCH_AUTH_REQUIRED` unset.
- Railway deploy log for admin shows clean boot.
- Curl probe with a valid bearer → `auth=bearer` log on admin.

---

- [ ] **Unit 7: Consumer-side key plumbing (web / mobile / eval)**

**Goal:** Each known internal consumer holds a `SEARCH_API_KEY` env
var and sends `Authorization: Bearer <key>` on its search calls.

**Requirements:** R6

**Dependencies:** Unit 6 complete (admin's receiver-side CSV is
live and dual-accepting).

**Files:**

- Modify: `apps/web/src/lib/<search-fetch-wrapper>` (implementer
  locates by grepping for `/api/search` under `apps/web/src/lib/`).
- Modify: `apps/mobile/src/<search-fetch-wrapper>` (same grep
  under `apps/mobile/src/`).
- Modify: `apps/admin/src/services/search-eval/search-client.ts`.
- Modify: `apps/admin/src/config/env.ts` — add optional
  `SEARCH_API_KEY` (singular) for the eval harness path.
- Test files colocated with each consumer change.

**Approach:**

- For each consumer:
  - Add `SEARCH_API_KEY: z.string().optional()` to that app's env
    schema (if using `@t3-oss/env-nextjs`) or equivalent typed
    env. Wire into `runtimeEnv`. Mark `.optional()` so the app
    keeps booting in environments where the key isn't yet
    provisioned.
  - In the search-fetch wrapper: read the env var, attach
    `Authorization: Bearer <value>` ONLY when present. Don't
    throw if absent — silently fall through to the existing
    anonymous shape (preserves dual-accept fallback).
  - Tests: assert the header IS sent when env is set; assert
    NO header is sent when env is unset.
- Provision the env var on each consumer's Doppler / EAS:
  - `forge-web` Doppler: `SEARCH_API_KEY=<one of admin's CSV entries>`.
  - apps/mobile EAS (preview + production profiles + dev): same.
  - eval harness: `SEARCH_API_KEY=<value>` in operator's `.env`
    when running against staging / prod.
- Each consumer is its own follow-up PR. They are independent —
  land in parallel.

**Execution note:** Per-consumer PRs can use
`Execution target: external-delegate` if helpful (the per-consumer
diff is small + mechanical once the wrapper file is located).

**Patterns to follow:**

- The consumer-bearer wiring on apps/web SSR already attaches
  `Authorization: Bearer <WEB_ADMIN_API_KEY>` for graphql calls —
  search-fetch needs to do the analogous thing for REST /api/search.
- The single-key caller side of the cross-app trigger pattern
  (`MANAGER_TRIGGER_API_KEY`, `ADMIN_EMBED_TRIGGER_API_KEY`).

**Test scenarios (per consumer):**

- Env var set → request carries `Authorization: Bearer <key>`.
- Env var unset → no `Authorization` header attached.
- Existing search-call tests still pass (no response-shape change).

**Verification:**

- After each consumer's deploy, admin's structured logs show
  `auth=bearer` for that consumer's traffic.
- Operator can identify each consumer's switchover by greping
  admin logs for the `cf-connecting-ip` of the consumer's egress
  before and after deploy — the `auth` tag flips from
  `anonymous` to `bearer`.

---

- [ ] **Unit 8: Flip `SEARCH_AUTH_REQUIRED=true`**

**Goal:** After observation confirms every internal caller is
presenting a bearer, flip the gate to required-auth.

**Requirements:** R3

**Dependencies:** Unit 7 fully landed AND an observation window of
≥3 days where admin logs show zero `auth=anonymous` requests from
known-internal IP ranges.

**Files:**

- (No source code change in this unit.)

**Approach:**

- Verification gate before flipping:
  - Grep admin logs (Railway dashboard / log drains) for
    `auth=anonymous` over the past 24h.
  - For every remaining anonymous caller, identify by source IP +
    User-Agent. Confirm it's either (a) an external scraper /
    unknown caller (which the flip is DESIGNED to reject), or
    (b) a known-internal caller that missed the migration → DO
    NOT flip until they land.
- Set `SEARCH_AUTH_REQUIRED=true` on `forge-admin` Doppler (prod;
  optionally flip staging first for a smoke window).
- Deploy admin.
- Within 5 minutes of deploy: observe 401 rate. Spike on anonymous
  is expected; spike on known-internal IPs means a consumer slipped
  through — roll back the env var change (set back to `false`),
  identify the gap, complete migration, re-attempt.
- Update kickoff handoff doc + admin/CLAUDE.md "Search API
  authentication" section to reflect new state.

**Execution note:** This is a one-line operational change but the
verification gate is the load-bearing piece. DO NOT delegate Unit 8
— the operator who runs it must be authorized to roll back on
seeing unexpected 401 spikes.

**Test scenarios (operational verification):**

- Pre-flip: anonymous curl → 200; valid-bearer curl → 200.
- Post-flip: anonymous curl → 401 with
  `{ error: "Authentication required" }`; valid-bearer curl → 200.
- Post-flip: rate-limit still fires for valid-bearer callers at
  31st request in a minute → 429, NOT 401.

**Verification:**

- Anonymous traffic on `/api/search` post-flip = 0 known-internal
  IPs, > 0 external (the rejected callers).

---

- [ ] **Unit 9: Documentation**

**Goal:** Document the pattern in admin/CLAUDE.md and root
CLAUDE.md so future engineers don't reinvent it; document operator
procedures (issuance, rotation, revocation).

**Requirements:** Indirect — supports R6, R7, ongoing maintenance.

**Dependencies:** Units 1-4 merged (so the file paths and shapes
are stable to reference).

**Files:**

- Modify: `apps/admin/CLAUDE.md` — add a new "Search API
  authentication" section under "Known Patterns" or as a
  dedicated section after "Hybrid search (R4)".
- Modify: `CLAUDE.md` (repo root) — append a one-line bullet to
  "Known Patterns" pointing to admin's section and the
  forthcoming `docs/solutions/security-issues/...` writeup (the
  writeup itself is produced by `/ce:compound` post-launch, NOT
  in this unit).
- Modify: `docs/handoffs/2026-05-17-add-search-api-auth-handoff.md`
  — mark the handoff Status as "in progress" and link to this
  plan, the brainstorm doc, and the eventual ce:compound writeup.

**Approach:**

- The admin/CLAUDE.md section covers:
  - What surface is gated (REST + GraphQL) and what env vars
    drive it.
  - The dual-accept → required-auth phased model.
  - Issuance one-liner (`node -e ...`).
  - Rotation procedure (add to CSV → migrate caller → drop from
    CSV).
  - Revocation procedure (drop key from CSV → deploy admin →
    confirm log).
  - Disjointness invariant + boot-time failure mode (so an
    operator who pastes a duplicate key into two CSVs knows what
    the boot error means).
  - Audit / keyId upgrade path (prefixed-tokens, deferred).
  - Cross-references: workflow-bearer.ts, consumer-bearer.ts,
    rate-limit.ts (unchanged for search), the cross-app-trigger
    solution doc.
- Root CLAUDE.md bullet (one line):
  `Search API auth: /api/search + Query.search gated on SEARCH_API_KEYS CSV via search-bearer.ts. Same receiver-CSV/caller-single-key shape as workflow-bearer. See apps/admin/CLAUDE.md "Search API authentication" + docs/solutions/security-issues/search-api-bearer-key-pattern-2026-05-XX.md.`

**Patterns to follow:**

- The "Cross-app trigger pattern (bidirectional)" bullet in root
  CLAUDE.md as the shape template.
- The "Triggering manager enrichment from admin (feat-119 PR2)"
  section in apps/admin/CLAUDE.md as the in-depth template.

**Test scenarios:** N/A (docs only).

**Verification:**

- A reader who knows nothing about this PR can find the section
  via "Known Patterns" in either CLAUDE.md and execute the
  rotation procedure without further questions.

## System-Wide Impact

- **Interaction graph:** The auth check is request-level and
  inline at two seams (REST handler, GraphQL resolver). No
  middleware, no observer, no scope-auth registration. The only
  cross-cutting touch is the disjointness invariant in
  `assertBearerCsvsDisjoint`, which fires at module load and is
  shared across all bearer modules.
- **Error propagation:** REST returns HTTP 401 with a JSON
  envelope; GraphQL throws → `errors[0].message` with HTTP 200.
  Both shapes are familiar to existing clients (parallel to
  today's 400 / 429 / 503 on REST and existing resolver throws
  on GraphQL).
- **State lifecycle risks:** None new. The bearer is stateless —
  no session, no token store, no expiry calculation. Rotation
  state is in the Doppler CSV value.
- **API surface parity:** REST and GraphQL get identical
  behavior. They share the validator but each emits its own log
  tag (`path=rest` vs `path=graphql`) so we can monitor each
  surface independently.
- **Integration coverage:** Unit tests cover the validator + each
  resolver / handler. Real-world Cloudflare WAF passthrough is
  proved by Unit 5's manual curl probe — this is the only
  non-mock verification this work depends on.

## Risks & Dependencies

- **Cloudflare WAF strips the `Authorization` header on admin
  routes.** (Mitigation: Unit 5 is the pre-merge gate. If it
  fails, escalate to the platform team for a WAF rule update
  before any of Units 6-8 ship.)
- **Internal caller missed during migration → flips to 401 at
  Unit 8.** (Mitigation: Unit 8's verification gate — observation
  window + explicit log inspection before flipping. Roll back
  the env var on unexpected 401 spike from internal IPs.)
- **Mobile key extractable from bundle.** (Accepted per origin
  doc — bar is "stop casual abuse", per-IP rate-limit is the
  shed for determined extractors.)
- **Disjointness invariant fires at boot in an environment with
  leftover keys.** (Mitigation: Unit 1 + 6 verification.
  Operator runbook in Unit 9 documents the boot-error message
  shape and the fix — remove the duplicate from one of the CSVs.)
- **Sequencing dependency on the receiver-first rule.** (Mitigation:
  documented in Unit 6 + Unit 9 + the kickoff handoff doc; same
  rule as the existing cross-app trigger pattern.)

## Documentation / Operational Notes

- **Tier-2 review trigger:** This is an auth surface touching a
  public endpoint. Per
  `docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md`,
  run `/ce-code-review` before push. Default bias on
  security/correctness persona findings at P2+ confidence ≥75 is
  **Apply**, not defer — especially for new env vars, validator
  invariants, and the disjointness check extension.
- **Post-launch `/ce:compound`:** Produce a
  `docs/solutions/security-issues/search-api-bearer-key-pattern-2026-05-XX.md`
  capturing the dual-accept rollout pattern (vs same-day cutover),
  the bearer-as-passport-not-budget distinction, and the disjointness-
  invariant extension cost. Cross-reference from root CLAUDE.md's
  Known Patterns.
- **Rollout monitoring:** Add the `auth=bearer|anonymous`
  structured-log filter to admin's standard log queries during the
  dual-accept window. After flip, monitor 401 rate alongside the
  existing 429 rate.

## Phased Delivery

### Phase 1 — Admin-side dual-accept code (Units 1-5)

Lands as one PR (or two: scaffolding/units 1-2 + wiring/units 3-4,
with Unit 5 as a pre-merge verification gate documented in the PR
description). After merge, admin accepts both anonymous and
bearer-authed traffic; no consumer impact yet.

### Phase 2 — Admin Doppler config (Unit 6)

Doppler / Railway change only, no code. `SEARCH_API_KEYS` set on
prod + staging; `SEARCH_AUTH_REQUIRED` stays `false`. Done via
Railway MCP with the staged-patch-flush discipline.

### Phase 3 — External partner key provisioning (collapsed scope)

The original "consumer migration" units for apps/web + apps/mobile +
eval harness are NO LONGER NEEDED under the revised design. apps/web
and apps/mobile already carry the consumer-bearer (`WEB_ADMIN_API_KEYS`)
on every request to admin; that bearer now satisfies the search
passport via `isAnyKnownBearer`. The eval harness uses
`ADMIN_BASE_URL` but doesn't currently send any Authorization header
— so it presents as `auth=anonymous` until SEARCH_AUTH_REQUIRED
flips. For the eval harness only: add a SEARCH_API_KEY env var read
and inject the header into `apps/admin/src/services/search-eval/
search-client.ts` (small follow-up PR).

External partner onboarding: generate a fresh key via the one-liner,
add to `SEARCH_API_KEYS` on `forge-admin` Doppler, share the key
with the partner via Slack-DM.

### Phase 4 — Required-auth flip (Unit 8)

Operational change on `forge-admin` Doppler. Gated by ≥3-day
observation window where zero `auth=anonymous` requests come from
known-internal IP ranges.

### Phase 5 — Documentation (Unit 9)

Can land alongside Phase 1, OR as a follow-up to Phase 1 (the docs
reference live code paths, so post-Phase-1 is fine). Root CLAUDE.md
bullet should land before external partner onboarding starts.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-17-search-api-auth-requirements.md](../brainstorms/2026-05-17-search-api-auth-requirements.md)
- **Kickoff handoff:** [docs/handoffs/2026-05-17-add-search-api-auth-handoff.md](../handoffs/2026-05-17-add-search-api-auth-handoff.md)
- Pattern source: `apps/admin/src/auth/workflow-bearer.ts` + its test file.
- Variant pattern (different shape): `apps/admin/src/auth/consumer-bearer.ts`.
- Env + disjointness invariant: `apps/admin/src/config/env.ts:296-366`.
- REST surface to modify: `apps/admin/src/app/api/search/route.ts`.
- GraphQL surface to modify: `apps/admin/src/graphql/queries/hybrid-search.ts`.
- Rate-limit (unchanged): `apps/admin/src/auth/rate-limit.ts`.
- Cross-app bearer pattern + deploy-ordering invariant: `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`.
- Opt-in env var posture: `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`.
- Tier-2 review trigger: `docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md`.
- Railway MCP staged-patch discipline: `docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md`.
