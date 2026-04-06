---
title: "feat: Replace Strapi CMS admin branding with Jesus Film branding"
type: feat
status: completed
date: 2026-04-04
origin: docs/brainstorms/2026-04-04-cms-admin-branding-requirements.md
---

# feat: Replace Strapi CMS admin branding with Jesus Film branding

## Overview

Replace visible Strapi branding in the CMS admin with the shared Jesus Film brand assets already present in the repo, and extend the Strapi admin theme so the shell feels branded rather than default. This is intentionally a shell-level branding pass only: logos, favicon, tab/app identity, and theme tokens. Editorial workflows, content models, and custom content-editing layouts remain unchanged.

## Problem Frame

The current CMS admin exposes vendor branding in places editors see every day. That makes the tool feel generic and externally owned, even though it functions as a Jesus Film editorial workspace. The goal is to remove visible Strapi branding from normal editor-facing surfaces and replace it with shared Jesus Film branding, using supported Strapi v5 admin customization APIs wherever possible.

## Requirements Trace

- R1. Replace visible admin logos in login and navigation surfaces
- R2. Replace CMS favicon and related browser/app icon surfaces
- R3. Reuse existing shared brand assets from `apps/web` / `apps/manager`
- R4. Apply theme polish so the admin shell feels on-brand
- R5. Keep scope limited to branding and shell polish only

## Scope Boundaries

- No changes to content types, GraphQL schema, bootstrap flows, or editorial workflows
- No custom content-editing layout work, side panels, or document actions
- No CMS-only parallel brand system unless technical constraints require generated raster derivatives
- No changes to user-uploaded media or content-entry previews

## Context & Research

### Relevant Code and Patterns

- `apps/cms/src/admin/app.tsx` — current Strapi admin entrypoint; already used for custom admin settings link and is the primary place for `config.auth.logo`, `config.menu.logo`, `config.theme`, and head-level admin config
- `apps/cms/config/middlewares.ts` — currently uses default `strapi::favicon` middleware; can be switched to configured favicon path if needed
- `apps/cms/favicon.png` — current project-root favicon file that can be replaced per Strapi docs
- `apps/web/public/images/jesus-film-logo-full.svg` — shared full wordmark candidate for auth/login branding
- `apps/web/public/images/jesusfilm-sign.svg` and `apps/manager/public/jesusfilm-sign.svg` — shared sign mark candidate for compact/logo-mark/icon use
- `apps/cms/src/admin/vite.config.ts` — confirms admin build supports local asset imports and admin-side aliasing without extra bundler setup

### Institutional Learnings

- There is no existing CMS admin branding pattern in `docs/solutions/`; this change should therefore stay close to official Strapi extension points to minimize maintenance burden.
- `apps/cms/AGENTS.md` emphasizes narrow, local use of Strapi internals; avoid unsupported deep overrides when supported config keys exist.

### External References

- Strapi v5 Logos docs: `config.auth.logo` and `config.menu.logo` are the supported keys in `src/admin/app.ts(x)` for login and navigation logo replacement.
- Strapi v5 Favicon docs: favicon can be replaced either by swapping project-root `favicon.png` or configuring `strapi::favicon` middleware with a custom path.
- Strapi v5 Theme Extension docs: `config.theme.light` and `config.theme.dark` in `src/admin/app.ts(x)` are the supported way to override design-system theme tokens.

## Spec Flow Notes

Key user-visible flows for this feature:

1. Editor opens `/admin/login` and sees Jesus Film branding instead of Strapi branding.
2. Authenticated editor lands in admin and sees Jesus Film branding in the main navigation chrome.
3. Browser tab and favicon surfaces show the Jesus Film sign mark instead of the current Strapi-associated icon.
4. Admin shell accents and primary UI color tokens feel branded in both light and dark theme modes without reducing readability.

Edge cases to cover:

- Browser favicon caching can make a correct implementation look broken until cache/CDN state is refreshed.
- A wide logo that looks good on the login page may be visually poor in the compact nav slot, so auth and menu logos should be treated as separate assets/variants.
- Theme overrides should stay shallow and token-based; broad CSS hacks risk breakage across Strapi upgrades.

## Key Technical Decisions

- **Use official Strapi branding hooks first**: Implement logo and theme changes in `apps/cms/src/admin/app.tsx` using documented `config.auth.logo`, `config.menu.logo`, and `config.theme.*` keys.
- **Use full logo + sign mark separately**: Use the Jesus Film full wordmark for `auth.logo` and the sign mark for `menu.logo` and favicon/icon contexts.
- **Materialize CMS-local assets**: Copy or derive the shared brand assets into `apps/cms/src/admin/extensions/` (and root/icon locations as needed) rather than importing directly from sibling apps. This keeps the CMS build self-contained and avoids brittle cross-app asset paths.
- **Prefer replacing root favicon and also wiring middleware path if needed**: Use a CMS-local favicon asset so browser/app icon behavior is explicit and not dependent on default Strapi branding fallbacks.
- **Keep theme changes token-only**: Limit theme work to color/token overrides needed to establish branded chrome and primary actions. Do not introduce unsupported layout or CSS override layers in this change.

## Open Questions

### Resolved During Planning

- **Should this reuse shared brand assets or create CMS-specific branding?** Reuse shared brand assets already in `apps/web` / `apps/manager`.
- **Should this include favicon/browser icon surfaces?** Yes, replace visible Strapi branding everywhere it appears, including favicon/browser icon surfaces.
- **Should this include content editing layout changes?** No. Keep scope to shell branding and theme polish only.

### Deferred to Implementation

- **Raster derivative generation**: If the SVG sign mark does not cover all favicon/browser contexts cleanly, generate or export a PNG derivative for CMS-local use.
- **Theme token depth**: Final token set can be tightened during implementation after visual verification, but should remain small and focused on primary/neutral/chrome surfaces.

## Implementation Units

- [x] **Unit 1: Stage branded CMS admin assets**

  **Goal:** Add CMS-local logo and icon assets based on the shared Jesus Film branding.

  **Requirements:** R1, R2, R3

  **Files:**
  - Create: `apps/cms/src/admin/extensions/` branded logo assets
  - Modify or replace: `apps/cms/favicon.png`
  - Optionally create: additional CMS-local icon files if favicon middleware path or admin config benefits from explicit naming

  **Approach:**
  - Reuse the shared full wordmark and sign mark as the source of truth.
  - Keep CMS-local copies/derivatives so the CMS admin build does not depend on assets located in other apps.
  - Use the full logo for wide placements and the sign mark for compact/icon surfaces.

  **Test scenarios:**
  - Assets resolve in the CMS admin build without cross-app import issues.
  - Compact/logo-mark asset remains legible at nav/favicon scale.

- [x] **Unit 2: Replace supported Strapi admin logos**

  **Goal:** Swap Strapi login and navigation branding to Jesus Film branding using supported Strapi APIs.

  **Requirements:** R1, R3

  **Files:**
  - Modify: `apps/cms/src/admin/app.tsx`

  **Approach:**
  - Import CMS-local auth and menu logo assets.
  - Add `config.auth.logo` and `config.menu.logo` in the existing admin config object.
  - Preserve the current `bootstrap(app)` behavior that adds the System Status settings link.

  **Patterns to follow:**
  - Existing `apps/cms/src/admin/app.tsx` structure
  - Strapi v5 logo customization docs

  **Test scenarios:**
  - Login screen shows Jesus Film auth logo.
  - Main navigation shows Jesus Film compact logo after sign-in.
  - Existing System Status settings link still appears and works.

- [x] **Unit 3: Replace favicon / tab icon surfaces**

  **Goal:** Remove remaining Strapi-associated browser/app icon branding.

  **Requirements:** R2, R3

  **Files:**
  - Modify: `apps/cms/favicon.png`
  - Modify if needed: `apps/cms/config/middlewares.ts`
  - Modify if supported/needed: `apps/cms/src/admin/app.tsx` head config

  **Approach:**
  - Replace the root `favicon.png` with a Jesus Film sign-mark asset.
  - If testing shows Strapi still serves the wrong favicon path, explicitly configure `strapi::favicon` middleware with the branded asset path.
  - If the admin head config supports explicit favicon/title values in this project setup, set those there as well for clarity.

  **Patterns to follow:**
  - Strapi v5 favicon docs
  - Existing middleware config style in `apps/cms/config/middlewares.ts`

  **Test scenarios:**
  - Browser tab icon shows Jesus Film sign mark after cache-busted reload.
  - No remaining Strapi favicon appears on login or authenticated admin pages.

- [x] **Unit 4: Apply branded theme token overrides**

  **Goal:** Make the admin shell feel Jesus Film-branded without destabilizing the UI.

  **Requirements:** R4

  **Files:**
  - Modify: `apps/cms/src/admin/app.tsx`

  **Approach:**
  - Add a small `config.theme` override for light and dark themes.
  - Prioritize primary accent colors and any chrome/neutral tokens needed to avoid a mostly-default Strapi look.
  - Keep the override set intentionally small and readable.

  **Patterns to follow:**
  - Strapi v5 theme extension docs
  - Existing brand colors inferred from shared Jesus Film assets

  **Test scenarios:**
  - Primary buttons/accents reflect Jesus Film branding.
  - Light and dark theme modes remain readable and visually coherent.
  - No obvious contrast regressions on login and primary admin views.

- [x] **Unit 5: Validate branded admin experience end-to-end**

  **Goal:** Confirm normal editor-visible surfaces are fully de-Strapi-branded.

  **Requirements:** R1, R2, R4, R5

  **Files:**
  - No planned code changes unless fixes are needed from validation

  **Approach:**
  - Build and run the CMS admin locally.
  - Manually verify login page, authenticated nav shell, and browser tab/favicon behavior.
  - Capture screenshots for before/after PR documentation since this is a UI change.

  **Test scenarios:**
  - Login page, nav shell, and browser icon all use Jesus Film branding.
  - Content editing view remains behaviorally unchanged.
  - No console/build errors introduced by asset imports or theme config.

## Acceptance Criteria

- [x] `apps/cms/src/admin/app.tsx` uses supported Strapi config keys to replace login and menu logos with Jesus Film branding
- [x] CMS favicon/browser icon surfaces use the Jesus Film sign mark instead of the current Strapi-associated icon
- [x] Theme token overrides make the admin shell feel branded in light and dark mode without harming contrast or usability
- [x] Existing CMS admin functionality, including the custom System Status settings link, continues to work
- [x] No content-model, GraphQL, or editorial workflow behavior changes are introduced

## Testing & Verification

- Run `pnpm --filter @forge/cms build` to verify the admin bundle compiles with the new assets/config
- Run `pnpm --filter @forge/cms lint`
- Manually verify `/admin/login` branding, authenticated nav branding, and favicon/tab icon behavior in a browser
- Hard-refresh or use a cache-busting browser session when verifying favicon changes
- Capture screenshots of login and authenticated admin states for PR documentation

## Dependencies & Risks

### Dependencies

- Shared Jesus Film brand assets in:
  - `apps/web/public/images/jesus-film-logo-full.svg`
  - `apps/web/public/images/jesusfilm-sign.svg`
  - `apps/manager/public/jesusfilm-sign.svg`

### Risks

- **Favicon cache confusion:** Browser or CDN cache can mask a correct implementation.
- **Oversized logo in compact slot:** Full logo may not suit the menu slot, so separate assets must be used intentionally.
- **Theme drift:** Overriding too many tokens could make the admin harder to maintain across Strapi upgrades.

## References & Research

### Internal References

- `docs/brainstorms/2026-04-04-cms-admin-branding-requirements.md`
- `apps/cms/src/admin/app.tsx`
- `apps/cms/config/middlewares.ts`
- `apps/cms/favicon.png`
- `apps/web/public/images/jesus-film-logo-full.svg`
- `apps/web/public/images/jesusfilm-sign.svg`
- `apps/manager/public/jesusfilm-sign.svg`

### External References

- Strapi logos docs: `https://docs.strapi.io/cms/admin-panel-customization/logos`
- Strapi favicon docs: `https://docs.strapi.io/cms/admin-panel-customization/favicon`
- Strapi theme extension docs: `https://docs.strapi.io/cms/admin-panel-customization/theme-extension`
- Strapi admin panel API overview: `https://docs.strapi.io/cms/plugins-development/admin-panel-api`
