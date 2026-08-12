---
id: "feat-357"
title: "Submit Watch search suggestions immediately"
owner: "urim"
priority: "P1"
status: "complete"
completed_date: "2026-08-12"
start_date: "2026-08-12"
duration: 1
depends_on:
  - "feat-337"
blocks:
  - "feat-358"
tags:
  - "watch"
  - "search"
  - "autocomplete"
  - "web"
---

## Problem

Query suggestions look actionable but only replace the search draft, requiring a second Enter or Search action. Pointer and touch selection therefore feels incomplete.

## What To Build

1. Treat deliberate activation of a query suggestion as an immediate full-search submission.
2. Use the same guarded submission path as Enter and the Search button.
3. Preserve draft-only typing, IME behavior, touch-scroll cancellation, duplicate-submit protection, and direct content navigation.

## Verification

- Keyboard, mouse, and stationary touch selection each submit exactly once with the selected phrase.
- A touch scroll does not select or submit a suggestion.
- Direct content matches still navigate without running a search.

## Completion Evidence

- The 109-test Watch search interaction suite passed, including keyboard, mouse, stationary touch, touch-scroll cancellation, and direct-match routing.
- Web typecheck passed.
- Local browser verification selected `Football`, stayed on `/watch`, closed suggestions, and immediately rendered matching collection and video results without console errors.
