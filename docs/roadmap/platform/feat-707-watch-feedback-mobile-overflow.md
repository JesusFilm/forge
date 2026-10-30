---
id: "feat-707"
title: "Keep Watch feedback within the mobile dialog width"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-15"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch-page"
  - "feedback"
  - "responsive"
---

## Problem

[FGE-291](https://linear.app/jesus-film-project/issue/FGE-291) records the
native Watch feedback wizard expanding beyond its dialog on a 390×844 viewport.
Step 4 clips its heading and Skip control in English and Spanish. Completed
feat-399 and feat-411 establish responsive feedback and unclipped suggestions;
this follow-up repairs layout without changing those contracts.

## Entry Points — Read These First

1. `apps/web/src/components/FeedbackModal.tsx` — the form grid item, step 4
   truncated context/element rows, and footer sizing.
2. `apps/web/src/components/ui/dialog.tsx` — the shared grid popup and scrolling
   viewport; keep shared dialog behavior unchanged.
3. `apps/web/src/components/FeedbackLauncher.test.tsx` — existing form flow,
   dropdown, keyboard, cancellation, draft, and lazy-loading coverage.
4. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
   — match performance evidence to this lazy surface.

## Grep These

- `feedback-step-4`
- `feedback-page-context`
- `feedback-select-element`
- `overflow-visible`
- `min-w-0`
- `loadFeedbackModal`

## What To Build

1. Reproduce browser grid sizing with the current component and characterize
   how nowrap descendants affect the form's automatic minimum width.
2. Apply the smallest local CSS sizing correction that keeps the heading,
   context, Back, and Skip/Continue within the supported mobile dialog width.
3. Verify English and translated Spanish at 390×844 and desktop, preserving
   accessible focus, open suggestions, element selection, and vertical scrolling.

## Constraints

- Keep this repair separate from Spanish catalog PR #2749.
- Preserve full-screen overlay, visible dropdown overflow, draft/cancel/close,
  lazy imports, diagnostics/privacy, selected-element values, and submission.
- Do not conceal controls with additional overflow clipping.
- Do not submit real feedback, fill name/email, or add production credentials
  to a local fixture. Real Next/private-preview acceptance is caller-owned.
- This scope does not revive canceled QA-610's 320px hero/launcher work.

## Verification

- Browser reproduction before/after with actual component styles: compare
  dialog, form, heading, and footer bounds in English/Spanish at 390×844.
- Run existing `FeedbackLauncher.test.tsx`, web typecheck, scoped ESLint,
  Prettier on touched files, and normal commit hooks.
- Verify the deferred component import and initial-load dependency boundary
  are unchanged; report measured local payload changes with their limits.
- Caller verifies the actual Next/private preview and current production
  baseline before claiming production resolution or full shipping readiness.

## Local Result

The form grid item now has `min-w-0`. Actual-component Chrome checks keep the
form and controls within the 366px dialog at 390×844 in English and translated
Spanish, and within the 800px dialog at 1440×1000 in English. Fresh Spanish Skip
and English dropdown/Back/Skip flows pass. The unchanged FeedbackLauncher suite
passes all 65 cases; web typecheck, scoped ESLint and formatting pass.

The fixture JavaScript grows by 8 bytes (1 gzip byte); its 1,896 dependency inputs
and 105,758 CSS bytes are unchanged. The launcher and deferred import are
unchanged. This is component evidence; actual Next/private-preview acceptance
and deployed resource checks remain caller-owned.
