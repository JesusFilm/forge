---
title: "Watch modal close buttons must remain viewport-fixed and inside the accessible dialog tree"
date: "2026-07-22"
category: ui-bugs
module: apps/web/watch
problem_type: ui_bug
component: frontend_stimulus
severity: high
symptoms:
  - "Watch modal close icons appeared at inconsistent offsets instead of the safe-area-aware top-right viewport corner"
  - "A close button portaled directly to the document body could be marked aria-hidden while Base UI isolated the active modal"
  - "Moving the fixed close button into a transformed dialog popup caused its position to resolve against the popup instead of the viewport"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - "WatchModalViewportCloseButton"
  - "DialogContent"
  - "Base UI Dialog"
tags:
  - "watch"
  - "modal"
  - "close-button"
  - "safe-area"
  - "accessibility"
  - "base-ui"
  - "focus-management"
  - "css-containing-block"
---

# Watch modal close buttons must remain viewport-fixed and inside the accessible dialog tree

## Problem

Watch modals used several close-button implementations, offsets, and mobile
visibility rules. A shared top-right control needed to remain visually fixed to
the safe-area-aware viewport corner without escaping Base UI's managed dialog
tree.

## Symptoms

- Close icons moved between modal surfaces or disappeared at mobile
  breakpoints.
- Some dialogs rendered two X icons for the same close action.
- A visually correct body-portaled close could receive `aria-hidden="true"`
  while its Base UI dialog was open.
- An in-dialog fixed close could follow a centered popup instead of the visual
  viewport.

## What Didn't Work

### Portaling only the close button to the document body

A sibling body portal preserves viewport geometry, but Base UI's modal
isolation treats it as outside the active popup. The control can be removed from
the accessibility tree and from the trapped focus sequence.

### Rendering the close inside a transformed popup

A transform on a centered popup establishes the containing block for fixed
descendants. Moving the control inside the popup fixed accessibility, but made
`top` and `right` resolve against the popup rather than the viewport.

### Allowing per-modal positioning overrides

Caller-owned position and visibility classes recreated the drift that the
shared component was intended to prevent.

## Solution

Keep the geometry in one non-overridable component and exported inset token:

```tsx
export const WATCH_MODAL_CLOSE_INSET_STYLE = {
  top: "max(1rem, env(safe-area-inset-top, 0px))",
  right: "max(1rem, env(safe-area-inset-right, 0px))",
} as const

<button
  style={WATCH_MODAL_CLOSE_INSET_STYLE}
  className="fixed z-[1100] h-[52px] w-12"
>
  <X aria-hidden />
</button>
```

Render that control inside `DialogContent`, so it belongs to the Base UI popup,
and center the popup with an untransformed full-screen `Dialog.Viewport`:

```tsx
<DialogContent
  viewportClassName="fixed inset-0 z-50 grid place-items-center"
  showCloseButton={false}
>
  <WatchModalViewportCloseButton
    open={open}
    onClose={requestClose}
    testId="watch-modal-close"
  />
  {children}
</DialogContent>
```

Custom Watch overlays render the same control inside their own positioned
modal surface. Close callbacks continue to own modal-specific cleanup; for
example, the beta tester resets iframe loading state before closing. Footer
Close text may remain, but it should not render a second X icon.

## Why This Works

The button remains under `Dialog.Popup`, so Base UI includes it in modal focus
management and does not hide it from assistive technology. The popup no longer
has a persistent centering transform, so the fixed child resolves against the
visual viewport. Central ownership of inset, size, stacking, and icon styling
prevents callers from moving or hiding the affordance.

## Prevention

- Do not reintroduce position, class, or breakpoint visibility overrides on
  the shared close component.
- Base UI Watch dialogs should place the shared close inside `DialogContent`
  and center the popup through an untransformed `Dialog.Viewport`.
- Browser checks should verify the close is inside the dialog, is not
  `aria-hidden`, measures against the visual viewport, is unique, and closes
  when clicked.
- Cover alternate states such as authentication gates, lazy-loading shells,
  error shells, and iframe reopen cycles because close callbacks may own
  cleanup beyond toggling `open`.
- Keep Watch search's persistent-header close as an explicit exception; it
  already owns the header's top-right slot and must not gain a second overlay
  icon.

## Related Issues

- [Watch search overlay stacked control breakpoints](watch-search-overlay-stacked-control-breakpoints-20260708.md)
- [Watch mobile language modal overflow](watch-mobile-language-modal-overflow-20260619.md)
- [Watch language player chrome layout](../design-patterns/watch-language-player-chrome-layout-20260609.md)
- [Base UI dialog state attribute detection](../best-practices/base-ui-dialog-state-attribute-detection-20260520.md)
- [Watch search modal mobile header rows](watch-search-modal-mobile-header-rows.md)
