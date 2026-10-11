---
id: "feat-685"
title: "Own the catch-all route's translation promise rejection"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-10"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "reliability"
---

## Problem

`SlugRestPage` in the Watch catch-all route starts `getTranslations(...)` for video, episode and series shapes so it runs beside message loading, then awaits `loadClientMessages(...)` before it awaits the translator. If the translator promise rejects while that await is pending, or if the message load rejects and the page throws first, the translator rejection has no handler when it settles. Node reports it as `unhandledRejection`.

The first version of this ticket (as feat-638, an ID that also collided with two other roadmap tickets) guarded the Watch homepage instead. The homepage already uses `Promise.all` and has no orphan, so that test was removed.

## Entry Points — Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — `SlugRestPage`, `translateAvailabilityCountsPromise`.
2. `apps/web/src/i18n/client-messages.ts` — `loadClientMessages`.
3. `apps/web/scripts/catch-all-route-rejection.test.mjs` and `apps/web/scripts/catch-all-route-rejection/` — Vitest wrapper and the plain-Node child that runs the real route with synthetic stubs.

## Grep These

- `translateAvailabilityCountsPromise`
- `unhandledRejection`

## What To Build

Give the translator promise an owner at construction without changing concurrency, which error wins, or the rendered output.

## Constraints

- Keep `getTranslations` and `loadClientMessages` concurrent.
- A `loadClientMessages` rejection still reaches the route error boundary as that error; a translator rejection still surfaces when the translator is awaited.
- One-segment shapes keep not calling `getTranslations`.
- No production fault injection, deploy or real credentials; evidence is a local synthetic fixture only.

## Verification

- The plain-Node child reports zero `unhandledRejection` events for both failure orders and when both inputs reject, with the message-load error still winning, and the translated markup is produced on success with both inputs overlapped.
- Run the catch-all route tests, Web typecheck, lint and prettier.

## Tracking

- Linear: FGE-158
- PR: https://github.com/JesusFilm/forge/pull/2644
