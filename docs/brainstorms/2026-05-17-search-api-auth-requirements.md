---
date: 2026-05-17
topic: search-api-auth
---

# Search API Auth (`/api/search` + `Query.search`)

## Problem Frame

Admin's `GET /api/search` and its GraphQL twin `Query.search` are
currently public-anyone with only a 30/min per-IP Redis rate limit
(`apps/admin/src/app/api/search/route.ts`,
`apps/admin/src/graphql/queries/hybrid-search.ts`). An external
partner wants to integrate, and there's no story today for issuing
them a credential. Known consumers today (all unauthenticated):
apps/web (server-side render path post web→admin data-layer flip),
apps/mobile, and the eval harness via `ADMIN_BASE_URL`.

We need to move the surface from public-anyone to public-bearer-key
so that:

- A 401 lands on any caller who isn't on the keyring (after the
  required-auth flip).
- Each known consumer — internal apps and external partners —
  holds one bearer value as their own env var.
- Issuance + rotation reuse the existing
  caller-single-key / receiver-CSV-keyring pattern already used by
  `WORKFLOW_API_KEYS` (admin) and `ADMIN_TRIGGER_API_KEYS` (manager).

## Requirements

- **R1.** `/api/search` and `Query.search` accept
  `Authorization: Bearer <key>` where `<key>` matches a value in
  ANY of the three known-caller bearer CSVs: new admin env var
  `SEARCH_API_KEYS`, existing `WEB_ADMIN_API_KEYS` (consumer-bearer
  for apps/web SSR), or existing `WORKFLOW_API_KEYS` (workflow-
  trigger). Composing across the three is the **search passport**:
  any admin-internal known caller already proves the identity claim
  search needs, so requiring a separate dedicated key for them is
  incoherent. External partners get their own `SEARCH_API_KEYS`
  slot. The disjointness invariant still holds — each key VALUE
  lives in exactly one CSV.
- **R2.** During the **dual-accept** rollout window, requests
  without a bearer continue to succeed (today's public behavior) and
  requests with a valid bearer also succeed. The endpoint is
  observable enough that we can tell which path each caller took
  (structured log line tagging `auth=bearer|anonymous`).
- **R3.** A boolean operator gate (`SEARCH_AUTH_REQUIRED`, default
  `false`) flips the surface to **required-auth**: missing or
  invalid bearer returns 401. Anonymous traffic is rejected.
- **R4.** The GraphQL `Query.search` resolver follows the same
  rules as the REST endpoint. It does not become ADMIN-only — it
  stays publicly callable; the gate is "do you carry a valid
  `SEARCH_API_KEYS` bearer".
- **R5.** Rate limiting **stays per-IP for both authed and
  anonymous traffic** at today's 30/min limit. The bearer key is a
  passport (identity / authorization), not a rate-limit identity.
  Rationale: apps/web is server-side-rendered (one egress IP,
  many end users) so a per-key bucket would throttle the legitimate
  fan-out; apps/mobile ships the key in its bundle (many user IPs,
  same key) so per-IP is the natural per-user shed.
  **Crucially: rate-limit fires BEFORE the auth check.** Every
  request — anonymous, valid-bearer, invalid-bearer — drains the
  per-IP bucket. An attacker spamming junk Authorization headers
  gets 429'd after 30/min just like any other caller; the bucket
  cannot be bypassed by garbage auth.
- **R6.** Each EXTERNAL partner holds **one** bearer value in
  `SEARCH_API_KEYS`. Internal consumers (apps/web, apps/mobile,
  workflow callers) keep using the bearers they already carry
  (`WEB_ADMIN_API_KEYS`, `WORKFLOW_API_KEYS`) — no code changes,
  no new env vars on those apps. Admin's `SEARCH_API_KEYS` CSV is
  the union of external-partner keys. Rotation for any of the
  three CSVs follows the same pattern: add new key, migrate
  caller, drop old key.
- **R7.** Key format is **opaque random base64url tokens** (~32
  bytes of entropy → 43-char strings) matching the `WORKFLOW_API_KEYS`
  shape. Issuance is a one-liner the operator runs:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
- **R8.** Cloudflare's WAF in front of admin does not strip
  `Authorization`. A pre-merge curl probe against staging admin
  with a known bearer header confirms passthrough; if it does
  strip, planning gets the WAF-rule task as a blocker.

## Success Criteria

- **SC1.** During dual-accept: zero behavioral regressions for
  existing anonymous callers (web SSR, mobile, eval harness, any
  unknown direct callers). Structured `auth=bearer|anonymous` log
  lines show every internal caller has migrated to a key before
  we flip `SEARCH_AUTH_REQUIRED=true`.
- **SC2.** After required-auth flip: external curl without a
  bearer returns 401; internal callers with their issued keys
  continue to return 200; per-IP 30/min rate-limit shedding still
  works (anonymous abuser without key still bucketed by IP — but
  bucketed at the 401 layer rather than the 200 layer).
- **SC3.** Key rotation is a one-commit op on both halves:
  receiver (admin) appends the new key to `SEARCH_API_KEYS` and
  deploys first; caller (e.g. web) updates `SEARCH_API_KEY` and
  redeploys; admin removes the old key from the CSV.

## Scope Boundaries

- **No JWT, no short-lived tokens, no per-device token-exchange
  endpoint.** The mobile key being extractable from the bundle is
  an accepted threat — bar is "stop casual abuse, defend with the
  per-IP rate limit", matching the posture Strapi's API tokens
  hold today.
- **No per-key rate-limit buckets.** Resisted complexity; per-IP
  is sufficient. If a single noisy partner ever appears, that's a
  follow-up with concrete data behind it.
- **No partner-facing UI for key issuance.** Issuance is a
  Slack-DM + Doppler-paste handshake in v1. Admin CLI / admin UI
  for issuance is a deferred follow-up question (#4 in the
  kickoff).
- **No audit-log instrumentation that ties requests to a stable
  keyId.** We log `auth=bearer|anonymous`; the bearer-validation
  is a constant-time match against the CSV with no identifying
  side-channel. Per-key audit + revocation-by-keyId is a deferred
  follow-up (#5 in the kickoff). When we add it, prefixed tokens
  (e.g. `sk_search_<labeledKeyId>_<random>`) are the natural
  upgrade path.

## Key Decisions

- **Phased dual-accept → required-auth.** Ship code that accepts
  both, get internal callers onto keys, then flip the gate. Avoids
  a synchronized coordination cliff across web + mobile + eval
  harness + any other internal caller we discover during rollout.
- **Opaque random tokens, matching `WORKFLOW_API_KEYS`.** Same
  shape, same `workflow-bearer.ts`-style timing-safe validator,
  same operator muscle memory.
- **Per-IP rate limiting unchanged.** The bearer is authorization,
  not budget. This eliminates a large chunk of planning surface
  (no Redis bucket rekey, no consumer-aware identity in the
  limiter).
- **GraphQL `Query.search` stays `public: true`** under the
  scope-auth plugin. The new check is a request-level bearer
  validation that lives in the resolver body (or shared with the
  REST handler via a small helper). It does NOT become a
  scope-auth `hasPermission` gate — `Query.search` does not need
  a tier-ladder role, just a CSV-membership check.

## Dependencies / Assumptions

- The validator implementation reuses the
  `apps/admin/src/auth/workflow-bearer.ts` shape verbatim:
  parseAllowlist + length-bucketed `timingSafeEqual` iteration +
  Buffer.byteLength length comparison + reject on empty CSV.
- `apps/admin/src/config/env.ts` gains
  `SEARCH_API_KEYS: z.string().optional()` and
  `SEARCH_AUTH_REQUIRED: z.coerce.boolean().default(false)`.
  Both `.optional()` / defaulted so admin still boots in
  environments where the keyring isn't provisioned yet (per the
  "opt-in scaffolding env vars must be `.optional()`" pattern in
  root `CLAUDE.md`).
- Cloudflare WAF in front of admin does not strip the
  `Authorization` header on requests bound for `/api/search` or
  `/api/graphql`. The pre-merge curl probe in R8 is the
  verification gate.

## Outstanding Questions

### Resolve Before Planning

_(none — Q1-3 are resolved; the rest are explicitly deferred per
the kickoff's "Suggested kickoff" section)._

### Deferred to Planning

- [Affects R6][Process] **How does a partner actually get a key
  today?** Slack-DM the value? Generate via a one-liner committed
  to admin's repo? Generate via an admin CLI script? Same question
  for internal-caller issuance. Planning picks the v1 mechanism.
  (Kickoff Q4.)
- [Affects post-launch][Needs research] **Audit + abuse handling
  without a stable keyId.** When the next iteration adds per-key
  audit, we'll need the prefixed-token format and a small parser
  to extract the keyId. Planning notes the upgrade path but
  doesn't implement it. (Kickoff Q5.)
- [Affects R6][Product/Process] **Partner discovery surface.** Doc
  page on `admin.jesusfilm.org`? Partner portal? Slack-DM
  handshake? Planning picks the minimum viable answer for v1.
  (Kickoff Q6.)
- [Affects R4][Technical] **GraphQL bearer-validation seam.**
  Inside the resolver vs. inside `createContext` (where
  `WORKFLOW_TRIGGER` already mints from a bearer match)? Planning
  picks the cleaner shape. (Kickoff Q7-aligned.)
- [Affects R8][Needs verification] **Cloudflare WAF passthrough
  for `Authorization` header on `/api/search`.** Curl probe
  against staging admin to verify. If WAF strips, planning gets a
  WAF-rule subtask. (Kickoff Q8.)

## Next Steps

→ `/ce:plan` for structured implementation planning. All blocking
product decisions are resolved; the remaining open questions are
planning-time choices that benefit from the codebase-grounded
research planning does.
