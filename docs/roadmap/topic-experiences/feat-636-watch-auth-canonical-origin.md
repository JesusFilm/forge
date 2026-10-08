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

- Accept forwarded hosts only when they exactly match `NEXT_PUBLIC_CANONICAL_ORIGIN` or `WEB_BASE_URL`.
- Fall back to `NEXT_PUBLIC_CANONICAL_ORIGIN` when the forwarded host is missing or unapproved.
- Keep explicitly configured preview origins working.

## Verification

- Auth-session tests cover canonical fallback for an internal Railway alias and acceptance of an explicitly configured host.
- Web typecheck and lint.

## Tracking

- Linear: FGE-175
