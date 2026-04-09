---
id: "feat-047"
title: "Brand CMS to Follow Jesus Film Design Guidelines"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-03-30"
duration: 7
depends_on: []
blocks: []
tags:
  - "cms"
  - "tooling"
---

## Problem

The Strapi CMS admin still exposes vendor branding in the login view, navigation chrome, and browser icon surfaces. Editors should experience the CMS as a Jesus Film-owned workspace, not a stock Strapi install.

## Entry Points — Read These First

1. `apps/cms/src/admin/app.tsx` — current Strapi admin customization entrypoint; use supported admin config keys for logos and theme tokens
2. `apps/cms/config/middlewares.ts` — favicon middleware wiring if the root favicon replacement alone is not enough
3. `apps/cms/favicon.png` — current CMS favicon asset to replace
4. `apps/web/public/images/jesus-film-logo-full.svg` — source full logo for login/auth branding
5. `apps/web/public/images/jesusfilm-sign.svg` — source sign mark for compact/menu/logo-mark and favicon use

## Grep These

- `bootstrap(app` in `apps/cms/src/admin/` — existing admin extension structure to preserve
- `strapi::favicon` in `apps/cms/config/` — current favicon middleware path
- `logo:` in `apps/cms/src/admin/` — auth/menu logo config callsites once added
- `theme:` in `apps/cms/src/admin/` — theme token overrides once added

## What To Build

1. Add CMS-local branded assets under `apps/cms/src/admin/extensions/` using the shared Jesus Film full logo and sign mark as the source of truth.
2. Update `apps/cms/src/admin/app.tsx` to set `config.auth.logo` and `config.menu.logo` with the branded assets while preserving the existing System Status settings link.
3. Replace `apps/cms/favicon.png` with a Jesus Film sign-mark favicon asset and only touch `apps/cms/config/middlewares.ts` if explicit favicon middleware configuration is required after validation.
4. Add a small, low-risk `config.theme` override in `apps/cms/src/admin/app.tsx` so the admin shell uses Jesus Film-aligned primary/chrome colors in both light and dark themes.
5. Validate that login, authenticated admin chrome, and browser icon surfaces no longer show Strapi branding and that content editing behavior is unchanged.

## Constraints

- Do NOT redesign the content editing layout or add custom content-manager UI in this ticket.
- Do NOT import runtime assets directly from sibling apps in a brittle way; keep CMS-local copies/derivatives for the final admin build.
- Do NOT introduce broad CSS hacks when supported Strapi branding/theme config keys are sufficient.
- Do NOT change content types, GraphQL schema, or editor workflows.

## Verification

- `cd apps/cms && pnpm build`
- `cd apps/cms && pnpm lint`
- Manually verify `/admin/login` shows the Jesus Film full logo
- Manually verify authenticated admin nav shows the Jesus Film sign mark
- Hard-refresh and verify the browser tab/favicon uses the Jesus Film sign mark

## Delivery Reference

- Related PR: [#656](https://github.com/JesusFilm/forge/pull/656) `feat(cms): refresh admin branding`
