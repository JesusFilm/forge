---
id: "feat-679"
title: "Reveal the Watch header through keyboard focus"
owner: "vladmitkovsky"
priority: "P2"
status: "complete"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "watch"
  - "accessibility"
---

## Problem

When hero player chrome hides, the Watch header becomes inert and cannot be reached or revealed through keyboard navigation.

## Scope

- Keep the header available to keyboard navigation while its hero reveal zone is active.
- Reveal player chrome when keyboard focus enters the header.
- Keep the header visually revealed through later player-chrome fades and scroll-away while keyboard focus stays inside it; let the fade resume after focus leaves.
- Re-classify keyboard versus pointer use while focus stays on one control: a key press on a click-focused control pins the header, a pointer press on a keyboard-focused control lets it fade again. Modifier-only keys do not count as keyboard use.
- Keep the header out of the accessibility tree only when it is unavailable and does not contain focus.
- Verify focus and inert behavior in `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`.

## Verification

- Run the focused FloatingSearchProvider tests, Web typecheck, and scoped lint.
- Check the diff and ensure `/watch` rendering and loading behavior are unchanged.

## Limits

Complete for the locally verified scope only (the PR is not merged or released).

- Verified: colocated jsdom tests for the pin, blur, scroll, pointer and modality-change cases (each falsified red against the broken behaviour) and headless Chromium runs on a production `next start` build, including the real header with synthetic player-chrome events for the pointer-then-keyboard case.
- Not covered: real screen readers, iOS Safari and touch, a real OS-level mouse click (Chromium input was driven through Playwright), production Core Web Vitals, and a real-data browser run of the modality follow-up.
- Pre-existing and out of scope: a pointer-focused floating search button loses focus when the chrome fades.
