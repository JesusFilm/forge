---
title: "Post-sign-out force-login marker for OIDC relying apps: consume on completed sign-in; size the marker to the rolling SSO session"
date: 2026-07-13
category: architecture-patterns
module: "apps/chat auth (pattern applies to every apps/auth relying client; apps/web is the pattern source)"
problem_type: architecture_pattern
component: authentication
severity: medium
related_components:
  - "apps/web"
  - "apps/auth"
applies_when:
  - "An app is an OIDC relying client of apps/auth and its sign-out clears only the app-local session cookie"
  - "The provider's SSO session is rolling, so post-sign-out silent re-auth has no natural expiry"
  - "Adding sign-out to a new relying client, or reviewing an existing force-login marker's TTL or consumption point"
  - "A sign-in flow can be abandoned or fail at the provider/callback and must still force a login page on retry"
tags:
  [
    oidc,
    sso,
    sign-out,
    force-login,
    prompt-login,
    better-auth,
    session-cookie,
    shared-device,
    feat-240,
  ]
---

# Post-sign-out force-login marker for OIDC relying apps: consume on completed sign-in; size the marker to the rolling SSO session

## Context

`apps/web` and `apps/chat` are OIDC relying clients of `apps/auth` (Better Auth). Each keeps its own app-local session cookie, and sign-out clears only that cookie — `apps/auth`'s SSO session is deliberately untouched. That SSO session is not just long-lived, it is **rolling**: `expiresIn: 60 * 60 * 24 * 7` with `updateAge: 60 * 60 * 24` (`apps/auth/src/auth/config.ts:185-186`), so any SSO use extends it another week. The consequence: a user signs out of the app, the next person on the same browser clicks "Sign in", and the provider silently re-authenticates them into the previous user's account without ever rendering a login page — a shared-device hazard (recorded as an accepted risk in chat's feat-207, and getting real teeth once feat-241 exposes conversation history behind that session).

The fix is a browser-local **force-login marker**: sign-out sets a hardened single-use cookie; the next sign-in sees it and sends `prompt=login` to the provider, which renders a real login page even with a live SSO session. `apps/web` shipped this pattern first and runs it in production against the same `apps/auth`. Chat's feat-240 implementation (ships with feat-240's implementation PR, uncommitted at time of writing) copies web's shape but corrects two design parameters — the marker's **lifetime** and its **consumption point** — and both corrections generalize. Full decision context, including why session revocation was deliberately dropped in favor of this marker, lives in `docs/roadmap/ai-chat/feat-240-chat-sign-out-force-login.md` (Decision Record); this doc records the marker pattern itself, not that debate.

## Guidance

The pattern has five pieces (citations are chat's implementation at this tree):

1. **Logout sets the marker alongside deleting the session cookie.** A single-use cookie, same hardening as the session cookie: HttpOnly, Secure in production, SameSite=Lax, host-only (no `Domain`), `Path=/` (`apps/chat/src/app/api/auth/logout/route.ts:24-29`; options composed by `forceLoginCookieOptions()` in `apps/chat/src/auth/session-cookie.ts:129-134`). The marker name follows the app's cookie prefix: `CHAT_FORCE_LOGIN_COOKIE` = `forge_chat_force_login` by default (`apps/chat/src/auth/session-cookie.ts:46` + `apps/chat/src/config/env.ts:29`). Keep logout a POST so it isn't prefetchable.

2. **Login reads the marker and adds `prompt=login` to the authorize URL — and never deletes it.** Chat's login route reads the raw `Cookie` header via `readRequestCookie` and threads `prompt: forceLogin ? "login" : undefined` into the authorize-URL builder (`apps/chat/src/app/api/auth/login/route.ts:43-57`). There is deliberately no `?prompt=` query passthrough on chat's route — the marker is the only trigger. (Web additionally accepts a `?prompt=` param for its account-switching UX; that is a separate feature, not part of this pattern.) If a relying app constructs authorize URLs in more than one place, EVERY construction site must read the marker — a single unmarked path both silently re-auths and, via consume-on-success, burns the marker for the marked paths.

3. **The authorize-URL builder takes an optional, narrowly-typed prompt.** `buildChatAuthorizeUrl({ ..., prompt?: "login" })` appends `prompt=login` only when set (`apps/chat/src/auth/oauth-client.ts:94-118`). The narrow literal type keeps arbitrary prompt values unrepresentable.

4. **The provider honors it with zero provider-side changes.** `@better-auth/oauth-provider@1.6.2`'s authorize handler forces the login page whenever the prompt set contains `login`, even with a live session (`node_modules/.pnpm/@better-auth+oauth-provider@1.6.2*/node_modules/@better-auth/oauth-provider/dist/index.mjs:3763-3766`):

   ```js
   const session = await getSessionFromCtx(ctx)
   if (!session || promptSet?.has("login") || promptSet?.has("create")) {
     if (promptNone)
       return redirectWithPromptNoneError(
         ctx,
         opts,
         query,
         "login_required",
         "authentication required",
       )
     return redirectWithPromptCode(
       ctx,
       opts,
       promptSet?.has("create") ? "create" : "login",
     )
   }
   ```

   This citation is pinned to `@better-auth/oauth-provider` 1.6.2 (`apps/auth` pins the exact version in its `package.json`); after a bump, re-verify by grepping the new dist for `promptSet?.has("login")` — the quoted branch is the durable anchor, the path and line numbers are not.

5. **The marker is consumed ONLY by the OAuth callback's success path.** Chat's callback deletes the marker on the same response that sets the new session cookie (`apps/chat/src/app/api/auth/callback/route.ts:88-91`); the single failure catch clears the transient state/verifier/return_to cookies but leaves the marker armed (`apps/chat/src/app/api/auth/callback/route.ts:92-101` — `clearTransientCookies` at `apps/chat/src/app/api/auth/callback/route.ts:104-108` does not touch it), so a failed or abandoned attempt still forces a login page on retry.

### The two insights that go beyond the original web implementation

**Insight 1 — LIFETIME: size the marker to the rolling SSO session; single-use consumption makes lifetime cost-free.** Because the provider's SSO session rolls, no finite marker TTL can claim to cover the entire silent-re-auth window — the window has no fixed end. But under consume-on-success the marker never lingers on an actively-used browser: the first completed sign-in deletes it. So a long TTL costs nothing and a short one silently expires the protection. Chat uses 30 days (`FORCE_LOGIN_TTL_SECONDS = 60 * 60 * 24 * 30`, `apps/chat/src/auth/session-cookie.ts:39`); web uses 10 minutes (`maxAge: 60 * 10`, `apps/web/src/app/api/auth/logout/route.ts:44`) — sized like web's other transient auth cookies rather than for shared-device sign-out. Word the user-facing guarantee with its bound: "after sign-out, every sign-in to this app on this browser within 30 days shows a real login page until one completes" — per-app, and never an unqualified "always".

**Insight 2 — CONSUMPTION POINT: consume on callback success, keep armed on failure.** Web deletes the marker on the login redirect itself (`apps/web/src/app/api/auth/login/route.ts:65`) — before any OAuth outcome exists. If the user abandons the provider's login page or the callback fails, the marker is already burned, and the NEXT click of "Sign in" silently re-auths via the SSO session — the exact hazard the marker exists to prevent. The fix is to treat the marker like a claim ticket: login only reads it; the callback's success path consumes it; every failure path leaves it armed. This gap was surfaced during feat-240's code review by multiple reviewers converging independently on the same line (per that session's review; the ticket's What To Build step 2 records the substance), and then validated against the flow. Web's production copy has the identical gap, masked in practice by its 10-minute TTL (the marker usually expires before the difference is observable).

The two insights compose: a 30-day marker with delete-on-redirect would leave a huge disarmed window after one abandoned attempt, and a 10-minute marker with consume-on-success barely outlives a coffee break. Generous lifetime is only safe **because** consumption is tied to a completed sign-in, and consume-on-success only covers the rolling window **because** the lifetime is generous.

## Why This Matters

- **The hazard is concrete and quiet.** On a shared or family device, "sign out, next person clicks Sign in" lands them in the previous user's account with no credential prompt and no visible anomaly. For chat this escalates when feat-241 exposes conversation history — the next person would land inside the previous user's full history. The marker turns that into a real login page.
- **The failure modes of getting the parameters wrong are invisible.** A too-short TTL or a burn-on-redirect marker doesn't error — it just silently stops protecting, and nothing in tests or logs flags it. That's why the review-hardened consumption point matters: the abandoned-attempt scenario is exactly the kind of adversarial path unit tests of the happy flow never exercise (independent reviewers converging on it is the signal that it's a design-shape bug, not a nitpick).
- **Honest scope.** The marker prevents ACCIDENTAL silent re-auth, and only within precise bounds — don't oversell it. What it does NOT cover:
  - **Per-app, per-device semantics.** The marker is a host-only, per-app cookie: signing out of one relying app does not force a login page at its siblings — a subsequent sign-in on `apps/web` (or any other relying client) on the same browser still silently rides the live SSO session. And "sign out everywhere" requires revocation, which feat-240's Decision Record deliberately dropped for chat's 8h display-only session.
  - **Explicit sign-out only.** The marker arms only when the user actually signs out — a session that expires or a user who walks away signed in sets no marker, so the next sign-in on that browser still silently re-auths.
  - **A deliberate next user** can clear the app's cookies (deleting the marker); `apps/auth`'s SSO session itself stays untouched by design (the same trade web made).
  - **Upstream IdP sessions.** The marker forces `apps/auth`'s own login page only. When social/upstream providers are configured (Google/Facebook/Apple/Okta, env-gated in `apps/auth/src/auth/config.ts:32-71`), the upstream IdP's session is untouched — a previous social-login user can be re-authed in one click on that page. The guarantee is that a login page renders, not that credentials are re-entered.
  - **Logout CSRF (bounded nuisance).** The logout POST carries no CSRF/Origin check, so a third-party page can log a visitor out and force-arm the marker on demand. This can only produce extra login prompts, never bypass the marker's protection — disarming requires a state+PKCE-verified callback success. "Keep logout a POST" defeats prefetch/crawl only, not JS-driven cross-site form submission; copying chat's shape ships this same considered trade-off.
- **Zero provider cost.** The whole pattern is client-side cookies plus a standard OIDC `prompt=login`; `apps/auth` is consumed exactly as deployed.

## When to Apply

- Any app-local sign-out in an OIDC relying client of `apps/auth`: pair the session-cookie delete with a force-login marker. For any OTHER provider with a rolling SSO session, the pattern transfers only after verifying that provider forces re-authentication on `prompt=login` with a live session (OIDC makes honoring it a SHOULD, not a MUST — browser-smoke it first). This doc's honoring evidence covers `@better-auth/oauth-provider@1.6.2` only; a provider that ignores `prompt=login` both silently re-auths AND consumes the marker at the completed callback — a compounding, invisible failure.
- Building a new relying client: copy chat's shape (30-day marker, login reads, callback success consumes, failure keeps armed), not web's (10-minute marker, login redirect deletes).
- Reviewing an existing marker implementation: check both parameters — is the TTL sized to the rolling SSO window (not to an unrelated UX budget), and is consumption tied to a COMPLETED sign-in (not to merely starting one)?
- Writing route tests for the flow: assert all five behaviors — logout sets the marker with exact hardening + TTL; login with the marker builds `prompt=login` and leaves the marker untouched; login WITHOUT the marker builds an authorize URL with no `prompt` parameter (a hardcoded `prompt=login` would defeat SSO convenience while every other test stays green); callback deletes it on success; callback keeps it armed on failure. These are all client-side: none can detect a provider that stops honoring `prompt=login` — on any `@better-auth/oauth-provider` version bump or provider swap, re-verify with a live SSO session that a real login page still renders (browser smoke).
- `apps/web`'s copy is a known instance of the consumption-point gap (masked by its 10-minute TTL); apply this doc when that surface is next touched.

## Examples

**Before — web's shape (pattern source, carries the consumption-point gap).** The login route both arms `prompt=login` and burns the marker, before any OAuth outcome exists (`apps/web/src/app/api/auth/login/route.ts:39-66`):

```ts
const prompt =
  parsePrompt(url.searchParams.get("prompt")) ??
  (cookieStore.get(WEB_AUTH_FORCE_LOGIN_COOKIE) ? "login" : undefined)
const state = createOAuthState()
const response = NextResponse.redirect(
  buildWebAuthorizeUrl({
    config,
    state: state.state,
    codeChallenge: state.codeChallenge,
    prompt,
  }),
)
// ... set transient state/verifier/return_to cookies ...
response.cookies.delete(WEB_AUTH_FORCE_LOGIN_COOKIE) // burned here — an abandoned or
return response // failed attempt disarms the marker
```

If the user closes the provider's login page here, the marker is gone; their next "Sign in" silently re-auths via the live SSO session.

**After — chat's shape (consume on callback success only).** Login reads without deleting (`apps/chat/src/app/api/auth/login/route.ts:43-57`):

```ts
// feat-240: the post-sign-out marker forces a real login page at apps/auth
// (no silent SSO re-auth). Consumed by the callback's SUCCESS path only, so
// a failed/abandoned attempt keeps forcing login. No ?prompt= passthrough.
const forceLogin =
  readRequestCookie(request.headers.get("cookie"), CHAT_FORCE_LOGIN_COOKIE) !==
  undefined

const response = NextResponse.redirect(
  buildChatAuthorizeUrl({
    config,
    state: state.state,
    codeChallenge: state.codeChallenge,
    prompt: forceLogin ? "login" : undefined,
  }),
  302,
)
// transient cookies set below; the force-login marker is NOT touched here
```

The callback consumes it only after a verified sign-in, and the single failure catch leaves it armed (`apps/chat/src/app/api/auth/callback/route.ts:75-101`):

```ts
const response = NextResponse.redirect(returnTo, 302)
response.cookies.set(CHAT_SESSION_COOKIE, await createChatSessionCookie({ ... }), chatSessionCookieOptions())
clearTransientCookies(response)
// feat-240: sign-in completed — consume the force-login marker. The catch
// below keeps it armed so a failed/abandoned attempt still forces login.
response.cookies.delete(CHAT_FORCE_LOGIN_COOKIE)
return response
} catch (error) {
  console.error(`[chat-auth] event=callback_failed reason=${chatAuthErrorCode(error)}`)
  const response = NextResponse.redirect(homeWithSignInError(), 302)
  clearTransientCookies(response) // state/verifier/return_to only — marker stays armed
  return response
}
```

**The lifetime declaration, with its reasoning inline** (`apps/chat/src/auth/session-cookie.ts:36-39`):

```ts
// Force-login marker (feat-240): 30 days, NOT web's 10 minutes — apps/auth's
// SSO session is rolling, so no finite marker covers the whole silent-re-auth
// window; consumed on the next COMPLETED sign-in, so lifetime is cost-free.
export const FORCE_LOGIN_TTL_SECONDS = 60 * 60 * 24 * 30
```

**Setting the marker at logout** (`apps/chat/src/app/api/auth/logout/route.ts:24-29`):

```ts
export async function POST() {
  const response = NextResponse.redirect(getChatHomeURL(), 303)
  response.cookies.delete(CHAT_SESSION_COOKIE)
  response.cookies.set(CHAT_FORCE_LOGIN_COOKIE, "1", forceLoginCookieOptions())
  return response
}
```

## Related

- `docs/roadmap/ai-chat/feat-240-chat-sign-out-force-login.md` — the ticket; its Decision Record covers why session revocation was deliberately dropped (the marker is the accepted alternative, not a stopgap for it).
- `apps/chat/CLAUDE.md` — Authentication section documents the sign-out semantics and the two divergences from web.
- `apps/web/src/auth/web-session.ts:14`, `apps/web/src/app/api/auth/logout/route.ts`, `apps/web/src/app/api/auth/login/route.ts` — the original web implementation (pattern source; carries the known consumption-point gap masked by its 10-minute TTL).
- `apps/auth/src/auth/config.ts:184-191` — the rolling SSO session (`expiresIn` 7d + `updateAge` 1d) that motivates the lifetime insight.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the abandoned-attempt scenario is another instance of adversarial paths that happy-flow tests never exercise.
- `docs/solutions/architecture-patterns/hardened-oidc-id-token-verify-jose-jwks-20260702.md` — feat-207's hardened OIDC callback for the same `apps/chat` auth route family this pattern extends (id_token verification vs post-logout re-auth prevention).
- `docs/solutions/architecture-patterns/fail-closed-by-construction-feature-flag-gate-20260708.md` — same discipline, different surface: the marker is armed-by-default and only disarmed on verified callback SUCCESS, mirroring "the false default, not the ordering, is what prevents a grant".
- `docs/solutions/auth/admin-sso-uses-oauth-local-session-not-shared-cookies.md` — the relying-app-owns-its-own-cookie-state precedent this pattern follows.
- `docs/solutions/auth/better-auth-secret-must-not-fallback-to-hardcoded-value.md` — the fail-closed signing-secret posture `session-cookie.ts` reuses (and feat-240's rotate-`CHAT_SESSION_SECRET` incident lever relies on).
- `docs/solutions/auth/public-repo-oauth-seed-railway-domain-exposure-calculus.md` — chat's OAuth client seed in apps/auth (the authorize surface `prompt=login` is sent against).
- `docs/solutions/workflow-issues/removal-recipe-ticket-for-phase-scoped-scaffolding-20260708.md` — contrast, not precedent: the marker is permanent infrastructure, so unlike feat-233's dogfood gate it needs no removal-recipe ticket.
