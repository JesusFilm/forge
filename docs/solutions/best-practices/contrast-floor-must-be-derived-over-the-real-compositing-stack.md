---
title: "A contrast floor derived over the wrong backdrop invents a bad middle and a 3x-too-high minimum"
date: 2026-09-08
category: best-practices
module: apps/mobile
problem_type: best_practice
component: design_system
root_cause: wrong_derivation_substrate
resolution_type: design_decision
severity: medium
symptoms:
  - "A design decision says an overlay tint must be at least 0.78 alpha and warns that intermediate values are worse than none"
  - "The shipped tint is 0.30 and measures well above the AA floor, so the decision and the code disagree"
  - "A tint alpha sweep appears to have a dip in the middle where contrast is worst"
  - "The rule forbids exactly the value that measurement shows is correct"
applies_when:
  - "A translucent tint sits on a material (glass, blur, scrim) that has already changed the ground under the text"
  - "A contrast floor is taken from a reference table or a sibling surface rather than computed on this stack"
  - "A design decision states a numeric threshold whose derivation is not written down beside it"
related_components:
  - tabBar.ts
  - TabBarBackground.tsx
tags:
  - accessibility
  - wcag-contrast
  - design-decision
  - alpha-compositing
  - liquid-glass
  - mobile
  - react-native
---

# A contrast floor derived over the wrong backdrop invents a bad middle and a 3x-too-high minimum

## Context

The iOS tab bar is a floating capsule made of Liquid Glass. Text sits on the
capsule, and arbitrary app content scrolls behind it. Blur removes detail but
does not change luminance, so a bright Home feed can lift the ground under the
idle labels until they fail WCAG AA. A tint on the material is the fix
(`TAB_BAR_MATERIAL_TINT` in `apps/mobile/src/lib/tabBar.ts`).

The plan carried a decision that set the floor at alpha >= 0.78 and warned
that an intermediate alpha is worse than no tint at all. The code shipped
0.30 and measured 4.79:1 — safely above the 4.5:1 AA floor. The decision and
the code disagreed by a factor of three, and the decision forbade the value
that measurement proved correct.

## The mistake

The 0.78 figure came from a table swept over a **bare white backdrop with no
material**. That is a different compositing stack from the one that ships.

The shape of a tint-vs-contrast curve depends on one thing: whether the
backdrop's luminance is on the **same side** of the text's luminance as the
tint's. A black tint on a white backdrop drags the ground from far above the
text, down **through** the text's own luminance, and out below it. The curve
therefore dips to 1.00:1 at the crossing, then climbs. That crossing is the
"bad middle", and it is why the far-side pass only arrives at 0.78.

The real ground is not white. The glass has already darkened it to about
rgb(86, 74, 77), which is **below** the idle label (`#a8a29e`) to start with.
A black tint moves it further down, away from the text, so the sweep never
crosses and the curve rises monotonically for the whole range.

Measured against the real ground, iPhone 17 Pro Max simulator, 2026-09-08:

| black tint alpha | over glass ground rgb(86,74,77) | over bare white           |
| ---------------- | ------------------------------- | ------------------------- |
| 0.00             | 3.35:1 (fails AA)               | 2.52:1                    |
| 0.20             | 4.27:1                          | 1.57:1                    |
| **0.26**         | **4.57:1 — the true minimum**   | 1.34:1                    |
| **0.30**         | **4.79:1 — ships**              | 1.20:1                    |
| 0.36             | 5.16:1                          | **1.00:1 — the crossing** |
| 0.78             | 7.50:1                          | 4.65:1                    |
| 1.00             | 8.33:1                          | 8.33:1                    |

Both columns end at the same value, because at alpha 1.0 the tint is the
ground. Everything between them differs, and the middle of the table is where
a wrong substrate does the most damage.

## The rule

**Derive a contrast floor over the stack the pixels actually pass through, not
over a reference backdrop.** A material that already moves the ground away
from the text changes the answer, and it changes it in the direction that
matters: the derived minimum was ~3x too high, and the accompanying "avoid
intermediate values" warning was an artefact of the wrong substrate, not a
property of tints.

Two practical consequences:

1. **Sample the worst real ground, do not assume one.** The ground here came
   from reading pixels through the shipped glass over the brightest content
   the app can show. A guessed backdrop is what produced the wrong table.
2. **A monotone curve makes an intermediate value safe and a minimum
   computable.** Once you know the sweep does not cross the text's luminance,
   you can solve for the floor (0.26) and ship a small margin above it (0.30)
   instead of over-tinting to escape a dip that is not there.

## Do not confuse this with the guard problem

A guard that computes the ratio from only the tint's **alpha**, and composites
a hard-coded black, scores a WHITE tint at 0.30 as 4.79:1 while it actually
measures 1.52:1 — the white tint lightens the ground toward the label instead
of darkening it away. That is a separate defect, in the test rather than in
the derivation, and `src/lib/__tests__/tabBar.test.ts` now parses the full
`rgba()` and carries a white-tint case that must fail. See
[A contrast guard bound to one UI variant's rendered artifact is deleted, not
re-pointed](wcag-contrast-guard-bound-to-variant-artifact-not-property.md), the
guard-shaped version of the same problem on a different mobile surface.

## What this does not fix

The tint raises the **idle** labels only. The active label is `#CB333B` at
3.39:1, and it sits at a middling luminance, so it fails against dark and
light grounds alike. No alpha on any tint rescues it — only a colour change
does, and that colour is shared with Android. It ships failing AA on purpose,
as a product decision about the brand red.

## Related

- [expo-glass-effect GlassView renders no material under an animated-opacity ancestor](expo-glass-effect-glassview-invisible-under-animated-opacity-ancestor.md)
- [expo-glass-effect GlassView: isInteractive flash bug and cross-platform integration](expo-glass-effect-interactive-flash-2026-04-08.md)
- `apps/mobile/CLAUDE.md`, section "Tab bar — a floating pill on iOS, a flush bar on Android"
