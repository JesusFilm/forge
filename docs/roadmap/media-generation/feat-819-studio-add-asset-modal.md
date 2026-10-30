---
id: "feat-819"
title: "Replace Studio content rail with an Add asset modal"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-10-19"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

Replace the four-icon rail in `apps/manager/src/features/video-studio/library.tsx`
with a searchable native dialog opened from the canvas toolbar in `editor.tsx`.
Keep footage capture, image/audio upload, text, packs and custom components.
Use labeled categories, inline source selection, loading/error states and native
focus trapping/Escape handling. Close after inserting and select the new item.
Update workspace columns in `studio.css` at every breakpoint.

## Constraints

Keep existing Studio contracts and insertion semantics. Use existing palette.
Load the picker only on demand and defer library requests until it opens.
Do not intercept editor playback or undo shortcuts while the modal is open.

## Verification

Scoped ESLint/Prettier, type checking and browser smoke for search, categories,
insertion, dismissal and focus restoration. Inspect the lazy import and request
behavior to verify no extra page-loading work.

## Verification Evidence

Scoped ESLint, Prettier, TypeScript and diff whitespace checks pass. Existing
`editor-session.test.ts` passes (8 tests). TypeScript initially encountered three
obsolete generated `.next/dev/types` route files from before updating main;
preserved those files under `/tmp/forge-stale-next-job-types` and reran successfully.

An internal browser harness rendering the actual Library component verified
native modal focus, labeled categories, source selection/back navigation,
search loading/empty/error states, text insertion and dismissal, Escape, and
restoring focus to Add content. Harness requests used disposable fixtures; no
project mutations were sent to the live backend during verification.
The real remote Next development server compiled these changes successfully.

Performance: the editor now dynamically imports Library only while open and
mounts no library search effect on page entry (previously one automatic search).
The browser harness confirmed no library requests before opening. No dependency,
media, player or routing changes; the former rail column is removed at all
three workspace breakpoints. Native dialog supplies focus trapping without a
new dependency. Keep all future picker requests scoped to the mounted dialog.
