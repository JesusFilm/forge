---
id: "feat-322"
title: "TV Sign-In and Profile (device authorization)"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-07-29"
duration: 12
depends_on:
  - "feat-121"
blocks: []
tags:
  - "platform"
  - "auth"
  - "oauth"
  - "tv"
---

## Problem

TV has no accounts and stays anonymous (`docs/observability/datadog.md`), so nothing on Apple TV / Android TV can personalize: no watch history, no resume, no saved videos. The forge already runs a standalone OAuth 2.1/OIDC identity provider (`apps/auth`, better-auth, `auth.jesusfilm.org`) with six relying clients (web, admin, chat, manager, mastra-studio, admin-mcp) — TV should be the seventh and the first native one.

Apple TV ships no web browser (no WebKit on tvOS), so browser-redirect PKCE is impossible there. The only viable UX is RFC 8628 device authorization: the TV shows a QR + user code, the user approves on their phone, the TV polls for the grant.

The TV-side UI scaffolding shipped with this ticket (flag-gated, stubbed grant). The server-side grant is the open architectural decision below.

## The architectural decision — RESOLVED 2026-08-06

**Route A, with a corrected mechanism.** The server half is built; see
`docs/plans/2026-08-05-001-feat-tv-device-grant-sign-in-plan.md` for the plan it
came from. What shipped differs from Route A as written below in one important
way, so read this before touching the grant.

Route A proposed enabling `deviceAuthorization()` and adding a step that
translates its session into OAuth tokens. Reading the 1.6.2 dist ruled that out:
`@better-auth/oauth-provider` exports no token-minting function, so a translation
step would have to _re-implement_ issuance — the same `client_id`/scope drift
that caused a real IdP account-takeover. And the bundled plugin would have to be
overridden completely anyway (plaintext codes, non-atomic
`findOne -> branch -> delete`, session tokens, no scope check, no rate limits).

What shipped instead: **an own plugin whose approved poll mints a real OAuth
authorization code, then lets the provider's own `/oauth2/token` issue the
tokens.** Nothing is re-derived at exchange time, so the drift hazard is absent
by construction rather than mitigated. Tokens are ordinary `jfp_at_`/`jfp_rt_`
pairs with the usual claims. The bundled plugin is deliberately NOT registered.
The TV supplies PKCE, which RFC 8628 does not require — a stolen device code
alone cannot be redeemed.

### Blocking precondition for the TV client build

**Introspection in `@better-auth/oauth-provider@1.6.2` is caller-scoped**:
`validateJwtAccessToken` and `validateOpaqueAccessToken` both end with
`if (clientId && <token>.clientId !== clientId) return { active: false }`, so a
client can only introspect its own tokens, and only with a client secret. Access
tokens are opaque (`jfp_at_…`), so a relying app cannot verify locally either.

Admin holds a single `AUTH_WEB_USER_INTROSPECTION_CLIENT_ID`, so **it cannot
currently authorize both `jfp_web_*` and `jfp_tv_*` tokens.** Verified against a
real database, not by reading alone. Every admin-side test mocks `fetch`, so no
existing test establishes the real contract in either direction — this may also
affect web today.

Resolve before shipping a TV build, in preference order:

1. Admin keeps a client-id → secret map and retries introspection with the TV
   credential when the web credential returns `active: false`. Contained to
   admin, one extra round trip at most.
2. Auth grows a trusted-introspector path in its own `/api/oauth/introspect`
   route that skips caller scoping for a designated internal client. More
   capable, wider blast radius.

The regression guard for this is
`apps/auth/src/services/device-grant.integration.test.ts` — if a library upgrade
relaxes the scoping, the cross-client case goes red and the workaround can be
dropped.

## Original framing (superseded by the section above)

`better-auth@1.6.2` ships an RFC 8628 `device-authorization` plugin (`node_modules/better-auth/dist/plugins/device-authorization/`) with correct `authorization_pending`/`slow_down` polling semantics — BUT it does not compose with `@better-auth/oauth-provider` (the plugin that mints the introspectable tokens admin trusts):

1. The oauth-provider plugin contains no device grant at all.
2. `/device/token` returns a plain better-auth **session token**, not an OAuth access token — not backed by the `OauthAccessToken` table, carries no id_token/audience/environment claims, so admin's `resolveWebUserPrincipalFromToken` (introspection) rejects it outright.
3. Neither `deviceAuthorization()` nor `bearer()` is enabled in `apps/auth/src/auth/config.ts`, and the `deviceCode` table is absent from `apps/auth/prisma/schema.prisma` — migration required.

Three routes; pick one before any server code:

- **A. Enable the device plugin + a translation step** that exchanges the device-grant session for a proper OAuth access/id token pair (custom endpoint in apps/auth).
- **B. Add a device grant to the oauth-provider layer** itself (upstream-shaped change; check whether newer `@better-auth/oauth-provider` has grown one before building).
- **C. No device codes** — in-app browser PKCE with the `org.jesusfilm.forgetv` scheme. **Dead on arrival for Apple TV (no browser)**; only viable if Apple TV is dropped from scope.

## Entry Points — Read These First

1. `apps/auth/src/auth/config.ts` — the whole provider config; where `deviceAuthorization()` would be enabled and `firstPartyUserClaims()` mints claims.
2. `apps/auth/src/domain/apps.ts` + `scopes.ts` — client seed registry (no `tv` entry yet) and the closed scope catalog (`openid`, `profile:read`, `email:read`, `offline_access`, …). TV needs `offline_access` (long-lived living-room sessions), unlike web which deliberately omits it.
3. `apps/chat/src/auth/oauth-client.ts` — the hardened relying-client template: id-token-only verification, JWKS-derived algorithm allowlist, fail-closed unconfigured, typed non-PII error codes. See `docs/solutions/architecture-patterns/hardened-oidc-id-token-verify-jose-jwks-20260702.md`.
4. `apps/admin/src/auth/web-user-token.ts` — how admin turns a bearer into a `WEB_USER` principal via introspection; a TV client id must be added to `AUTH_WEB_USER_CLIENT_IDS` for TV tokens to pass.
5. `apps/tv/src/components/profile/ProfileScreen.tsx` — the shipped UI scaffolding: pending (QR + user code + waiting) and signed-in states; the demo-approve row is the seam the real polling replaces.
6. `apps/tv/src/lib/auth/deviceAuthFlow.ts` — pure state module mirroring RFC 8628 field names; `createPendingSession` is replaced by the real `/device/code` response.
7. `apps/tv/src/lib/authHeaders.ts` + `src/lib/apolloClient.ts` (`mergeContextHeaders`) — the fleet bearer is pinned to the `WatchSearch` op; the user token MUST be a separate Apollo link, never a widening of that one.
8. `apps/tv/src/lib/viewer-id.ts` — in-memory anonymous id; login-era follow-up is persisting it and merging into the account identity.
9. `docs/plans/2026-07-02-001-feat-web-auth-watch-history-plan.md` + `docs/roadmap/platform/feat-229-web-auth-watch-history.md` — the closest shipped precedent (web).

## Grep These

- `deviceAuthorization` in `node_modules/better-auth/dist/plugins/device-authorization/` — plugin options (`expiresIn`, `interval`, `userCodeLength`, `verificationUri`, `validateClient`)
- `AUTH_WEB_USER_CLIENT_IDS` in `apps/admin/` — client-id allowlist for introspected user tokens
- `isProfileSurfaceEnabled` in `apps/tv/` — the flag gate for the whole TV surface
- `EXPO_PUBLIC_TV_PROFILE_ENABLED` — release-build opt-in (dev builds always show it)
- `mintAgentLoginHandle` in `apps/auth/src/services/agent-login.service.ts` — nearest structural precedent for a short-lived handoff credential

## What To Build

Server (after the A/B decision):

1. `deviceCode` Prisma model + migration in `apps/auth` (device plugin's table).
2. Device grant wiring per the chosen route, returning tokens admin's introspection accepts (verify with `resolveWebUserPrincipalFromToken` against a real grant).
3. `tv` entry in `apps/auth/src/domain/apps.ts` (public client, `tokenEndpointAuthMethod: "none"`, scopes `openid profile:read email:read offline_access`) + seed run. Seed is upsert-only — never prunes.
4. TV client id into admin's `AUTH_WEB_USER_CLIENT_IDS`.

TV: 5. Replace `createPendingSession` stub with the real `/device/code` call; poll `/device/token` at the server-given interval honoring `authorization_pending`/`slow_down`; store tokens in `expo-secure-store` (new dependency + prebuild — AsyncStorage is plaintext and must not hold refresh tokens). 6. Auth provider in `app/_layout.tsx` following the require()-in-try/catch convention; profile data read from auth's userinfo endpoint (admin GraphQL has NO end-user read path). 7. Separate Apollo link attaching the user token (composes via `mergeContextHeaders`); fleet bearer stays pinned to `WatchSearch`. 8. Persist `viewer-id` across launches and thread it into the account merge.

## Constraints

- NEVER put the watch-progress service key in the TV binary — `EXPO_PUBLIC_*` is extractable; that REST surface trusts a caller-supplied userId (confused-deputy by design, server-side only).
- No shared `.jesusfilm.org` cookie — per-app local sessions only (`docs/solutions/auth/admin-sso-uses-oauth-local-session-not-shared-cookies.md`).
- The QR must show on BOTH platforms — do not gate on `isTvOS` like LinkModal does (its Android WebView branch would put a keyboard web form on a D-pad remote).
- Datadog: TV asserts zero-PII (no `setUser`); user code/email must never reach an `accessibilityLabel` that becomes a RUM action name — use `ddActionName` overrides. Revisit the zero-PII claim in `docs/observability/datadog.md` when accounts land.
- Typed text entry stays out of scope: TV's keyboard is letters-only; the device flow avoids it entirely.
- feat-229 v1 exclusions still hold (no playlists, saved videos, parental controls, etc.) — this ticket is sign-in + profile display only.

## Verification

- `pnpm --filter @forge/tv test && pnpm --filter @forge/tv typecheck && pnpm --filter @forge/tv lint`
- Release-build gating: EAS preview build WITHOUT `EXPO_PUBLIC_TV_PROFILE_ENABLED` shows no Profile tab; with `=1` shows it.
- End-to-end (post-server): scan QR on a real phone → approve → TV lands signed-in within one poll interval; token survives app relaunch (secure store); admin GraphQL accepts the user token on a gated operation; `resolveWebUserPrincipalFromToken` log shows the TV client id.
- tvOS sim D-pad sweep of both screen states (focus ring on every row, no focus escape into the QR tile).
