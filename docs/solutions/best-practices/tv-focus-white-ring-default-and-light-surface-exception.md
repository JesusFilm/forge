---
title: "TV focus: a white border ring is the app-wide default; light surfaces are the exception"
date: 2026-06-24
category: best-practices
module: apps/tv
problem_type: best_practice
component: frontend_stimulus
severity: medium
applies_when:
  - "Choosing or changing the D-pad focus indicator on an apps/tv surface"
  - "Flipping the default of a shared component prop (e.g. FocusableCard focusRing)"
  - "A focus ring is invisible on a light or near-white card/pill"
  - "Verifying TV focus styling across both Apple TV and Android TV"
related_components:
  - apps/tv FocusableCard
  - apps/tv HomeCard
tags:
  - tv
  - tvos
  - android-tv
  - focus-ring
  - focusablecard
  - crimson-glow
  - white-ring
  - design-system
---

# TV focus: a white border ring is the app-wide default; light surfaces are the exception

## Context

apps/tv ran two focus looks side by side: the legacy "Crimson Gallery" crimson
glow on the SDUI/series surfaces, and the newer WATCH_THEME white ring on
home/watch/search. Focused elements looked inconsistent page to page.
Standardizing everything onto the home page's **white border ring** (via the
shared `FocusableCard`'s `focusRing` default) surfaced three reusable rules that
apply any time you pick a focus indicator or flip a shared component's default.

## Guidance

1. **Use a white _border_ ring as the focus indicator, not a colored shadow.**
   `borderWidth`/`borderColor` render on **both** Apple TV and Android TV; iOS
   `shadowColor`/`shadowRadius` are **iOS-only**. Drive it from `FocusableCard`'s
   `focusRing` default so every consumer inherits it.
2. **A white ring is invisible on a near-white surface — opt those elements into
   crimson (or a dark ring).** Light-background cards/pills are the one exception
   to the white default: pass `focusRing="crimson"`.
3. **Audit every consumer before flipping a shared component's default.** The
   change is silent (no compile error); a default flip on a widely-used component
   converts all of its call sites at once, and the wrong-surface ones regress.

## Why This Matters

- **Cross-platform visibility.** Because the crimson glow was an iOS shadow, it
  was _invisible on Android TV_ — those surfaces had no focus cue at all. Moving
  to a border ring didn't just restyle iOS; it gave Android TV a working focus
  indicator for the first time. Treat "is this a shadow?" as "is this invisible on
  Android TV?".
- **White-on-white silently kills the cue.** A `rgba(255,255,255,0.9)` ring on a
  `#F5F5F4` surface has no contrast — focus looks unfocused. This is easy to miss
  because structural tests still pass; only a real-device/sim look catches it.
- **Default flips have a wide blast radius.** Flipping `FocusableCard`'s
  `focusRing` default from `"crimson"` to `"white"` converted ~8 consumers in one
  line; exactly one — the white `FallbackPill` (bg `#F5F5F4`) — regressed to an
  invisible ring. Auditing consumers (especially light-surfaced ones) up front is
  the cheap insurance.

## When to Apply

- Before flipping the default of any shared `apps/tv` styling prop — list the
  consumers first and check each surface's background against the new default.
- When adding a focusable element on a light/near-white background — reach for
  crimson or a dark ring, not the white default.
- When a focus indicator must work on Android TV — use a border, never an iOS
  shadow alone.

## Examples

Flipping the shared default (one line, app-wide effect):

```tsx
// FocusableCard.tsx — every consumer that omits focusRing now gets the white ring
export function FocusableCard({ focusRing = "white" /* was "crimson" */, ... }) { … }
```

The light-surface exception (a white ring would vanish on the `#F5F5F4` pill):

```tsx
// RelatedQuestionsRenderer.tsx — FallbackPill is a near-white pill
<FocusableCard style={styles.fallbackPill} focusRing="crimson">
  …
</FocusableCard>
```

Make the ring follow the card's own radius so a pill gets a pill ring, not a
square one:

```tsx
const cardRadius = visualStyle?.borderRadius
const ringRadius = typeof cardRadius === "number" ? cardRadius : scaleSize(16)
// whiteRing style spreads { borderRadius: ringRadius }
```

Cross-platform indicator — border (works everywhere) vs shadow (iOS-only):

```tsx
// ✅ visible on Apple TV AND Android TV
focusRing: { borderWidth: scale(5), borderColor: "rgba(255,255,255,0.88)" }
// ❌ invisible on Android TV (shadow* props are iOS-only)
focusGlow: { shadowColor: COLORS.primary, shadowRadius: scale(16), shadowOpacity: 0.6 }
```

## Related

- `docs/solutions/best-practices/tv-carousel-card-conformance-pattern-20260416.md`
  and `docs/solutions/ui-bugs/tv-carousel-card-focus-animation-overflow-20260416.md`
  — document the crimson glow as the focus standard; **superseded** on the default
  (crimson is now opt-in). Their `FocusableCard` outer(`overflow:visible`)/inner
  (`overflow:hidden`) split and the `paddingVertical` rail wrapper still hold.
- `docs/solutions/ui-bugs/android-tv-density-scaling-and-native-view-clipping-20260416.md`
  — why iOS shadow props don't render on Android TV (the basis for rule 1).
- `docs/solutions/best-practices/rn-animated-react18-cleanup-review-false-positives-20260615.md`
  — the focus tweens are finite `Animated` on a stable progress ref; "missing
  `animation.stop()`" findings on them are known false positives.
- `apps/tv/CLAUDE.md` (Design Systems / TV-Specific Patterns) — records the white
  ring as the app-wide default and crimson as the light-surface opt-in.
- PR #1356 — the standardization change.
