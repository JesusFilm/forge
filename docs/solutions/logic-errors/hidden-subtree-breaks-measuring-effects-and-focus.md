---
title: "Collapse-by-hiding (not unmounting) silently breaks measuring effects and drops focus"
date: 2026-08-26
category: logic-errors
module: apps/admin
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "A chat/message list re-opens scrolled to its oldest message: the scroll-to-bottom effect ran while the subtree was display:none, where scrollHeight is 0, and nothing re-fires on expand"
  - "Pressing Enter on a collapse toggle drops focus to <body>, so the next Tab restarts at the top of the document instead of continuing from the panel"
  - "A jsdom suite cannot reproduce either symptom: it has no layout at all (every scrollHeight is 0, expanded or not) and raw .click() ignores visibility"
root_cause: logic_error
resolution_type: code_fix
severity: medium
related_components:
  - testing_framework
tags:
  [
    react,
    useeffect,
    display-none,
    hidden-attribute,
    scrollheight,
    focus-management,
    accessibility,
    collapsible-panel,
    jsdom,
  ]
---

# Collapse-by-hiding (not unmounting) silently breaks measuring effects and drops focus

## Problem

Making a stateful panel collapsible has an obvious right answer for state:
**hide the body, don't unmount it.** Unmounting discards an in-flight stream, an
unsent draft, and any fetch-once-on-mount data, and re-expanding refetches. So
you reach for `hidden` (plus a `hidden` class, since a `display:flex` utility
would otherwise beat the `[hidden]` UA rule) and keep the subtree mounted.

That decision is correct and it quietly breaks two things that unmounting would
not have:

1. **Every effect that MEASURES.** A `display:none` subtree has no layout:
   `scrollHeight`, `clientHeight`, and `getBoundingClientRect()` are all zero.
   An effect keyed on data (`[messages, stream]`) that runs while collapsed
   computes against zeros — `el.scrollTop = el.scrollHeight` is a no-op — and
   nothing re-fires when the subtree becomes visible again, because visibility
   is not in its dependency list. Symptom: content that arrived while collapsed
   is off-screen on re-expand, scrolled to the top.

2. **Focus.** Each toggle lives inside the region it hides — the collapse button
   is in the panel header, the expand affordance IS the collapsed rail. Hiding
   the subtree that contains `document.activeElement` drops focus to `<body>`,
   so the next Tab restarts at the top of the document. Keyboard users lose
   their place on every toggle in both directions.

Worked instance: feat-425, the admin experience-editor AI chat rail
(`apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`),
collapsed by default. Both defects were found in review, not by the suite.

## Fix

**Visibility is a dependency of every measuring effect, and a guard.**

```tsx
// Auto-scroll to bottom when messages change. `collapsed` is a dependency
// because a hidden list has `scrollHeight === 0` — messages that arrived
// while the rail was shut would otherwise re-open scrolled to the top.
useEffect(() => {
  if (collapsed) return
  const el = messageListRef.current
  if (el) el.scrollTop = el.scrollHeight
}, [collapsed, messages, stream])
```

The `if (collapsed) return` guard and the dependency are both load-bearing: the
guard keeps the useless zero-measurement from running, the dependency is what
re-runs it on expand. Apply to every effect in the subtree that measures or
scrolls — in feat-425 that was the message-list scroll AND a staged-draft
`scrollIntoView`.

**Focus hand-off, armed only by a real toggle.**

```tsx
const focusAfterToggleRef = useRef(false)

const toggleCollapsed = useCallback((next: boolean) => {
  focusAfterToggleRef.current = true
  setCollapsed(next)
}, [])

useEffect(() => {
  if (!focusAfterToggleRef.current) return
  focusAfterToggleRef.current = false
  const target = collapsed ? expandButtonRef.current : collapseButtonRef.current
  target?.focus()
}, [collapsed])
```

The latch matters: a bare `useEffect(..., [collapsed])` that focuses would steal
focus from wherever the user was on first paint. Arming it inside the toggle
handler means only a user-driven collapse moves focus. It is also
StrictMode-safe by construction — the latch is false during the mount
`setup → cleanup → setup` cycle, and no cleanup mutates it (cf.
`react-strictmode-remount-safety-hook-lifetime-refs.md`).

Pair both with `aria-expanded` + `aria-controls` pointing at the body's `useId`,
so the two toggles and the region are one control in the a11y tree. The `hidden`
attribute already removes the collapsed body from the a11y tree and the tab
order — that part is free.

## Why the tests did not catch it

This is a mocked-shape-vs-real-contract instance (see
`docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`)
with an unusually sharp edge: **jsdom cannot fail either way.**

- jsdom implements no layout, so `scrollHeight` is `0` whether the subtree is
  visible or hidden. The production distinction the bug turns on does not exist
  in the substrate.
- jsdom's raw `element.click()` and native-setter value writes ignore
  visibility, so a whole behavioural suite keeps passing against a
  `display:none` subtree. In feat-425 all 22 pre-existing panel tests went green
  against a hidden panel after the default flipped to collapsed — the suite
  stopped asserting anything about a surface a user could reach and did not say
  so.

So the discipline is three-part:

1. **Pin the visibility axis in the suite.** Every pre-existing behavioural test
   renders with the visible state explicitly (`defaultCollapsed={false}`), so
   those assertions keep describing a reachable surface. Only the tests ABOUT
   the default may rely on the default.
2. **Test the measuring effect with a stand-in for layout**, and say so in place:
   `Object.defineProperty(list, "scrollHeight", { value: 640 })`, expand, assert
   `scrollTop === 640`. It guards the dependency list; it does not prove the
   browser mechanism.
3. **Prove the mechanism in a real browser**, at its own layer. A Playwright
   pass over a throwaway local harness route measured `scrollHeight === 0` while
   hidden and `scrollTop` pinned to the bottom after expand, and walked the
   keyboard path (Tab → rail, Enter → focus on collapse, Enter → focus back on
   the rail). That is the only evidence that speaks to the actual claim.

## Sizing note

The collapsed rail width should be re-measured, not assumed. Admin's root font
size is 13px, so Tailwind 4's `w-11` (`2.75rem`) is ~36px, not the 44px the
default 16px root would give. Check the icon badge still has clearance inside
whatever the token math actually produces.
