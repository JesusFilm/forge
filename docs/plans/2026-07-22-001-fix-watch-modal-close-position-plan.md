---
title: "Fix Watch modal close position"
type: "fix"
status: "complete"
date: "2026-07-22"
execution: "code"
---

# Fix Watch modal close position

## Summary and Problem Frame

Make the close icon a consistent top-right affordance across Watch modal
surfaces. The shared close control exists, but callers can override or hide
its placement and several global dialogs still implement independent close
buttons.

## Requirements

- R1. Every Watch modal state exposes one visible close icon at the modal's
  safe-area-aware top-right corner on mobile and desktop. Full-screen modals
  therefore align to the viewport corner.
- R2. Callers cannot override or hide the shared close position through styling
  props.
- R3. Converted dialogs preserve their existing close callbacks, focus return,
  Escape behavior, overlay dismissal, and iframe lifecycle.
- R4. Search keeps its one persistent-header close icon at the top right; no
  second overlay close is introduced.
- R5. Focused tests and browser proof cover the shared rule and representative
  modal surfaces at mobile width.

## Key Technical Decisions

- KTD1. `WatchModalViewportCloseButton` owns an exported, safe-area-aware inset
  style and a z-index above all Watch overlays. Central ownership makes the
  position a design-system contract rather than a copied class string.
- KTD2. Remove caller-controlled position and class overrides. Modal-specific
  visual exceptions may change content spacing but cannot move or hide the
  close affordance.
- KTD3. Keep search on its existing persistent-header geometry. Search swaps
  the account slot for a close icon, so adding another close would duplicate
  the action and break closed/open header alignment.

## Scope Boundaries

- Do not remove footer Close actions; this work standardizes the icon
  affordance only.
- Do not alter dialog sizing, content hierarchy, iframe sandboxing, or Watch
  playback coordination.
- Do not change the generic `apps/web/src/components/ui/dialog.tsx` primitive;
  the rule is Watch-specific.

## Implementation Units

### U1. Encode the Watch close-position contract

- **Goal:** Make the shared control the non-overridable source of top-right
  placement, safe-area behavior, size, and overlay priority.
- **Files:** `apps/web/src/components/watch/WatchModalViewportCloseButton.tsx`,
  `apps/web/src/components/watch/WatchModalViewportCloseButton.test.tsx`.
- **Patterns to follow:** Existing safe-area CSS in Watch full-screen surfaces
  and Base UI's requirement that interactive controls remain in the dialog.
- **Test scenarios:** Closed state renders nothing; open state renders one
  accessible button inside its modal surface; the button uses the shared inset style and top overlay
  layer; clicking it invokes the close callback; an optional ref receives the
  button for initial-focus behavior.
- **Verification:** Focused Vitest file.

### U2. Adopt the rule across Watch dialogs

- **Goal:** Replace local close icons and remove mobile hiding without changing
  modal lifecycle behavior.
- **Files:** `apps/web/src/components/watch/DownloadModal.tsx`,
  `apps/web/src/components/FeedbackModal.tsx`,
  `apps/web/src/components/FeedbackLauncher.tsx`,
  `apps/web/src/components/watch/BetaTesterModal.tsx`,
  `apps/web/src/components/watch/BetaTesterModalProvider.tsx`,
  `apps/web/src/components/watch/GlobalLanguagePickerModal.tsx`,
  `apps/web/src/components/sections/QuizButton.tsx`, and their existing tests.
- **Patterns to follow:** Share, language, collection-download, and question
  surfaces already using `WatchModalViewportCloseButton`.
- **Test scenarios:** Download exposes its icon on mobile; feedback and beta
  loading/full states each expose exactly one icon; beta initial focus still
  lands on close; global language and quiz close through their original state
  owners; converted headers reserve enough top-right space for the shared
  control.
- **Verification:** Focused modal and provider Vitest files.

### U3. Verify the complete Watch modal inventory

- **Goal:** Confirm every Watch modal has one top-right icon and no duplicate
  close control after conversion.
- **Files:** Existing Watch modal tests and browser proof output only.
- **Patterns to follow:** `docs/solutions/best-practices/base-ui-dialog-state-attribute-detection-20260520.md` for open/closed state checks.
- **Test scenarios:** Open representative download, language, feedback, beta,
  global-language, quiz, search, question, share, and collection-download
  states; verify the close icon is visible, top-right, clickable, and unique.
- **Verification:** Web typecheck, lint, focused tests, and a mobile screenshot.

## Risks and Dependencies

- Each control stays inside its modal stacking and accessibility context; the
  shared local z-index must cover modal content without escaping that context.
- Fullscreen language playback renders the close inside the same fullscreen
  dialog subtree so the browser and assistive technology both retain it.
- Beta signup uses close as its initial focus target, so the shared component
  needs ref support before the local button is removed.
