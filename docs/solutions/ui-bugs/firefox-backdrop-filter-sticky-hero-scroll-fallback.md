---
title: "Firefox drops backdrop-filter while the Watch body scrolls over a sticky hero"
date: "2026-07-13"
last_updated: "2026-07-14"
category: ui-bugs
module: apps/web
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Firefox reports backdrop-filter: blur(40px) in computed style while painting an effectively unblurred Watch body backdrop"
  - "The sharp moving hero becomes visible through the translucent body sheet while the page scrolls"
root_cause: config_error
resolution_type: code_fix
severity: medium
related_components:
  - "apps/web/src/components/watch/WatchSectionRenderer.tsx"
  - "apps/web/src/app/globals.css"
  - "apps/web/src/components/watch/__tests__/WatchSectionRenderer.test.tsx"
tags:
  - "firefox"
  - "webrender"
  - "backdrop-filter"
  - "watch-page"
  - "sticky-video"
  - "scrolling"
  - "css-fallback"
  - "playwright"
---

# Firefox drops backdrop-filter while the Watch body scrolls over a sticky hero

## Problem

The Watch detail page uses a long, translucent body sheet with a 40px backdrop
blur. As it scrolls over the sticky hero, Firefox can stop sampling the hero for
the filter even though CSSOM continues to report `backdrop-filter: blur(40px)`.
That exposes a sharp moving video behind long-form body text and creates a
browser-specific contrast regression.

The exact internal WebRender failure has not been proven with a reduced Forge
testcase or profiler capture. What is verified is the mismatch between the
declared/computed filter and Firefox's rendered pixels. Mozilla's reports below
show closely related correctness failures, not proof that every report shares
the same internal cause as this Watch page.

## Symptoms

- Firefox's computed style remains `blur(40px)` before and after scrolling, so
  DOM/style inspection alone looks healthy.
- Screenshots with the filter enabled and explicitly changed to `none` are
  effectively identical. In the reproduced 1440x700 crop, the mean per-channel
  delta was less than `0.44 / 255`, with a maximum delta of `3 / 255`.
- Chromium paints the expected blur for the same DOM and scroll position.

## What Didn't Work

- Changing the body sheet from `overflow: hidden` to `overflow: visible` did not
  restore the blur. The Firefox blur-vs-none pixel delta was unchanged, so the
  desktop overflow clip was not the causal boundary.
- Adding `will-change: backdrop-filter` did not stabilize the compositor layer.
  With that hint, enabled and disabled screenshots were pixel-identical. Avoid
  shipping promotion hints unless a real browser A/B proves they help.
- Trusting `getComputedStyle()` would have produced a false green result because
  the browser kept the declared property while dropping its rendered effect.
- Restructuring the sticky hero and measured body-zone layout was intentionally
  avoided. Prior Watch work treats that geometry and the portaled player chrome
  as verified behavior, so this fix stays visual and composition-local (session
  history).

## Solution

Keep the glass treatment for browsers that paint it reliably, and give the
specific Watch body sheet a Firefox-only near-opaque fallback:

```css
.watch-body-backdrop {
  background-color: rgb(var(--color-section-default) / 0.35);
}

/* Firefox can retain blur(40px) in computed style while failing to paint it
   as this sheet scrolls over the sticky hero. */
@supports (-moz-appearance: none) {
  .watch-body-backdrop {
    background-color: rgb(24 24 24 / 0.94);
    backdrop-filter: none;
  }
}
```

The component retains `backdrop-blur-2xl` for the normal path and exposes the
dedicated `watch-body-backdrop` hook. The fallback is scoped to this one
sticky-video composition; dialogs, controls, and unrelated backdrop filters are
unchanged.

Browser proof at scroll position `900` showed:

- Firefox: `CSS.supports("(-moz-appearance: none)") === true`,
  `backdrop-filter: none`, neutral charcoal background `rgb(24 24 24)` at
  alpha `0.94`.
- Chrome: the support check is false, `backdrop-filter: blur(40px)`, background
  alpha `0.35`.

## Why This Works

Mozilla tracks multiple WebRender correctness issues involving backdrop
filters, scrolling, sticky elements, overflow boundaries, and complex changing
content. The Watch reproduction is consistent with that class of compositor
failure, but the specific picture-cache or sampling mechanism remains an
inference rather than a confirmed diagnosis for this page.

The fallback does not attempt to repair Firefox's compositor. It removes the
unreliable filter from that rendering path and raises the background opacity so
the visual result cannot switch from blurred to sharp while scrolling. Because
the rule is CSS-only, it adds no client state, hydration work, request, or
user-agent parsing.

## Prevention

- For browser-specific filter bugs, verify rendered pixels in the affected
  engine. Computed style proves declaration/cascade state, not compositor
  output.
- Test one compositor hypothesis at a time and compare against an explicit
  `backdrop-filter: none` control before keeping `overflow`, `transform`,
  `contain`, or `will-change` workarounds.
- Scope degraded treatments to the failing composition instead of disabling
  backdrop filters across Firefox.
- Verify the non-target browser after adding an engine-specific CSS feature
  query; the Chrome proof must still report the original blur and opacity.
- Keep a stable component hook under unit test, then use real Firefox scroll
  screenshots for the rendering contract that jsdom cannot observe.

## Related Issues

- [Mozilla Bug 1888025: `[meta] [project] Fix correctness issues with backdrop-filter`](https://bugzilla.mozilla.org/show_bug.cgi?id=1888025)
  is Mozilla's open WebRender correctness tracker and links the active reports
  below.
- [Mozilla Bug 1794432: backdrop-filter blur renders incorrectly after scrolling down on this page](https://bugzilla.mozilla.org/show_bug.cgi?id=1794432)
  is an open scrolling correctness report where embedded video content affects
  whether the header blur renders correctly.
- [Mozilla Bug 1909463: backdrop-filter doesn't work with position sticky in complex pages](https://bugzilla.mozilla.org/show_bug.cgi?id=1909463)
  is an unconfirmed but close behavioral match: blur appears and later
  disappears during interaction on a complex sticky page. Its filtered element
  is sticky, whereas Watch's filtered sheet scrolls over a sticky video sibling.
- [Mozilla Bug 1803813: backdrop-filter doesn't work with border-radius, overflow: auto and position: sticky](https://bugzilla.mozilla.org/show_bug.cgi?id=1803813)
  is an unconfirmed sticky/overflow reproduction where filter functions stop
  rendering. It informed the overflow hypothesis but is not the same DOM shape.
- [Mozilla Bug 1769953: Backdrop-filter effect disappears on interaction with overlay scrollbars](https://bugzilla.mozilla.org/show_bug.cgi?id=1769953)
  is a verified-fixed historical WebRender example, not evidence that Firefox
  still has that exact overlay-scrollbar defect.
- [Mozilla Bug 1628046: backdrop-filter interacts poorly with picture caching](https://bugzilla.mozilla.org/show_bug.cgi?id=1628046)
  is resolved technical background for the picture-caching interaction; it is
  not a direct reproduction of the Watch symptom.
- [Mozilla Bug 1732817: Scrolling on apple.com is much less smooth on fenix than in chrome with backdrop-filter](https://bugzilla.mozilla.org/show_bug.cgi?id=1732817)
  is performance background only, not a disappearing-filter report.
- [Mux player custom React chrome pattern](../design-patterns/mux-player-custom-react-chrome-pattern-20260430.md)
  documents the Watch sticky-hero/body blur relationship and compositor cost.
- [Roadmap ticket feat-250](../../roadmap/platform/feat-250-watch-firefox-backdrop-blur-fallback.md)
  records the implementation scope and verification contract.
