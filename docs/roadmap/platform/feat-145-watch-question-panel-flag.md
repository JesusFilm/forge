---
id: "feat-145"
title: "Watch Question Panel LaunchDarkly Gate"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-05-28"
duration: 1
depends_on:
  - "feat-144"
blocks: []
tags:
  - platform
  - web
  - watch-page
  - feature-flags
---

## Problem

The watch page needs a floating question/chat panel prototype, but the
surface should stay disabled by default until the team intentionally rolls it
out.

## Entry Points -- Read These First

1. `packages/feature-flags/src/registry.ts` -- shared LaunchDarkly flag keys.
2. `apps/web/src/lib/feature-flags.ts` -- web server-side feature flag helpers.
3. `apps/web/src/app/[slug]/[...rest]/page.tsx` -- watch route server
   evaluation and prop passing.
4. `apps/web/src/components/watch/WatchPageClient.tsx` -- client watch surface.
5. `apps/web/src/components/watch/WatchQuestionPanel.tsx` -- gated floating
   panel UI.

## What To Build

1. Add a default-off LaunchDarkly boolean flag:
   `forge.watch.questionPanel`.
2. Add the local fallback env var:
   `FORGE_WATCH_QUESTION_PANEL_DEFAULT=false`.
3. Evaluate the flag server-side on watch routes and pass a plain boolean into
   the watch client.
4. Render the floating panel only when the flag is enabled.

## Constraints

- Keep the default/off behavior identical to the current watch page.
- Do not expose LaunchDarkly SDK keys or use a client-side LaunchDarkly SDK.
- Keep the panel dummy/non-submitting beyond local input clearing.

## Verification

- `pnpm --filter @forge/web test -- 'src/app/[slug]/[...rest]/__tests__/page-routing.test.tsx' src/lib/feature-flags.test.ts`
- `pnpm --filter @forge/feature-flags test`
- Local smoke: no `LAUNCHDARKLY_SDK_KEY` and
  `FORGE_WATCH_QUESTION_PANEL_DEFAULT=false` hides the panel.
