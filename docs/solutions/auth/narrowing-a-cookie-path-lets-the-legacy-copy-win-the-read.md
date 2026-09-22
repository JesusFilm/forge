---
title: "Narrowing a cookie's Path leaves a legacy copy that WINS the read"
date: "2026-09-22"
category: "auth"
module: "apps/web auth session cookies"
problem_type: "logic-error"
component: "authentication"
severity: "high"
applies_when:
  - "Changing a cookie's Path, Domain, or name (anything that makes the old and new cookie distinct to the browser)"
  - "Scoping a session or CSRF/PKCE cookie to a basePath"
  - "Any rollout where a cookie written by the previous deploy is still in browsers"
tags: [cookies, auth, session, rollout, nextjs, basepath, migration]
related_components: [apps/web]
---

# Narrowing a cookie's Path leaves a legacy copy that WINS the read

## Context

FGE-235 scoped Watch's auth cookies from `path: "/"` to the `/watch` basePath, so
the encrypted session cookie and the live OAuth PKCE verifier would stop being sent
to the WordPress application sharing `www.jesusfilm.org`.

The obvious rollout hazard — "sign-out must clear the old cookie too" — was handled.
The non-obvious one nearly shipped a P1.

## The trap

A browser that holds **both** `forge_web_session` at `Path=/` (pre-deploy) and at
`Path=/watch` (post-deploy) sends both on every `/watch/*` request. Two things then
compose badly:

1. **RFC 6265 §5.4** orders same-named cookies **longer-path first**, so the header
   is `fresh-watch-scoped; …; stale-legacy` — the stale one is **last**.
2. Next's cookie parser (`@edge-runtime/cookies`) builds a **Map keyed by name**,
   iterating left to right with `map.set(name, value)` — so the **last** pair wins.

Net: `cookies().get(name)` returns the **stale** cookie. Verified directly against
the installed dependency:

```
node -e '
const { RequestCookies } = require("next/dist/compiled/@edge-runtime/cookies");
const h = new Headers();
h.set("cookie", "forge_web_session=NEW_WATCH_SCOPED; forge_web_session=OLD_LEGACY");
console.log(new RequestCookies(h).get("forge_web_session"));
'
// => { name: 'forge_web_session', value: 'OLD_LEGACY' }
```

So a user signed in before the deploy who signs in **again** writes a valid new
cookie and then keeps reading the old one — appearing to fail login, repeatedly,
for the rest of the legacy cookie's 7-day life. Worse, two readers in the same app
can disagree: a hand-rolled parser using `.find()` (first match) resolves to the
FRESH value while `cookies().get()` resolves to the STALE one.

## The rule

**The response that establishes the new cookie must also expire the legacy one** —
and only the legacy one, at the old Path. A full dual-path clear would delete the
cookie you are writing.

Two distinct operations, not one:

- `clearWebAuthCookie(headers, name)` — both paths. For sign-out and for handshake
  cookies being consumed.
- `clearLegacyWebAuthCookie(headers, name)` — legacy path only. For a cookie this
  same response is writing fresh.

Mechanical constraints that ride along:

- `NextResponse.cookies` is **keyed by name**, so it cannot express two cookies
  differing only by Path. The legacy clear must be a raw
  `headers.append("Set-Cookie", …)`.
- `ResponseCookies.set()/delete()` **rewrites the whole `Set-Cookie` header** from
  its own parsed map, silently dropping earlier raw appends. So every
  `response.cookies.*` call must come **before** every raw append on that response.

## Why tests missed it

The route tests mock `next/headers` with a `Map<string, string>` cookie jar, which
**structurally cannot hold two values for one name** — the condition under test is
unconstructible in the harness. Every assertion was on the WRITE side
(`response.cookies.get(name)?.path`, or the count of `Set-Cookie` lines); none on
what a subsequent READ resolves to.

The anti-vacuous companion is a real-contract assertion against Next's own
`RequestCookies` with both cookies present, plus a route test proving the fresh
`Path=/watch` line survives while the `Path=/` line carries `Max-Age=0`.

## Prevention

- [ ] Changing a cookie's Path/Domain/name? Name the coexistence window explicitly.
- [ ] Does the response that writes the new cookie retire the old one?
- [ ] Does the clear target only the old scope?
- [ ] Is there a read-side test with BOTH cookies present, using the framework's own parser?
- [ ] Do all `response.cookies.*` calls precede any raw `Set-Cookie` append?

## Related

- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — a mock that cannot represent the failing state is the purest form of that trap.
- `apps/web/src/auth/web-session.ts` — `clearWebAuthCookie` / `clearLegacyWebAuthCookie`.
