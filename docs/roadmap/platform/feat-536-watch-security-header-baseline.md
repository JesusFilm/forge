---
id: "feat-536"
title: "Close the Watch security-header gaps"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-09-22"
duration: 1
depends_on: []
blocks:
  - "feat-541"
  - "feat-542"
tags:
  - "web"
  - "infrastructure"
---

## Problem

The `/watch` origin ships without a baseline security-header set (Linear FGE-235, W-099
of the 2026-09-13 Watch listing audit).

Measured on production and reproduced locally against `next build` + `next start`:

- `/watch` itself carries **no** `content-security-policy` and **no** `referrer-policy`.
  Both are set only by `applyWatchSecurityHeaders` in `apps/web/src/proxy.ts`, which is
  reachable only from the two proxy rewrite call sites, and the basePath root does not
  take that path.
- Where CSP does apply it is the single directive `frame-ancestors 'self'` — no
  `default-src`, `script-src`, `object-src` or `base-uri`.
- Absent on every response: `Strict-Transport-Security`, `X-Content-Type-Options`,
  `Permissions-Policy`, COOP and CORP. `X-Powered-By: Next.js` is sent.
- Three `images.remotePatterns` entries are hostname-only, so `/watch/_next/image` is a
  working open image proxy for every path on those hosts.
- `webAuthCookieOptions()` scopes the encrypted session cookie and the live OAuth
  state/PKCE-verifier/return-to cookies to `path: "/"`, so they are sent to the WordPress
  half of the same origin.

## Entry Points — Read These First

1. `apps/web/next.config.mjs` — no `headers()` block, `poweredByHeader` left at default,
   `images.remotePatterns` entries for `images.unsplash.com`, `imagedelivery.net` and
   `image.mux.com` carry no `pathname`.
2. `apps/web/src/proxy.ts` — `applyWatchSecurityHeaders`, and its two call sites inside
   `proxy()`.
3. `apps/web/src/auth/web-session.ts` — `webAuthCookieOptions()`, `path: "/"`.
4. `apps/web/src/app/api/auth/{login,callback,logout}/route.ts` — every
   `response.cookies.delete(NAME)` call, which defaults to `Path=/`.
5. `apps/web/watch-base-path.mjs` — the shared `/watch` basePath constant.

## Grep These

- `applyWatchSecurityHeaders`
- `poweredByHeader`
- `remotePatterns`
- `webAuthCookieOptions`
- `cookies.delete(`

## What To Build

- A single shared header set in `apps/web/watch-security-headers.mjs`, consumed by
  `next.config.mjs` `headers()` on `/:path*` so every response is covered, including the
  basePath root that `proxy()` never sees.
- HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, COOP, CORP, `X-DNS-Prefetch-Control`.
- CSP shipped **report-only** first, carrying `default-src`, `script-src`, `object-src`,
  `base-uri` and `frame-ancestors`. Enforcement is a later env flip
  (`WATCH_CSP_ENFORCE=true`), never the same PR.
- `poweredByHeader: false`.
- A `pathname` scope on every remote pattern. Unsplash is pinned to the two fixed
  photos the app renders, which genuinely closes the proxy for that host.
  `imagedelivery.net` and `image.mux.com` get SHAPE-only scoping: both CDNs are
  multitenant and use the same path shape for every customer, so another tenant's
  URL still matches. Closing those needs the account hash / playback id checked
  against admin's own asset records — tracked as follow-up, not done here.
- Auth cookies scoped to the `/watch` basePath, with every clear path also clearing the
  legacy `Path=/` cookie so sign-out still works across the rollout.

## Constraints

- Do NOT enforce CSP in this change. Report-only first; the enforcement point follows
  rollback capability.
- Do NOT restrict `fullscreen`, `autoplay`, `picture-in-picture` or `encrypted-media` in
  `Permissions-Policy` — the Watch hero player uses all four.
- Do NOT change analytics or recommendation behaviour
  (`docs/analytics-and-recommendation-policy.md`); GA and Datadog RUM hosts stay
  reachable under the report-only policy.
- Do NOT change the `/preview/experience` `Referrer-Policy: no-referrer` override.

## Follow-up work split out of this ticket

- `feat-541` — the `imagedelivery.net` / `image.mux.com` patterns are shape-only
  and do not close the open image proxy for those multitenant CDNs.
- `feat-542` — the post-sign-out force-login marker is still burned at the login
  redirect rather than on callback success.

## Verification

- `node_modules/.bin/vitest run scripts/next-config.test.mjs src/auth src/app/api/auth src/proxy.test.ts`
  from `apps/web`.
- `next build` + `next start`, then `curl -sD -` against `/watch`, a content route, and
  the `/watch/_next/image` Unsplash probe from the audit: headers present on all routes,
  probe no longer 200.
- `pnpm --filter @forge/web typecheck` and `pnpm exec prettier --check` on every changed
  file.
