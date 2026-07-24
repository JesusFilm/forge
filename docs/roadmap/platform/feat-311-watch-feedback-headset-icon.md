---
id: "feat-311"
title: "Watch feedback headset icon"
owner: "unassigned"
priority: "P2"
status: "complete"
start_date: "2026-07-24"
duration: 1
depends_on:
  - "feat-250"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
---

## Problem

The floating Watch feedback launcher uses a warning-triangle icon, which
suggests an error or hazard instead of help and support.

## Entry Points - Read These First

1. `apps/web/src/components/FeedbackLauncher.tsx` - the global floating feedback
   control.
2. `apps/web/src/components/FeedbackLauncher.test.tsx` - focused launcher
   presentation and behavior coverage.

## Grep These

- `TriangleAlert`
- `feedback-launcher`
- `lucide-triangle-alert`

## What To Build

1. Replace the warning triangle with a support headset and microphone icon.
2. Preserve the launcher dimensions, label reveal, accessible name, loading
   state, modal behavior, and search coordination.
3. Update focused regression coverage for the new icon.

## Constraints

- Use the existing `lucide-react` dependency.
- Keep the icon decorative because the launcher button already has a localized
  accessible name.
- Do not change the feedback modal or form destination.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/FeedbackLauncher.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Browser smoke confirms the headset-with-mic glyph remains centered at rest.

## Completion Notes

- Replaced Lucide's `TriangleAlert` glyph with the existing `Headset` glyph,
  which includes headphones and a boom microphone.
- Preserved the decorative `aria-hidden` treatment, 20px icon size, launcher
  dimensions, localized accessible name, hover/focus label, and modal behavior.
- Updated focused coverage to require the headset class and reject the former
  warning-triangle class.
- Eight focused tests, Web typecheck, targeted ESLint, Prettier, and `git diff
--check` passed.
- Browser verification against the snapshot-backed local Watch stack confirmed
  the launcher renders Lucide's headset-with-mic glyph and preserves the
  existing launcher geometry.
- Page-loading performance is unaffected: this swaps two tree-shaken glyph
  exports from the existing icon package without changing client initialization
  or network behavior.
