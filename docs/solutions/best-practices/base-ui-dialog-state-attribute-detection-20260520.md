---
title: "base-ui Dialog open/close state: inspect data-open / data-closed, not element presence"
date: 2026-05-20
problem_type: best_practice
module: apps/web
component: testing_framework
severity: medium
tags:
  - base-ui
  - dialog
  - chrome-mcp
  - browser-testing
  - ui-verification
  - animation
  - data-attributes
applies_when:
  - "Writing Chrome MCP smoke tests that assert a Dialog is open or closed"
  - "Probing any base-ui Dialog, Popover, or Tooltip that uses CSS transition animations"
  - "Diagnosing a Cancel/close action that appears broken because querySelector still returns the element"
---

## Context

During Chrome MCP smoke testing of the new Terms-of-Use nested Dialog in `apps/web/src/components/watch/DownloadModal.tsx`, dialog close verification relied on `!!document.querySelector(...)` — checking whether the element existed in the DOM. After clicking Cancel, the probe returned truthy and we briefly concluded Cancel was broken.

base-ui Dialog keeps its Popup mounted during the close animation (controlled by the `duration-100` Tailwind class in `apps/web/src/components/ui/dialog.tsx`), only unmounting after the transition completes. Element presence does not distinguish "open" from "closing."

Past sessions hit related symptoms but never crossed this specific gap. Prior Chrome MCP verification across `feat/web-admin-rendering-unit-5b`, `feat/web-admin-data-layer-flip`, and PR #938 review (session history) defaulted to presence-of-element probing or component-data inspection; none read base-ui's lifecycle attributes. The same review run explicitly flagged "Globe button + language modal state are entirely untested" as a deferred gap — this learning is one piece of closing that gap.

---

## Guidance

When verifying base-ui Dialog open/close state in any browser-driven test or smoke run, inspect `data-open` / `data-closed` attributes on the Popup element — not element presence.

base-ui sets these attributes on the Popup throughout its lifecycle:

| Attribute             | Meaning                                                 |
| --------------------- | ------------------------------------------------------- |
| `data-open` present   | Dialog is open                                          |
| `data-closed` present | Dialog is in the close animation (will unmount shortly) |
| Element absent        | Fully unmounted                                         |

Immediately after a close gesture (Cancel, X, Accept-then-close), a correctly functioning dialog is in the `data-closed` state, not absent. Probing presence at that instant yields a false "still open" reading.

---

## Why This Matters

**False negatives.** Presence probing right after a close click returns `true` during the animation window. The smoke test reads the dialog as still open and flags the close path as broken — even when it is working correctly. This happened: we briefly concluded Cancel was broken in the Terms-of-Use dialog before switching probe strategy.

**Animation-racing flakiness.** The animation window is short (`duration-100` ≈ 100ms), so results are timing-dependent. Sometimes the probe fires after unmount and passes; sometimes it races the animation and fails. Attribute inspection is stable throughout — `data-closed` is the intended state right after close.

**Wasted investigation cost.** The conversation arc from "Cancel appears broken" to root-cause and resolution took meaningful time. Attribute inspection eliminates this class of false alarm entirely.

**Closes a previously-deferred review gap.** PR #938's ce-code-review flagged language-modal state coverage as deferred (session history). The technique below is the cheap fix.

---

## When to Apply

- Any browser-driven smoke test (Chrome MCP, Playwright, `mcp__chrome-devtools__evaluate_script`) that asserts a base-ui Dialog has opened or closed.
- Especially relevant to `apps/web` watch-page modals: `DownloadModal`, `LanguagePickerModal`, `ShareModal`, and any component wrapping `src/components/ui/dialog.tsx`.
- Applies to nested Dialogs (a Dialog inside a Dialog) where close state of the inner dialog must be confirmed without affecting the outer dialog's presence reading.

---

## Examples

**Before — naive presence probe (incorrect):**

```js
// Returns true even during the close animation. Will falsely flag a working close path.
const isOpen = !!document.querySelector(
  '[data-testid="watch-download-modal-terms-dialog"]',
)
```

**After — attribute-inspecting helper (correct):**

```js
const dlgState = () => {
  const d = document.querySelector(
    '[data-testid="watch-download-modal-terms-dialog"]',
  )
  if (!d) return "absent"
  return d.hasAttribute("data-open")
    ? "open"
    : d.hasAttribute("data-closed")
      ? "closed (animating)"
      : "unknown"
}

// Correct post-close assertion: dialog should be 'closed (animating)' or 'absent'.
const state = dlgState()
const closedCorrectly = state === "closed (animating)" || state === "absent"
```

Call `dlgState()` immediately after triggering close. If timing allows a brief wait (e.g., 150ms), `absent` is the expected final state. Either `closed (animating)` or `absent` confirms a successful close — both are correct depending on when the probe fires relative to the animation.

**Adjacent gotcha — JS-simulated clicks on base-ui Buttons can fail silently under Chrome MCP** _(session history)_. If your `.click()` from `javascript_tool` doesn't trigger the expected close, that's a separate failure mode — verify the click landed by inspecting playback state or a button's `aria-pressed`/`data-state` before blaming `data-open` semantics.
