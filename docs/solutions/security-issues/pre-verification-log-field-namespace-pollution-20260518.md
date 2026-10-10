---
title: "Log-field NAME carries a trust contract — pre-verification values must use a distinct field name"
category: "security-issues"
problem_type: "security_issue"
component: "authentication"
root_cause: "missing_validation"
resolution_type: "code_fix"
severity: "medium"
module: "apps/admin"
tags:
  - log-injection
  - log-namespace
  - structured-logging
  - authentication
  - audit
  - bearer
  - trust-boundary
date: "2026-05-18"
related_prs:
  - "JesusFilm/forge#976"
---

## Problem

A structured log line that emits an identifier extracted from
**untrusted** input under the **same field name** that verified
identifiers use lets an attacker pollute operator log greps. Even when
the value itself is alphabet-constrained (so CR/LF log forgery — see
`log-injection-sanitizer-user-input-structured-logs-20260429` — is not
possible), the SHARED FIELD NAME conflates two trust states.

Operators grep verified-state field names to scope audit queries
("which partners called this week?", "did `keyId=PartnerKey01` make a
request in the last hour?"). If pre-verification log emission uses the
same field name, an attacker submitting `Bearer
jfp_search_PartnerKey01_<random>` for a `keyId` they don't possess can
cause `keyId=PartnerKey01` to appear in operator greps — even though
no verified authentication ever occurred.

## Symptoms

- `grep keyId=X railway.log` returns lines for which the application
  has not yet completed cryptographic verification.
- Operator dashboards filtering on `keyId=X` show inflated activity
  for a legitimate partner whose `keyId` was simply guessed/leaked
  into a parsing-only path (timeout, lookup_error).
- "Which partners are idle?" / "Has this partner integrated?"
  questions answered from logs misreport because every well-formed
  attacker probe surfaces as if the partner had attempted.
- The attacker can never DECRYPT, IMPERSONATE, or BYPASS auth — but
  they can pollute the audit lens that operators use to reason about
  legitimate traffic.

## What didn't work

### Attempt 1: rely on CR/LF sanitization alone

`sanitizeLogValue` (strip `\r\n\t`, clamp to 200 chars) was already
present. It correctly prevents synthetic NEW log records from being
forged. But it does not prevent the value's substring from appearing
under the verified-state field name — because the value is the same
12-char alphabet the parser regex allows, the sanitizer has nothing
to remove.

### Attempt 2: drop the keyId log entirely on the pre-verification path

Considered: emit `event=partner_key.lookup_timeout` with no identifier.
This eliminates the attack surface but also loses the operator's
ability to triage a sustained timeout pattern ("is this one partner
getting hammered, or is the DB just slow?"). The keyId IS useful for
operator debugging — just under a different name.

## Solution

Use a **distinct field name** for pre-verification identifier
emissions so operator greps for the verified state can never match.
The convention used in `apps/admin`:

- `keyId=<id>` — emitted ONLY after constant-time hash match against
  a DB-backed row (verified, trusted).
- `attemptedKeyId=<id>` — emitted in pre-verification paths
  (parse-succeeded, DB lookup timeout, DB lookup error). Same value
  shape, distinct field name.

The fix in `apps/admin/src/services/partner-api-key.service.ts::verifyPartnerToken`
(PR #976, commit `c1aa1e48`):

```ts
// BEFORE — pre-validation log emission uses verified-state field name.
console.error(
  `[search] event=partner_key.lookup_timeout keyId=${parsed.keyId} budgetMs=${PARTNER_KEY_LOOKUP_TIMEOUT_MS}`,
)
// ...
console.error(
  `[search] event=partner_key.lookup_error keyId=${parsed.keyId} error=${sanitizeLogValue(message)}`,
)

// AFTER — pre-validation uses `attemptedKeyId=`.
console.error(
  `[search] event=partner_key.lookup_timeout attemptedKeyId=${parsed.keyId} budgetMs=${PARTNER_KEY_LOOKUP_TIMEOUT_MS}`,
)
// ...
console.error(
  `[search] event=partner_key.lookup_error attemptedKeyId=${parsed.keyId} error=${sanitizeLogValue(message)}`,
)
```

Only the verified-match emission in the request-success log line
keeps `keyId=`:

```ts
// In the verified-match path AFTER `timingSafeEqualHex` returns true:
console.error(
  `[search] event=search.request auth=bearer path=rest rl=redis source=partner keyId=${matchedKeyId}`,
)
```

## Why this works

`grep keyId=X` and `grep attemptedKeyId=X` are distinct queries.
Operators auditing partner traffic grep the FIRST; the SECOND surfaces
attack-probe noise without polluting the verified-state lens.

The field-name choice is the trust boundary. The VALUE is the same
(both come from the token prefix, both constrained to the keyId
alphabet, both 12 chars). What differs is the contract the field name
communicates to downstream readers:

| Field             | Source                                                    | Trust state | Operator semantics                                                         |
| ----------------- | --------------------------------------------------------- | ----------- | -------------------------------------------------------------------------- |
| `keyId=`          | DB-backed row matched after sha256 + `timingSafeEqual`    | Verified    | "This partner actually called us"                                          |
| `attemptedKeyId=` | Parsed from `Authorization` header, NOT yet hash-compared | Unverified  | "Someone presented this id-shaped value (may be legitimate, may be probe)" |

This is the same discipline as separating `user_id` (after auth) from
`session_user_id_claim` (before auth) in identity-provider logs — the
name carries the trust state.

## Prevention

### Pattern: every pre-verification log emission uses a distinct field-name prefix

When emitting a log line that interpolates an identifier extracted
from an untrusted source:

- If the identifier has been cryptographically verified (signature
  match, hash compare under constant time, session-cookie HMAC pass),
  use the canonical field name (`keyId=`, `userId=`, `sessionId=`).
- If the identifier is still pre-verification (parsed from a header,
  read from a request body, extracted from a URL), use a distinct
  field name. Conventions:
  - `attemptedKeyId=`, `attemptedUserId=`, `attemptedSessionId=`
  - OR `claimed<X>=` for SAML/JWT-style claim-before-verify scenarios
  - OR `presented<X>=` for any client-presented identifier

Pick ONE convention per codebase and apply it consistently.

### Test discipline

The PR-#976 service test locks in the field-name rule:

```ts
it("returns valid:false on DB timeout and logs partner_key.lookup_timeout", async () => {
  // ... force a Promise.race timeout ...
  const error = vi.spyOn(console, "error").mockImplementation(() => {})
  await verifyPartnerToken(`Bearer ${rawToken}`, mockPrisma as never)

  expect(error).toHaveBeenCalledWith(
    expect.stringContaining(`attemptedKeyId=${keyId}`),
  )
  // SECURITY regression guard: pre-validation keyId is tagged as
  // `attemptedKeyId=`, NOT `keyId=`. An attacker who probes random
  // `jfp_search_<garbage>_<garbage>` tokens must not be able to
  // pollute operator log greps that filter on `keyId=`.
  const allLogged = error.mock.calls
    .map((args) => String(args[0] ?? ""))
    .join("\n")
  expect(allLogged).not.toMatch(/(?<![a-z])keyId=/i)
})
```

The negative-lookahead regex `/(?<![a-z])keyId=/i` is the load-bearing
guard: it matches `keyId=` at a word boundary but NOT `attemptedKeyId=`
(because that has `d` before `keyId`). A regression that re-introduces
`keyId=` in a pre-verification emission fails the assertion.

### Review checklist for any new log emission that includes an identifier

- [ ] Is the identifier being interpolated extracted from an
      attacker-controlled source (HTTP header, query param, request
      body, URL path)?
- [ ] If YES: has it been cryptographically verified by the time the
      log fires?
  - [ ] If YES: use the canonical field name (`keyId=`, `userId=`, etc.)
  - [ ] If NO: use a distinct field name (`attemptedKeyId=`,
        `claimedUserId=`, etc.)
- [ ] Is there a test asserting the negative case (pre-verification
      paths must NOT emit `keyId=` etc.)?
- [ ] Has the value also been sanitized for CR/LF / control chars
      (see `log-injection-sanitizer-user-input-structured-logs-20260429`)?

## When to use this pattern

- **Bearer/token validation logs** — every parse-then-verify path
  where the parser succeeds but verification can still fail (DB miss,
  hash mismatch, revoked credential, expired token, rate-limit
  rejection).
- **OAuth callback / SAML response logs** — claims extracted from a
  not-yet-verified assertion (`claimedSubject=`, `claimedEmail=`).
- **Session resumption logs** — cookie value present but session not
  yet validated against the store.
- **Multi-stage auth flows** — anywhere the trust state of an
  identifier changes between log emission points.

## When NOT to use this pattern

- **Single-stage auth where the verification is atomic with the log
  emission** — e.g., a basic-auth middleware that 401s without ever
  logging the username. There's no pre-verification log path to
  protect.
- **Identifiers that come from a TRUSTED source** — DB-generated row
  ids, internal-service-mint ids, server-derived correlation ids.
  These don't need a separate namespace because the value's provenance
  is the server itself.
- **Debug-only logs that operators don't grep for audit purposes** —
  if the field name isn't load-bearing for operator workflows, the
  trust contract doesn't matter. Reserve this pattern for fields
  operators use as identity scopes.

## Related learnings

- `docs/solutions/security-issues/log-injection-sanitizer-user-input-structured-logs-20260429.md`
  — sibling pattern. That doc covers CR/LF injection forging synthetic
  records; this doc covers field-name namespace pollution. Both must
  be applied: sanitize the value AND segregate the field name.
- `docs/solutions/security-issues/origin-header-soft-gate-not-security-boundary-20260429.md`
  — adjacent META: log fields and gate checks both have trust-state
  semantics that operators rely on. Mislabeling either is a security
  issue.
- `docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md`
  — the plain-string format requirement that makes the field-name
  choice load-bearing. JSON-payload logs (which Railway logsV2
  silences anyway) would mask this concern; plain-string `key=value`
  logs make it visible.
- `docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md`
  — parent surface where the partner-key verification path lives.
