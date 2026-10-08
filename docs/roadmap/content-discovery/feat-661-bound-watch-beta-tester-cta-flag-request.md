---
id: "feat-661"
title: "Bound the Watch beta-tester CTA flag request"
owner: "urim"
priority: "P2"
status: "complete"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
---

## Problem

The global Watch beta-tester CTA flag is fetched after hydration from a same-origin no-store endpoint, but the request has no timeout and cleanup does not abort it. Public Watch pages are statically cached, so resolving this runtime LaunchDarkly flag in a static layout would freeze it into generated output.

## Entry Points — Read These First

- `apps/web/src/components/watch/BetaTesterModalProvider.tsx`
- `apps/web/src/components/watch/BetaTesterModalProvider.test.tsx`
- `apps/web/src/app/api/beta-tester-cta/route.ts`
- `apps/web/src/lib/feature-flags.ts`
- `apps/web/CLAUDE.md`

## Grep These

- `GLOBAL_BETA_TESTER_CTA_ENDPOINT`
- `isWatchGlobalBetaTesterCtaEnabled`
- `AbortSignal.timeout`
- `global-beta-tester-cta`

## What To Build

- Preserve the after-hydration endpoint read so runtime flag changes remain compatible with static Watch route caching.
- Bound the request to two seconds with `AbortSignal.timeout(2_000)` composed with a cleanup controller aborted on unmount or route change.
- Keep the CTA fail-closed on timeout, endpoint failure, or malformed response; authored nested beta-tester links and the shared modal continue to work.
- Update focused provider tests and the Web feature-flag guidance.

## Constraints

- Do not resolve this runtime flag in a static route layout.
- Keep the endpoint same-origin, no-store, and free of LaunchDarkly client credentials.
- Preserve the existing route-key remount behavior and nested trigger behavior.

## Verification

- Test enabled, disabled, malformed/error, timeout, and route-cleanup behavior.
- Run Web typecheck, targeted ESLint, Prettier, and PR-focused checks.
- Review with Claude Code using the verified NZ Team profile.

## Completion Evidence

- Preserved the static-cache-safe same-origin no-store endpoint and bounded the client request to two seconds; route cleanup aborts the request, and late responses after abort are ignored.
- Verified with 19 focused provider tests, Web typecheck, touched-file ESLint, Prettier, and `git diff --check`.
- The full Web suite has one reproducible unrelated failure in `WatchSemanticRecommendations.lifecycle.test.tsx` (`fails open to the trusted href when tab storage is unavailable`, expected `storageGet` to be called); all other 4,743 tests passed in that run.
- `AbortSignal.timeout` is supported by the app's Next.js default browser targets (Safari 16.4+, Chrome 111+). The implementation avoids `AbortSignal.any` for compatibility.
- Reviewed with the authenticated Jesus Film Project NZ Claude Team seat; no blocking findings.
- Draft PR: https://github.com/JesusFilm/forge/pull/2673.
