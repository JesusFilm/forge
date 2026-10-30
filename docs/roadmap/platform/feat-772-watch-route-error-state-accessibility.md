---
id: "feat-772"
title: "Announce Watch route errors in one landmark with readable text"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "ui"
  - "accessibility"
---

## Problem

The 2026-10-20 overnight audit (round 08) rendered the real Watch route error
boundaries (`[locale]/[htmlLang]/error.tsx` and `[...rest]/error.tsx`) in a
real browser by throwing from a temporary local fixture. At 320x640 and
1280x800 both boundaries:

1. Nested two `<main>` landmarks (`main main`): the boundary wrapped
   `ExperienceError`, which renders its own `<main>`.
2. Did not announce the failure: no `role="alert"`, no live region, no
   heading. Focus dropped to `<body>` when the failed subtree unmounted.
3. Rendered the message in `text-red-600` (`#e7000b`) on stone-900: 3.67:1
   for 18 px normal-weight text. The inline page error (`ExperienceError` on
   the black layout) measured 4.40:1. Both are below 4.5:1.
4. Rendered "Try again" 38 px tall at desktop widths.

Retry was reachable by Tab and `reset()` recovered the subtree.

## Entry Points — Read These First

1. `apps/web/src/components/ExperienceError.tsx`
2. `apps/web/src/app/[locale]/[htmlLang]/error.tsx`
3. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/error.tsx`

## Grep These

- `<ExperienceError`
- `role="alert"`
- `text-red-400`

## What To Build

1. `ExperienceError` renders optional `children` inside its `<main>`; the
   boundaries pass the retry control as children and use a `<div>` wrapper.
2. The message is `role="alert"` and `text-red-400` (6.05:1 on stone-900,
   7.27:1 on black).
3. Retry is `min-h-11`.

## Constraints

- No copy changes; existing translations only.
- Keep Datadog RUM error reporting (`reportDatadogRumError`) unchanged.
- No new client JavaScript on successful page loads (boundaries load only
  on error).

## Verification

- `pnpm --filter @forge/web exec vitest run "src/app/[locale]/[htmlLang]/error.test.tsx" src/components/ExperienceError.test.tsx`
  — the landmark and alert tests fail against the old components.
- Real browser, temporary local fixture re-exporting each real boundary:
  one `main`, `role="alert"` with the message, message contrast ≥ 4.5:1,
  retry ≥ 44 px, retry reachable by Tab, `reset()` recovers.

## Resolution

Complete 2026-10-20 in the PR that adds this ticket. Not covered: screen
readers (the alert is announced by role only, not verified with NVDA or
VoiceOver), and the copy itself ("Failed to load experience") still uses
the internal word "experience"; changing it needs translations.
