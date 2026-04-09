---
date: 2026-04-04
topic: cms-admin-branding
---

# Jesus Film Branding for Strapi CMS Admin

## Problem Frame

The CMS admin currently exposes Strapi branding in places editors see regularly, including admin logos and browser/app icons. This makes the CMS feel like a vendor product instead of a Jesus Film-owned editorial workspace. The goal is to replace visible Strapi branding with the existing shared Jesus Film brand assets already used elsewhere in the repo, while also giving the admin shell a more on-brand visual feel.

## Requirements

- R1. Replace all visible Strapi-branded admin logos with Jesus Film branding across the CMS admin experience, including compact and full-width logo placements.
- R2. Replace the CMS favicon and any other browser/app icon surfaces currently showing Strapi branding with the shared Jesus Film sign mark.
- R3. Use the existing shared repo assets as the source of truth for branding, specifically the full logo from `apps/web/public/images/jesus-film-logo-full.svg` and the sign mark from `apps/web/public/images/jesusfilm-sign.svg` or `apps/manager/public/jesusfilm-sign.svg`.
- R4. Adjust the Strapi admin theme so the shell feels consistent with Jesus Film branding rather than default Strapi styling.
- R5. Keep the change focused on branding and shell polish only; do not redesign the content editing workflow or alter CMS content models.

## Success Criteria

- Editors no longer encounter Strapi branding during normal CMS admin use.
- The login/admin chrome uses Jesus Film branding consistently in both compact and full-logo contexts.
- The browser tab/app icon uses the Jesus Film sign mark instead of the current Strapi-associated icon.
- The admin shell feels visually aligned with Jesus Film branding without reducing usability or contrast.

## Scope Boundaries

- No changes to content types, GraphQL schema, or editorial workflows.
- No custom content editing layout work in this scope.
- No creation of a separate CMS-only brand system; reuse existing shared Jesus Film assets.
- No rebrand of user-generated or uploaded media inside content entries.

## Key Decisions

- **Complete brand replacement, not minimal swap**: The chosen scope is to remove Strapi branding everywhere it is user-visible, not just on the login screen.
- **Reuse existing shared assets**: Branding should come from the current repo assets already used by web/manager, avoiding parallel CMS-only logo files unless planning finds a format constraint.
- **Theme polish included**: This is not only an asset swap; the admin shell should feel intentionally branded.
- **Keep workflow unchanged**: Content editing behavior stays the same so this remains a low-risk branding pass.

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Needs research] Which admin branding surfaces are officially supported by the current Strapi v5 admin API versus requiring light overrides?
- [Affects R4][Needs research] Which theme token changes are enough to feel branded without creating maintenance risk or accessibility regressions?
- [Affects R2][Technical] Does Strapi expect raster icon assets for some surfaces, and if so, should the Jesus Film sign mark be generated into CMS-local icon files?

## Next Steps

-> `/ce:plan` for structured implementation planning
