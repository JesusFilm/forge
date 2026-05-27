---
id: "feat-121"
title: "Web User Accounts and Video Download Gate"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-05-27"
duration: 7
depends_on: []
blocks: []
tags:
  - "platform"
  - "accounts"
  - "auth"
  - "web"
  - "download"
  - "launchdarkly"
---

## Problem

The web watch experience currently exposes video downloads to anyone who can
load a watch page. The product requirement is to keep watching public while
requiring a user account before a visitor can download a video. Forge already
has a shared Better Auth service in `apps/admin`; this feature should reuse
that identity surface rather than creating a second web-only auth system. The
account-required download gate should roll out gradually through LaunchDarkly.

## Entry Points - Read These First

1. `apps/web/src/app/api/download/route.ts` - same-origin streaming download proxy and existing SSRF defenses.
2. `apps/web/src/components/watch/WatchPageClient.tsx` - modal state owner for the watch page.
3. `apps/web/src/components/watch/DownloadModal.tsx` - existing ToS and quality-selection download flow.
4. `apps/admin/src/auth/config.ts` - Better Auth configuration, cookie domain, providers, and session settings.
5. `apps/admin/src/auth/origins.ts` - trusted origins and callback URL validation.
6. `apps/admin/src/auth/permissions.ts` - role-to-permission matrix; `VIEWER` is not a permissionless public role.
7. `apps/admin/prisma/schema.prisma` - current `User.role` default and any consumer-account schema change.
8. `apps/admin/src/app/login/login-page-client.tsx` - shared auth UI used by non-admin destinations.
9. `apps/admin/src/app/api/auth/[...all]/route.ts` - Better Auth HTTP surface, CORS wrapper, email sign-in, and public sign-up pass-through.
10. `apps/web/src/env.ts` - existing env-flag conventions and new server env validation.
11. `docs/solutions/auth/better-auth-firebase-migration-must-block-public-signup.md` - prior warning about separating internal admin migration from public signup.
12. `docs/solutions/security-issues/ssrf-defense-streaming-proxy-and-codeql-fp-20260504.md` - security contract for the download proxy.

## Grep These

- `DownloadModal` in `apps/web/src/components/watch/`
- `openDownload` in `apps/web/src/components/watch/`
- `GET /watch/api/download` in `apps/web/src/app/api/download/route.test.ts`
- `get-session` in `apps/admin/node_modules/better-auth/dist/api/routes/session.mjs`
- `AUTH_TRUSTED_ORIGINS` in `apps/admin/src/`
- `callbackURL` in `apps/admin/src/app/login/`
- `sign-up/email` in `apps/admin/src/app/api/auth/[...all]/route.test.ts`
- `VIEWER` in `apps/admin/src/auth/permissions.ts`
- `UserRole` in `apps/admin/prisma/schema.prisma`
- `rateLimitAuthRoute` in `apps/admin/src/auth/`
- `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION` in `apps/web/src/env.ts`
- `LaunchDarkly` or `launchdarkly` across the repo to confirm whether a shared wrapper exists before adding one

## What To Build

1. Add a server-only LaunchDarkly helper in `apps/web` for boolean flag `web-download-account-gate`. Use the server SDK only; do not expose LaunchDarkly keys or client-side flag state. Add `LAUNCHDARKLY_SDK_KEY` and an explicit fallback env such as `WEB_DOWNLOAD_ACCOUNT_GATE_FALLBACK`.
2. Use a stable non-PII rollout context for signed-out users, preferably an HttpOnly same-origin anonymous rollout cookie such as `forge_download_gate_rollout`, so percentage rollout stays stable before and after signup.
3. Add a web auth helper in `apps/web` that verifies the current Better Auth session by forwarding request cookies to the shared auth service endpoint `/api/auth/get-session?disableCookieCache=true&disableRefresh=true`.
4. Add a same-origin web session check route, such as `/watch/api/auth/session`, that returns only a minimal flag/auth result for the watch UI. When the flag is enabled and the visitor is signed out, it should return a sanitized auth `loginUrl` built server-side from a validated `WEB_AUTH_BASE_URL`.
5. Update the download API route so, when the LaunchDarkly flag is enabled for the request context, unauthenticated requests return `401` before URL allowlisting, DNS pre-flight, or upstream fetch. When the flag is disabled, preserve the legacy proxy behavior for controlled rollout only. Authenticated requests keep the existing streaming proxy behavior unchanged.
6. Update the watch Download click flow so flag-disabled cohorts open the existing modal, while flag-enabled signed-out users are redirected to the shared auth UI using the server-returned `loginUrl`. Do not expose `WEB_AUTH_BASE_URL` to client code, and do not put the upstream download URL into the callback URL.
7. Extend the shared login UI to support public account creation for web visitors, preferably as `/login?mode=signup&callbackURL=...`, while keeping the destination-aware copy from `callbackURL`. Signup must submit the Better Auth-required `name`, `email`, and `password` payload and redirect client-side after success.
8. Add an explicit consumer-account authorization boundary for public signup. Do not rely on the current `User.role` default, because `VIEWER` already has internal read permissions. A newly signed-up web account may download public videos but must not receive `VIEWER`, Admin GraphQL read scopes, Admin, Editor, Manager, partner, workflow, or publishing privileges.
9. Update trusted-origin defaults, callback validation, and environment docs so the actual watch origins (`https://jesusfilm.org`, `https://www.jesusfilm.org`, `https://web.jesusfilm.org`, and local web origins through env) are valid auth callback/CORS origins. Constrain web callbacks to watch-page paths and reject `/watch/api/*` and other API paths.
10. Add public-signup abuse controls: rate-limit `sign-up/email`, scope credentialed auth CORS by route/method, fail closed on invalid `WEB_AUTH_BASE_URL`, and short-circuit no-cookie download attempts before calling the auth service.

## Constraints

- Do not add a second auth database or Better Auth adapter to `apps/web`.
- Do not import internals from `apps/admin` into `apps/web`; communicate with the shared auth service over HTTP.
- Do not make watch pages authenticated. Playback, search, share, language switching, recommendations, and study questions remain public.
- Do not pass signed media URLs through auth callback URLs or logs. Auth logs must not include raw emails, passwords, cookies, session tokens, or full callback URLs.
- Do not weaken the existing download proxy defenses: allowlist, DNS SSRF check, redirect refusal, bounded headers, filename sanitization, no-store cache, and streaming body must remain intact.
- Do not grant `VIEWER`, Admin GraphQL, Admin/Manager, partner, workflow, or publishing access from public signup. Role escalation remains an operator-controlled admin concern.
- Do not treat LaunchDarkly as authorization. It only chooses whether the account gate is enforced for a rollout context; the download API still owns the auth check when the flag is enabled.
- Do not silently reopen unauthenticated downloads as a rollback path after rollout is complete. During gradual rollout, a deliberate LaunchDarkly rollback to 0% is allowed only as recorded incident response.

## Verification

- `pnpm --filter @forge/web test`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin typecheck`
- Unit tests cover LaunchDarkly flag on/off behavior for both the session route and direct download API route.
- Browser smoke: signed-out visitor can watch a video, and with LaunchDarkly enabled, download redirects to auth.
- Browser smoke: LaunchDarkly flag disabled preserves legacy download behavior for that rollout cohort.
- Browser smoke: LaunchDarkly flag enabled requires auth before download.
- Browser smoke: new public user signs up, returns to the same watch page, accepts Terms of Use, and starts a download.
- Direct smoke: with LaunchDarkly enabled, signed-out `/watch/api/download?...` returns `401` and does not fetch the upstream asset.
- Privilege smoke: a public web-created account cannot access Admin dashboard, Admin GraphQL read/write scopes, Manager, partner, or workflow surfaces.
- Callback smoke: auth rejects callbacks to `/watch/api/download`, `/watch/api/*`, and other API paths.
- Rollout smoke: configured stage/prod env values include `AUTH_TRUSTED_ORIGINS` for apex, `www`, and `web`, `AUTH_COOKIE_DOMAIN=.jesusfilm.org`, `WEB_AUTH_BASE_URL`/`BETTER_AUTH_URL` pointing at the approved auth host, and LaunchDarkly env for flag `web-download-account-gate`.
- Rollout plan: prove both variations in stage, then ramp production internal/test contexts -> 1% -> 10% -> 50% -> 100%, monitoring signup errors, auth callback failures, direct download `401` rates, and support reports.
