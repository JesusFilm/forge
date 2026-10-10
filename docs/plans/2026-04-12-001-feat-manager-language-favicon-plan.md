---
title: "feat: Add manager language favicon"
type: feat
status: completed
date: 2026-04-12
origin: docs/roadmap/platform/feat-083-manager-app-favicon-branding.md
---

# feat: Add manager language favicon

## Overview

Replace the manager app favicon with the user-provided language icon, rendered in Jesus Film brand red `#EF3340`, and keep the change scoped to `apps/manager`.

## Scope

- Add a manager-only `apps/manager/public/favicon.svg`.
- Point `apps/manager/src/app/layout.tsx` metadata icons at `/favicon.svg`.
- Track the work in `docs/roadmap/platform/feat-083-manager-app-favicon-branding.md`.

## Acceptance Criteria

- Browser favicon requests for the manager app resolve to the provided language icon artwork.
- The favicon uses `#EF3340` and does not introduce new colors.
- No other app icon or favicon assets change.

## Validation

- `pnpm prettier --check --ignore-unknown apps/manager/src/app/layout.tsx apps/manager/public/favicon.svg docs/roadmap/platform/feat-083-manager-app-favicon-branding.md docs/plans/2026-04-12-001-feat-manager-language-favicon-plan.md`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- `MUX_TOKEN_ID=local MUX_TOKEN_SECRET=local OPENROUTER_API_KEY=local STRAPI_URL=http://localhost:1337 STRAPI_API_TOKEN=local pnpm --filter @forge/manager build`
