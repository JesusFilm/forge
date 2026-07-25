---
title: "fix: Remove the broken Watch footer Products link"
type: fix
status: completed
date: 2026-07-25
---

# fix: Remove the broken Watch footer Products link

## Summary

Remove the dead Products destination from the shared Watch footer and pin that behavior with focused component coverage. Verify the remaining first-party footer destinations from the rendered footer on desktop and mobile.

## Problem Frame

FGE-31 reports that the Watch footer sends users to `https://www.jesusfilm.org/products/`, which returns a first-party 404. The current Jesus Film Project homepage footer omits Products, and the issue explicitly allows removing the item until a valid destination exists.

## Requirements

- R1. The rendered Watch footer must not expose the broken Products label or `https://www.jesusfilm.org/products/` destination.
- R2. The change must flow through the existing shared footer, with verification covering Watch home, language-home, collection, video, episode, and not-found routes.
- R3. Existing destination-specific visible and accessible labels for the remaining footer links must remain unchanged.
- R4. Desktop and mobile verification must confirm the dead item is absent and the remaining first-party footer destinations resolve successfully in production.

## Key Technical Decisions

- **Remove rather than redirect Products:** no current first-party Products page exists, and relabeling an unrelated destination would weaken navigation semantics. This follows the current corporate homepage footer and the removal option accepted by FGE-31.
- **Keep the fix in the shared footer:** changing the single `navLinks` source automatically covers every route that renders `WatchHomeFooter` without duplicating route-level behavior.
- **Keep translation catalogs intact:** the unused Products message key remains harmless compatibility data; deleting it across every locale would create broad localization churn unrelated to the broken destination.
- **Keep production status checks outside unit tests:** component coverage pins the rendered contract, while live link validation remains an explicit browser/network smoke so CI does not depend on third-party availability.

## Implementation Units

### U1. Remove and guard the broken Products footer item

- **Goal:** Remove the dead Products navigation item and prevent its accidental reintroduction.
- **Requirements:** R1, R2, R3, R4
- **Dependencies:** None
- **Files:**
  - `apps/web/src/components/home/WatchHomeFooter.tsx`
  - `apps/web/src/components/home/__tests__/WatchHomeFooter.test.tsx`
- **Approach:** Delete the Products entry from the shared navigation data. Extend the focused footer test to assert the broken href and Products text are absent while the remaining navigation labels and first-party hrefs stay destination-specific.
- **Patterns to follow:** Existing rendered-DOM assertions in `apps/web/src/components/home/__tests__/WatchHomeFooter.test.tsx` and existing route-level footer coverage in `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`.
- **Test scenarios:**
  1. Render the English footer and confirm no anchor points to `https://www.jesusfilm.org/products/` and no Products navigation label is present.
  2. Confirm the rendered footer navigation retains the expected remaining destination-specific labels and first-party hrefs.
  3. Render Watch home, language-home, collection, video, episode, and not-found routes across desktop and mobile viewports, confirming Products is absent on each route.
  4. Collect the remaining first-party destinations from the rendered shared footer and confirm each returns a successful page directly or through an intentional redirect.
- **Verification:** The focused footer test passes, existing route/footer coverage stays green, and desktop/mobile browser smoke shows no dead Products action across every route category named in FGE-31.
