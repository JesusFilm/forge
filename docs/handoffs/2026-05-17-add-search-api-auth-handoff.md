# Add auth to `/api/search` — kickoff

**Date:** 2026-05-17 · **Author:** Nisal · **Status:** kickoff, scope TBD

## Problem

Admin's `GET /api/search` is currently **public** with no auth, just a
30/min per-IP rate limit (Redis-backed). An external partner wants to
integrate — we need to issue them an API key. Same for any future
external consumer. Today there's no key-issuance story.

## Current state (verified 2026-05-17)

- `apps/admin/src/app/api/search/route.ts` — no auth check, just
  `rateLimitAuthRoute({ route: "search", limit: 30 })`.
- GraphQL twin `apps/admin/src/graphql/queries/hybrid-search.ts` —
  `authScopes: { public: true }`.
- **Known consumers today (all unauthenticated):** apps/web (post-
  consumer-migration last week), apps/mobile, plus the eval harness
  via `ADMIN_BASE_URL`.

## Goal

Move `/api/search` from public-anyone to public-bearer-key. Keys
issued to known consumers (internal apps + external partners), stored
on the caller side, validated on admin's side from a Railway secret.

## Reference patterns in the codebase (don't reinvent)

There is already an established **caller single key + receiver CSV
keyring** pattern for cross-app trigger endpoints. Reuse the shape:

- `apps/admin/src/auth/workflow-bearer.ts` — admin's receiver-side
  keyring validator (`WORKFLOW_API_KEYS` CSV).
- `apps/manager/src/auth/admin-trigger-bearer.ts` (or similar) — the
  mirror pattern on manager (`ADMIN_TRIGGER_API_KEYS` CSV).
- `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`
  — primary learning. Documents the receiver-CSV / caller-single-key
  asymmetry + the deploy-ordering invariant (receiver keyring landing
  BEFORE caller env var, else dead minute of 401s).
- `apps/admin/CLAUDE.md` "Cross-app trigger pattern (bidirectional)"
  bullet under Known Patterns — short summary of the same rule.

The same shape applied to `/api/search`:

- New env var on admin: `SEARCH_API_KEYS` (CSV of valid bearer
  tokens, parsed by `parseBearerCsvSet` already in
  `apps/admin/src/config/env.ts`).
- Each consumer holds one key value as their own env var
  (e.g. `partner-X` holds `SEARCH_API_KEY=…`).
- Rotation: add new key to CSV, partners migrate, drop old key from CSV.

## Open questions (resolve in /ce:brainstorm before planning)

1. **Breaking change or additive?** apps/web + apps/mobile + the eval
   harness currently call this endpoint without auth. Three paths:
   - (a) Require auth from day 1 — also need keys for web + mobile +
     harness + every other internal caller. Bigger lift.
   - (b) Phase: support BOTH unauth + auth concurrently, get internal
     callers onto keys, then flip to required. Safer.
   - (c) Make auth opt-in forever; external partners get keys for
     higher rate limits (see #3) but anonymous traffic still works.
2. **Key format.** Random opaque tokens (`crypto.randomBytes(32).toString("base64url")`)
   vs. UUIDs vs. JWT-style with claims? The cross-app trigger pattern
   uses opaque random — simplest, matches existing.
3. **Rate-limit interaction.** Today's bucket is per-IP. Should
   authenticated keys get their own bucket (higher limit, per-key)
   so partners have predictable budgets independent of their server
   IPs? `rateLimitAuthRoute` already supports per-route limits; can
   be extended to per-key.
4. **Issuance + rotation operations.** How does a partner get a key
   today? (Email Slack a value? Generate via admin CLI? Generate via
   a future admin UI?) Same question for rotation cadence.
5. **Audit + abuse handling.** Should we log keyId per request so we
   can revoke a specific key without rotating everyone else? Need a
   stable identifier per key, not just the raw secret.
6. **External-partner discovery.** If we issue keys, do we want a
   `/api/search` doc page or a partner portal? Or just a Slack-DM
   handshake? Affects how much UI work this is.
7. **GraphQL twin.** Does `Query.search` get the same treatment? It
   should — same data, same risk surface. Either both protected or
   both public.
8. **Cloudflare WAF interaction.** Today Cloudflare sits in front of
   admin with rate-limit + bot-fight rules. Auth on the origin
   should compose cleanly but worth confirming the WAF doesn't strip
   the bearer header.

## Suggested kickoff

Start with `/ce:brainstorm` to resolve open questions 1-3 (the
product/scope decisions) before invoking `/ce:plan`. Questions 4-8
can be deferred to planning.

## Notes

(operator additions here)

---

## Status update — 2026-05-17

- **Brainstorm:** [docs/brainstorms/2026-05-17-search-api-auth-requirements.md](../brainstorms/2026-05-17-search-api-auth-requirements.md)
- **Plan:** [docs/plans/2026-05-17-002-feat-search-api-auth-plan.md](../plans/2026-05-17-002-feat-search-api-auth-plan.md)
- **Phase 1 status:** Units 1-5 implemented on `feat/search-api-auth`
  (env vars + disjointness invariant, `search-bearer.ts` validator
  - tests, REST `/api/search` wiring + tests, GraphQL `Query.search`
    wiring + tests, this WAF verification section). Pending: Phase 2
    Doppler provisioning, Phase 3 consumer migrations, Phase 4
    required-auth flip. See plan's Phased Delivery for the rollout
    sequence.

## Cloudflare WAF passthrough verification (Plan 002 Unit 5)

**Pre-merge gate.** Cloudflare in front of admin (DNS, WAF, AOP) must
NOT strip the `Authorization` header on `/api/search` and
`/api/graphql` requests. Run this before any of Phase 2-4 (Doppler
provisioning + consumer migrations + required-auth flip) so we know
WAF behavior matches the in-code expectation.

### Setup (one-time)

1. Generate a disposable test bearer:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
2. On a staging or preview admin environment (anywhere behind
   Cloudflare), add the value to `SEARCH_API_KEYS` on the
   `forge-admin` Doppler project. Leave `SEARCH_AUTH_REQUIRED`
   unset / "false" (still dual-accept; we're only testing header
   passthrough, not the gate).
3. Confirm admin boots cleanly — the disjointness invariant must
   not fire (the test key cannot match any existing CSV entry).

### Probes

Run each from a laptop / external host while tailing admin logs
(`railway logs --service admin` or the Railway dashboard log
stream).

**Probe 1 — valid bearer on REST:**

```bash
curl -i -H "Authorization: Bearer <test-key>" \
  "https://<staging-admin-host>/api/search?q=test&locale=en"
```

Expected admin log line:

```
{"event":"search.request","auth":"bearer","path":"rest"}
```

Expected response: HTTP 200 with normal search response shape.

**Probe 2 — valid bearer on GraphQL:**

```bash
curl -i -H "Authorization: Bearer <test-key>" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"query":"{ search(q:\"test\", locale:\"en\") { query searchMode } }"}' \
  "https://<staging-admin-host>/api/graphql"
```

Expected admin log line:

```
{"event":"search.request","auth":"bearer","path":"graphql"}
```

**Probe 3 — invalid bearer (should still reach handler):**

```bash
curl -i -H "Authorization: Bearer not-a-real-key" \
  "https://<staging-admin-host>/api/search?q=test&locale=en"
```

Expected admin log line:

```
{"event":"search.request","auth":"anonymous","path":"rest"}
```

The proof is that the handler WAS invoked (log line emitted) — if
the WAF stripped the header, the handler would still run but the
absence of header looks identical to the "no auth sent" case. So
Probe 3 alone is insufficient — Probe 1 with a valid key is the
load-bearing one.

**Probe 4 — no header (control):**

```bash
curl -i "https://<staging-admin-host>/api/search?q=test&locale=en"
```

Expected admin log line:

```
{"event":"search.request","auth":"anonymous","path":"rest"}
```

### Acceptance

- Probe 1 → `auth=bearer` in admin log within 5s of curl.
- Probe 2 → `auth=bearer` in admin log within 5s.
- Probe 3 → `auth=anonymous` (the handler was reached but the key
  didn't match — confirms the disjointness with the test key).
- Probe 4 → `auth=anonymous` (same — no header reached the
  handler).

If Probe 1 or Probe 2 shows `auth=anonymous` instead of
`auth=bearer`, **Cloudflare is stripping the header somewhere
upstream**. Do NOT proceed to Phase 2-4. Escalate to the platform
team with the curl command + observed log line; resolution is
likely a WAF rule update on the `admin.jesusfilm.org/api/*` path.

### Cleanup

After the probe passes, remove the disposable test key from
`SEARCH_API_KEYS` on staging (so it doesn't accumulate as cruft).
The real per-consumer keys are provisioned in Phase 2.
