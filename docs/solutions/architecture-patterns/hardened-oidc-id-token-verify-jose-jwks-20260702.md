---
title: "Hardened OIDC id_token verification with jose (JWKS-derived alg allowlist, no access-token fallback, fail-closed) for a gates-nothing consumer"
date: "2026-07-02"
category: architecture-patterns
module: apps/chat (auth)
problem_type: architecture_pattern
component: authentication
severity: high
applies_when:
  - "A consumer app verifies an OIDC id_token from apps/auth (better-auth) with jose and gates NOTHING on the result (identity-only, no role/scope check)"
  - "Adapting apps/admin's OAuth client into a new consumer — the verifier must NOT be copied verbatim"
  - "Adding an opt-in auth surface that must boot clean and degrade to anonymous when unconfigured"
  - "Reading OAuth transient/session cookies from a raw Cookie header rather than next/headers cookies()"
  - "Unit-testing jose WebCrypto verification under a jsdom-default vitest suite"
tags:
  - oidc
  - id-token
  - jose
  - jwks
  - oauth
  - better-auth
  - fail-closed
  - alg-allowlist
  - cookie-encoding
  - jsdom
  - feat-207
related_components:
  - apps/auth
  - apps/admin
---

# Hardened OIDC id_token verification with jose (JWKS-derived alg allowlist, no access-token fallback, fail-closed) for a gates-nothing consumer

## Context

`apps/chat` (feat-207) added optional sign-in against `apps/auth` (better-auth OIDC),
reusing `apps/admin`'s redirect-based OAuth client _shape_. The trap: admin's
`verifyAdminIdToken` is **not safe to copy verbatim** into a consumer that performs
no authorization. Admin does `const token = idToken ?? accessToken` and calls
`jwtVerify(token, jwks, { issuer, audience })` with **no `algorithms` pin** — and
that is only safe because admin _additionally_ gates every request on the
`admin:access` scope. Chat gates nothing (identity display only), so the id*token
signature + algorithm check is chat's \_sole token-acceptance* barrier. ("Sole"
means the sole check on whether a token is accepted — the reused OAuth shape still
CSRF-protects the callback via `state` and binds the code via PKCE, and the
alg-allowlist hardening below is _in addition to_ those flow-binding controls, not
a replacement. Chat sends **no `nonce`**, and that is deliberate: the id_token is
fetched over the back channel under authorization-code + PKCE with audience
binding, so front-channel id_token replay is out of the threat model — admin's
reference verifier omits nonce for the same reason.) Two changes are therefore
net-new relative to admin's production-proven verifier and must carry their own
tests: **id-token-only (no access-token fallback)** and a **JWKS-derived
`algorithms` allowlist**. These two changes together are the chat-auth plan's
**R9** requirement; `KTD3`/`KTD6`/`KTD7` cited in Related are that plan's Key
Technical Decisions.

**Consequence bound (why this is mostly observability engineering, not privilege
hardening):** because chat performs no authorization, the worst case of an
accepted-but-forged or stale identity in v1 is a wrong or out-of-date display
name/avatar — never any capability. Concretely, the verified `sub` feeds only the
identity display and the session cookie; conversation history keys on a
client-supplied `conversationId`, and nothing authorizes on `sub`. That bound is
what makes the primary failure mode worth optimizing for _observability and
self-healing_ (items 3–4, 6) rather than treating every weakening as a privilege
escalation. The one genuine security barrier is the signature check plus the
token-alg→kty mapping (item 2); the allowlist and cache machinery are **secondary** —
a thin defense-in-depth hedge (version-independence over that mapping) plus alg
hygiene, rotation-tracking, and observability, never the primary barrier and blocking
no forgery the signature+`aud`+`iss` checks don't already. (If chat ever gates a
feature on the session or keys per-user data on `sub`, revisit this bound — items
3–4 would then become privilege-relevant.)

> **Bound flipped (2026-07-13, feat-241):** that revisit clause has fired. Since
> feat-208 the verified `sub` keys per-user server-side memory
> (`user:<sub>` resources), and feat-241's history read path (`/api/history/*`)
> authorizes bulk conversation reads on the session-derived `sub` — an accepted
> forged/stale identity would now read (and resume) that subject's persisted
> conversations, not just mis-render a display name. The JWKS allowlist
> derivation/cache items (3–4) are therefore privilege-relevant, not merely
> observability. The blast radius of a stolen SESSION cookie (as opposed to a
> forged token) is bounded by the 8h TTL and self-scoped reads — see feat-240's
> Decision Record for why revocation was deliberately dropped.

This doc also captures three adjacent gotchas the same work surfaced: a fail-closed
config gate for an opt-in auth surface, a cookie percent-encoding round-trip bug the
tests initially hid, and a jose/jsdom crypto incompatibility.

## Guidance

### 1. Verify the id_token ONLY — no access-token fallback

An absent id*token establishes **no** session (throw, fail closed). Never fall back
to the opaque access token for identity. The access-token fallback is safe in admin
\_only* because of its scope gate; a gates-nothing consumer has no such backstop.

### 2. Understand what the algorithm allowlist actually guards

`jose` maps the **token's `alg` header** to a key type (`getKtyFromAlg`) and throws
`JOSENotSupported` for any `HS*` value, so a symmetric (`HS*`) token can never
resolve against an asymmetric JWKS key — **this token-alg→kty mapping, not the
`algorithms` allowlist, is the symmetric-confusion barrier**, and it holds even
with no allowlist pinned (as in admin). (With the allowlist pinned, jose's
`algorithms.has(alg)` check rejects `HS*` even earlier, before key resolution.)
The allowlist's real job is **not** rejecting `alg: none`: jose's `getKtyFromAlg`
throws on `none` (`"no"` hits the same `default` branch as `HS*`) independent of any
pin, so a _missing_ allowlist does not permit `none` and an _empty_ one rejects
**every** alg (fail-closed, not open). What pinning `algorithms` actually buys is
(a) **defense-in-depth / version-independence** — the `getKtyFromAlg` backstop is
jose-internal behavior, not a spec guarantee, so the pin survives a future jose
change or a JWKS source that would resolve a symmetric key, and it narrows a key
published _without_ an explicit `alg` to one asymmetric alg (a bare `RSA` JWK
resolves for **both** `RS256` and `PS256`; deriving `{RS256}` rejects a `PS256`
token jose would otherwise accept) — and (b) **tracking a key rotation to a
different asymmetric alg** so a hardcoded `["EdDSA"]` pin can't silently reject
every id_token after rotation. Do not describe the allowlist as the symmetric
barrier, and do not describe it as the `alg: none` barrier either — that is the
`getKtyFromAlg` mapping's job.

### 3. Derive the allowlist from the published JWKS — never hardcode

`apps/auth` signs with `EdDSA` today (better-auth's default `jwt()` plugin, no
`keyPairConfig`), but a literal `["EdDSA"]` pin would reject **every** id*token after
a future rotation to a non-EdDSA key — and because chat gates nothing, that surfaces
only as "every sign-in silently goes anonymous, no error, no cross-repo alarm." So:
prefer each JWK's explicit `alg`; else derive from a **total `kty`+`crv` mapping**
(`OKP`+`Ed25519`/`Ed448`→`EdDSA`, `EC`+`P-256`→`ES256`, `P-384`→`ES384`,
`P-521`→`ES512`, `RSA`→`RS256`). An unrecognized `kty`/`crv` with no explicit `alg`
must **fail closed LOUDLY** — contribute nothing to the allowlist AND log a distinct
non-PII config-error code (chat emits `event=jwks_alg_unrecognized`, one line per
unrecognized key, \_during derivation*). An **empty derived allowlist must throw
explicitly** (don't rely on jose rejecting an empty `algorithms` array — that
behavior is a subtle version detail; make the fail-closed intent structural).
Note the terminal throw does **not** by itself tell the two failure modes apart:
both a JWKS _fetch failure_ and a _fetched-but-no-usable-alg_ empty allowlist throw
the same `jwks_unavailable` code. What distinguishes them is the **presence of
preceding `jwks_alg_unrecognized` log lines** — those, not the terminal code, are
how an operator tells "JWKS unreachable" from "JWKS fetched fine but no key mapped
to a usable alg." (Splitting the terminal code would sharpen this; chat does not
currently do it.)

### 4. Invalidate the allowlist cache — don't pin it for process lifetime

A "memoize forever" allowlist defeats rotation-tracking: a long-lived process keeps
rejecting post-rotation tokens until redeploy. Use a **bounded TTL** PLUS
**re-derive-once on an alg-mismatch verify failure** (`ERR_JOSE_ALG_NOT_ALLOWED`),
and gate the forced re-derive behind a **refetch cooldown** so a stream of
non-allowlisted-alg tokens can't amplify one request into one outbound JWKS fetch
(the auth routes ship un-rate-limited in v1). `fetchedAt` updates only on a _real_
fetch, so a legitimate rotation self-heals within the cooldown window.

**Considered simpler baseline:** the only net-new event this machinery
auto-recovers from is a rotation to a _different asymmetric alg family_ (e.g.
EdDSA→ES256) — jose's `createRemoteJWKSet` already refetches on an unknown `kid`,
so a same-alg key roll needs none of this. A do-less alternative is TTL-only (or
boot-derive) plus the greppable `id_token_alg_not_allowed` code and a human
redeploy. That alg-family rotation is rare and human-initiated — but note the
"human in the loop" only materializes if someone is **watching the logs**: chat
wires no alert to these codes today, so detection is manual and reactive (see §6).
The re-derive-on-mismatch + cooldown state earns its keep only if you expect
_unattended_ alg-family rotations; weigh it against that frequency before copying
the pattern to another consumer.

### 5. Build endpoint URLs with `new URL(absolutePath, issuerUrl)`, not string concat

`new URL("/api/auth/jwks", issuerUrl)` resolves against the issuer _origin_ and is
correct for any `AUTH_ISSUER_URL` shape. `${issuer}/jwks` concatenation silently
404s (→ silent-anonymous) when the issuer carries a trailing slash or omits
`/api/auth`.

### 6. Emit distinct non-PII reason codes, log claim NAMES not values

Map jose's typed `.code`/`.claim` into distinct log codes — `id_token_expired`,
`id_token_aud_mismatch`, `id_token_iss_mismatch`, `id_token_signature_invalid`,
`id_token_alg_not_allowed`, `jwks_unavailable` — instead of a single generic
`id_token_invalid`. A deploy-time misconfig (wrong `AUTH_CHAT_CLIENT_ID` → aud
mismatch on _every_ token; wrong issuer → iss mismatch) is then **greppable** rather
than hiding in ordinary token churn — the exact silent-anonymous mode R9 exists to
make visible. Log the claim NAME (`aud`/`iss`), never its value, and never the caught
error's message (it can embed token/claim fragments). Plain-string
`[label] event=name reason=code` format (Railway logsV2 silences JSON stdout from
Next.js runtime route handlers).

### 7. Fail-closed config gate for the opt-in surface

Make ALL auth env vars `.optional()` so a default-off deploy boots clean, and gate
the whole feature behind a runtime `configured()` predicate — NOT a Zod `.url()`
refinement (a set-but-malformed value would then crash boot). The gate must treat
"present but unusable" as **unconfigured**:

- signing secret: reject empty, the shipped `.env.example` placeholder (single-source
  it so it can't drift), and sub-32-char values;
- base URL: reject a scheme-less value (`chat.jesusfilm.org`) — it can't build a
  `redirect_uri` and would throw in `new URL()`. **Also guard the URL helpers to fall
  through to a safe default rather than throw**, because a helper that throws in a
  redirect's eagerly-evaluated default param (evaluated _before_ the route's
  fail-closed `try`) 500s every auth route instead of degrading to anonymous.

### 8. Decode cookies read from the raw header (mocked-vs-real)

`NextResponse.cookies.set` **percent-encodes** values; `next/headers` `cookies()`
decodes on read, but a manual `request.headers.get("cookie")` parse does **not**.
A URL-valued `return_to` therefore arrives percent-encoded in production and gets
mangled — while a test that injects an _unencoded_ `Cookie` header passes. Mirror
Next's decode: `decodeURIComponent`, guarded (it runs before the fail-closed `try`,
so a malformed `%` sequence must not throw), and test with the **encoded** shape.

**Decoding (correctness) and redirect-target validation are separate obligations.**
Decoding a raw-header `return_to` fixes mangling; it does not make the value safe to
redirect to. Validate the redirect target by **origin equality**, not a
relative-path regex: parse `new URL(returnTo, chatBaseURL)` and accept only when
`parsed.origin` equals chat's own origin, else fall back to chat home. Chat does
exactly this in `resolveChatReturnToURL` (`apps/chat/src/auth/origins.ts`, R10) and
runs it at **both** ends — the login route validates the query param before writing
the cookie, and the callback validates again on read. Origin equality normalizes the
input the way the browser does, so `//evil.example` resolves to a foreign origin and
falls back, and an embedded-tab/newline trick (`/\t//evil.example`) is neutralized —
while it still accepts chat's real return targets, which are absolute same-origin
URLs (`https://chat.jesusfilm.org/thread/42`). A single-leading-slash relative-path
regex fails on both counts: it is bypassable via the tab trick AND it wrongly rejects
those absolute same-origin URLs. Test both `return_to=https://evil.example` and
`return_to=//evil.example` asserting the fallback.

### 9. jose WebCrypto needs the node test environment under jsdom

jose's WebCrypto path throws `payload must be an instance of Uint8Array` under jsdom —
jsdom's `TextEncoder` produces a different-realm `Uint8Array` than jose's `instanceof`
check (cross-realm). Crypto/route test files need a top-of-file
`// @vitest-environment node` directive; component/hook tests stay on the jsdom
default. Document the exception since the package convention is jsdom-everywhere.

## Why This Matters

Because chat gates nothing, the id*token signature+alg check is chat's \_sole
token-acceptance* barrier (state/PKCE still bind the flow — see Context). The
weakenings split two ways. One genuinely **widens what's accepted**: falling back to
the opaque access token for identity. (`alg: none` is _not_ in this bucket — jose rejects
it unconditionally via the same `getKtyFromAlg` mapping that blocks `HS*`, pin or no pin;
a missing allowlist doesn't permit it and an empty one rejects everything.) The rest are
**availability/observability** failures —
a hardcoded alg pin or a rotation/misconfig turns into **silent universal anonymity**
(every sign-in quietly goes anonymous). The distinct reason codes and
fail-closed-loud behavior exist specifically so that second class of failure is
_discoverable in the logs_ instead of looking like normal churn. The config gate keeps the feature inert when
unconfigured (safe to merge default-off); the cookie-decode and jsdom items are
"green tests, broken prod" traps — both are mocked-vs-real boundary failures where
the mock's convenient shape diverged from the real contract.

## When to Apply

- Any consumer verifying an `apps/auth` id_token with `jose` that does **not**
  gate on a scope/role — adapt admin's routes but drop the access-token fallback and
  add the JWKS-derived allowlist.
- Any opt-in auth/feature surface that must boot clean and degrade closed.
- Any route parsing OAuth cookies from the raw `Cookie` header.
- Any jose-crypto unit test in a jsdom-default suite.

## Examples

**R9 divergence — before (admin, unsafe to copy) vs after (chat):**

```ts
// admin (safe ONLY because it also gates on admin:access):
const token = idToken ?? accessToken
const { payload } = await jwtVerify(token, jwks, { issuer, audience }) // no algorithms

// chat (gates nothing — the check is the sole barrier):
if (!idToken) throw new ChatAuthError("id_token_missing") // no access-token fallback
const algorithms = await getIdTokenAlgorithms(config) // JWKS-derived, cached+invalidated
const { payload } = await jwtVerify(idToken, jwks, {
  issuer,
  audience: clientId,
  algorithms,
})
```

**Empty allowlist — fail closed explicitly (don't trust jose's empty-array semantics):**

```ts
if (algorithms.size === 0) throw new ChatAuthError("jwks_unavailable")
```

**Cookie decode — mirror Next's encode on a raw-header read (guarded):**

```ts
const raw = /* ...parse from request.headers.get("cookie")... */
if (raw === undefined) return undefined
try { return decodeURIComponent(raw) } catch { return raw } // no-op for base64url; fixes return_to
```

**`return_to` — validate the redirect target by origin equality (what chat ships):**

```ts
// apps/chat/src/auth/origins.ts (R10) — run at BOTH login (before storing the
// cookie) and callback (on read). Cross-origin/unparseable → chat home.
export function resolveChatReturnToURL(
  returnTo: string | undefined,
  fallbackURL = getChatHomeURL(),
): string {
  if (!returnTo) return fallbackURL
  try {
    const parsed = new URL(returnTo, fallbackURL)
    return isTrustedReturnToOrigin(parsed.origin) // parsed.origin === chat's origin
      ? parsed.toString()
      : fallbackURL
  } catch {
    return fallbackURL
  }
}
```

**jose under jsdom:**

```ts
// @vitest-environment node   // top of any jose-crypto test file
```

## Related

- `docs/solutions/auth/admin-sso-uses-oauth-local-session-not-shared-cookies.md` — the sibling admin OAuth setup (authorization-code + PKCE, admin-local cookies); parallel _shape_, but its verifier deliberately lacks chat's id-token-only + alg-allowlist hardening.
- `docs/solutions/auth/better-auth-secret-must-not-fallback-to-hardcoded-value.md` — the fail-closed signing-secret guard; same posture as chat's `isRealSessionSecret`.
- `docs/solutions/auth/spike-auth-header-must-be-env-gated.md` — runtime env-gate discipline for optional auth paths.
- `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md` — why chat's auth env is all-`.optional()` with a runtime gate rather than required-at-schema-load.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the META framework for the cookie-decode and jsdom-crypto traps (and "every typed-discriminator branch needs a test where only it matches" — which is why `id_token_alg_not_allowed` de-vacuumed the allowlist test).
- `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md` — the outbound-timeout discipline applied to the token-exchange and JWKS fetches.
- `docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md` — the inbound-auth pattern NOT yet applied to chat's world-reachable, un-rate-limited auth routes (a documented v1 accepted risk; prerequisite before the audience widens).
- Plan: `docs/plans/2026-06-30-002-feat-chat-auth-plan.md` (R9/KTD3, KTD6, KTD7).
