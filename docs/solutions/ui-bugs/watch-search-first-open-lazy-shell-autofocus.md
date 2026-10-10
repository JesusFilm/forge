---
title: "Watch search first-open lazy shell autofocus"
date: "2026-07-16"
category: ui-bugs
module: apps/web
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "The first click on the floating Watch search field opened the modal without focusing the keyword input"
  - "Closing and reopening search focused the input correctly"
  - "The failure appeared only while the lazy search controller was loading on a cold page"
root_cause: async_timing
resolution_type: code_fix
severity: high
related_components:
  - "FloatingSearchProvider"
  - "SearchOverlayInstantShell"
  - "SearchOverlay"
tags:
  - "watch"
  - "search"
  - "autofocus"
  - "lazy-loading"
  - "react"
  - "accessibility"
  - "async-timing"
---

# Watch search first-open lazy shell autofocus

## Problem

Watch search rendered two different input owners during the first interaction.
The lightweight instant shell handled the first click while the full controller
loaded, but only the full overlay had robust focus management. As a result, the
first open could leave keyboard focus on the trigger while repeat opens worked.

## Symptoms

- A cold page's first search click opened the modal without making the keyword
  input active.
- Closing the modal and clicking search again focused the input.
- Tests that flushed the lazy controller before checking focus passed because
  they exercised the full overlay rather than the first-open shell.

## What Didn't Work

- A single delayed `setTimeout(..., 50)` in the instant shell was not an
  autofocus guarantee. The shell could mount, animate, and hand off to the lazy
  controller on different timing paths before or after that callback.
- Testing only the fully loaded overlay hid the regression. The repeat path was
  healthy and did not prove that the short-lived first-open owner focused.

## Solution

Give every component that can own the visible search input the same bounded
focus lifecycle:

```tsx
useLayoutEffect(() => {
  if (!open) return

  let cancelled = false
  const focusInput = () => {
    if (!cancelled) inputRef.current?.focus({ preventScroll: true })
  }

  focusInput()
  const frame = requestAnimationFrame(focusInput)
  const timer = window.setTimeout(focusInput, 100)

  return () => {
    cancelled = true
    cancelAnimationFrame(frame)
    clearTimeout(timer)
  }
}, [open, inputRef])
```

The shared hook is used by both the instant shell and full overlay. The shell's
input also keeps native `autoFocus` for the browser's earliest mount-time focus
opportunity. Cleanup cancels the retry work when the shell is replaced, so a
detached owner cannot steal focus from the full overlay.

Regression coverage renders the instant shell directly and asserts
`document.activeElement` in the mount turn. The existing provider tests continue
to cover controller handoff, close/reset, and repeat-open focus. Browser proof
must start from a cold reload and check the active element after the first click,
not only after the controller has warmed.

## Why This Works

The bug was an ownership mismatch, not a problem with the full modal. The first
visible input belonged to a short-lived component with weaker timing semantics.
Making focus behavior a contract of every visible input owner closes that gap.
The immediate layout attempt handles the common path, bounded retries cover
layout and animation timing, and cleanup makes the retries safe across lazy DOM
replacement.

## Prevention

- When a lazy feature renders a lightweight interactive shell, test that shell
  as a real state owner rather than treating it as visual-only scaffolding.
- For first-interaction bugs, keep one cold-load browser assertion; a warmed
  module cache can make repeat behavior look representative when it is not.
- Any focus retry scheduled across component replacement must be bounded,
  cleaned up, and use `preventScroll` when page position is part of the UX.

## Related Issues

- [`../performance-issues/watch-staged-client-loading-20260611.md`](../performance-issues/watch-staged-client-loading-20260611.md)
  explains why the lightweight search shell and lazy controller boundary must
  remain intact.
- [`../best-practices/nextjs-search-overlay-ui-patterns-20260415.md`](../best-practices/nextjs-search-overlay-ui-patterns-20260415.md)
  documents the surrounding Next.js overlay, portal, and async-lifecycle
  patterns.
