---
date: 2026-04-09
topic: mobile-shared-styles
---

# Mobile-v2 Shared Styles Extraction

## Problem Frame

Across `apps/mobile-v2/`, 20 components each define their own `StyleSheet.create()` blocks. Common patterns — containers, headings, subtitles, cards, row layouts, centered views, pressed states — are duplicated verbatim or near-verbatim in many files. This makes bulk style changes tedious and increases the chance of drift between screens that should look consistent.

## Requirements

**Shared Style Module**

- R1. Create `src/styles/` directory and a shared StyleSheet module at `src/styles/shared.ts` that exports pre-built style groups (layout, text, row, card, etc.) using `StyleSheet.create()`.
- R2. Shared styles must use existing color constants from `src/lib/color.ts` and be compatible with `useTypography` style array composition (e.g., `[shared.text.heading, typography.heading]`).
- R3. Export a shared spacing/sizing constants object (e.g., `HORIZONTAL_PADDING`, common border radii) so components reference named values instead of magic numbers.

**Migration**

- R4. Migrate all 20 components that have inline `StyleSheet.create()` to import from the shared module for any styles that match shared patterns.
- R5. Each component retains a local `StyleSheet.create()` for styles unique to that component. Only duplicated patterns move to shared.
- R6. Migration must be a no-op visually — no style changes, just dedup. Verify by inspecting each screen before/after.

## Success Criteria

- Common style patterns are grouped and defined once in `src/styles/shared.ts` (exact groups determined during planning audit).
- All 20 component files import shared styles instead of redefining them.
- No visual regressions on any screen.

## Scope Boundaries

- **Not** building a design system, theming engine, or style factory functions.
- **Not** changing `useTypography` — it stays as-is, composed via array spreads.
- **Not** introducing any new dependencies (e.g., styled-components, NativeWind).
- **Not** changing any visual appearance — pure refactor.

## Key Decisions

- **Single shared file, not per-category files**: One `src/styles/shared.ts` is simpler to discover and import. If it grows unwieldy later, it can be split — but 20 components' worth of shared patterns is manageable in one file.
- **StyleSheet.create() over factory functions**: The duplication is static patterns, not complex variant logic. Pre-built stylesheets are zero-cost and familiar.
- **Incremental-friendly structure**: Group exports by concern (layout, text, row, card) so components import only what they need.

## Dependencies / Assumptions

- Existing `src/lib/color.ts` constants remain the source of truth for colors.
- `useTypography` hook remains the source of truth for responsive font sizing.

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Needs research] Exact grouping of shared styles — planner should audit all 20 files to identify the minimal set of shared style groups that covers the most duplication. Planning must resolve this before implementation of R1 begins; the audit output becomes the definitive group structure for `shared.ts`.
- [Affects R4][Technical] Migration order — planner should determine whether to migrate all at once or in batches. The 20 files span: `app/` route files (4), `src/components/sections/` renderers (13), `src/components/ui/` (2), `src/contexts/` (1 — `ExperienceShell.tsx`).

## Next Steps

-> `/ce:plan` for structured implementation planning
