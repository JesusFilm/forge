---
id: "feat-250"
title: "Web global feedback modal"
owner: "urim"
priority: "P2"
status: "in-progress"
start_date: "2026-07-13"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "infrastructure"
---

## Problem

People using the public Forge web experience do not have a persistent way to
submit product feedback from the page they are viewing. A public Google Form
already owns feedback collection, but Forge has no global entry point or
embedded presentation for it.

## Entry Points — Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` — localized root layout
   covering public Watch routes.
2. `apps/web/src/app/(demo)/layout.tsx` — independent demo root layout.
3. `apps/web/src/components/FloatingSearchProvider.tsx` — global chrome and
   `searchOpen` ownership used to suppress competing overlays.
4. `apps/web/src/components/ui/dialog.tsx` — shared Base UI dialog portal and
   lifecycle primitives.
5. `apps/web/src/components/sections/QuizButton.tsx` — existing hardened
   external iframe dialog precedent.
6. `docs/plans/2026-07-13-005-feat-global-feedback-modal-plan.md` — reviewed
   requirements, decisions, edge cases, and verification contract.

## Grep These

- `FloatingSearchProvider`
- `useFloatingSearchPinned`
- `DialogContent`
- `sandbox="allow-forms allow-scripts allow-same-origin"`
- `WatchQuestionPanel`
- `z-[57]`

## What To Build

1. Add a lightweight right-edge `FeedbackLauncher` to both web root layouts
   inside `FloatingSearchProvider`.
2. Dynamically load `FeedbackModal` only after first user intent and keep an
   immediate accessible loading state in the launcher.
3. Embed the public Beta Feedback form at
   `https://docs.google.com/forms/d/e/1FAIpQLScNeD3kPs7bqhV2i_QA6IMRCrs9W638TJuApb6QA4_ezQAEPA/viewform?embedded=true`
   only while the modal is open.
4. Use the shared Base UI dialog with a visible title and close control,
   focus containment/restoration, responsive sizing, a no-referrer policy,
   the proven form/script/same-origin sandbox capabilities, and a public
   new-tab fallback link.
5. Keep feedback and search ownership mutually exclusive. Search-open state
   removes the feedback portal and iframe, suppresses the launcher through the
   search close animation, and does not return focus to the hidden trigger.
6. Render the feedback backdrop and content above the Watch question panel's
   `z-[57]` layer while keeping the trigger clear of bottom chrome and right
   safe-area insets.

## Constraints

- Keep both root layouts as Server Components.
- Do not add Google preconnect, DNS-prefetch, preload, or eager iframe work.
- Do not add a first-party feedback API, persistence, analytics, or admin UI.
- Do not change the Google Form, its responder permissions, or destination.
- Do not submit synthetic feedback during validation.
- Do not add one untranslated key to all 225 message catalogs while the form
  itself remains English-only.

## Verification

- Focused Vitest coverage for intent-only mounting, the exact iframe contract,
  loading state, close paths, focus behavior, fallback link, and search mutual
  exclusion.
- Web lint, typecheck, format check, and production build.
- Desktop and mobile browser smoke on both localized and demo route families,
  with screenshots.
- Resource timing proves neither the `FeedbackModal` JavaScript chunk nor a
  Google Forms request occurs before activation, and both appear only after
  activation.
- Browser smoke confirms the real public form renders inside the sandbox,
  feedback overlays the Watch question panel, and close/reopen remains stable.
