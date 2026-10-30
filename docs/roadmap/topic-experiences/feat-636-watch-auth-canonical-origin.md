---
id: "feat-636"
title: "Use an allowlisted origin for Watch authentication"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "auth"
  - "security"
---

## Goal

Build auth URLs from an explicitly configured origin and ignore unapproved forwarded hosts.

## Entry points

- `apps/web/src/auth/request-origin.ts`
- `apps/web/src/app/api/auth/session/route.test.ts`
- `apps/web/src/env.ts`

## Constraints

- Treat the inbound host (`x-forwarded-host`, then `Host`, then the request URL) as untrusted. Honour it only when it exactly matches an approved origin: `NEXT_PUBLIC_CANONICAL_ORIGIN`, `WEB_BASE_URL`, or a shared Watch callback origin (`@forge/watch-url-policy/callbacks`).
- Outside production only, also honour loopback hosts (`localhost`, `127.0.0.1`, `[::1]`) on any port so local dev and preview proxies keep working.
- Take the scheme from the approved origin, never from `x-forwarded-proto`.
- Fall back to `NEXT_PUBLIC_CANONICAL_ORIGIN` for anything else, including the production internal alias host.
- Keep explicitly configured preview origins working.

## Verification

- `apps/web/src/auth/request-origin.test.ts` covers the internal alias, hostile and lookalike hosts, shared Watch origins, `WEB_BASE_URL`, preview origins, scheme handling, and loopback hosts in and out of production.
- Auth-session and auth-login route tests cover the canonical fallback and relative `returnTo`.
- Web typecheck and lint.

## Tracking

- Linear: FGE-175
