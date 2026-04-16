---
id: "feat-091"
title: "Manager Studio Shell Rollout"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-15"
duration: 2
depends_on:
  - "feat-090"
blocks: []
tags:
  - "manager"
  - "design-system"
  - "shell"
---

## Problem

The Studio shell existed only as a design-system demo, while the real manager app still used the older dashboard frame, DOM-based header injection, and a separate login look. That left Coverage, Jobs, Job Detail, Agents, and System visually inconsistent and made shell-level controls harder to share across routes.

## Scope

1. Replace the legacy dashboard frame in `apps/manager/src/app/dashboard/layout.tsx` with a shared Studio shell.
2. Move authenticated navigation, jobs count polling, and profile/logout behavior into the new shared shell.
3. Replace the coverage `#report-header-slot` portal pattern with a React shell header slot API.
4. Apply the Studio shell to coverage, jobs, job detail, agents, and design-system without broadly restyling each page interior.
5. Restyle `apps/manager/src/app/login/page.tsx` with a Studio auth-shell variant.
6. Restyle dashboard loading and error surfaces to render inside the shared shell language.

## What Was Built

1. Added shared dashboard shell primitives in `apps/manager/src/features/shell/manager-shell.tsx` and `apps/manager/src/features/shell/studio-auth-shell.tsx`.
2. Replaced the legacy dashboard layout with the Studio shell, including real-route nav for Coverage, Jobs, Agents, and System.
3. Moved jobs queue polling and profile menu/logout behavior into the new shell.
4. Replaced the coverage DOM portal header injection with `ManagerShellHeaderSlot`.
5. Updated login, dashboard loading, and dashboard error states to match the Studio visual language.
6. Flattened the design-system route so it now renders inside the real app shell instead of nesting a fake demo shell.

## Verification

- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- Full-page screenshots:
  - `output/playwright/manager-login-shell.png`
  - `output/playwright/manager-coverage-shell.png`
  - `output/playwright/manager-jobs-shell.png`
  - `output/playwright/manager-job-detail-shell.png`
  - `output/playwright/manager-agents-shell.png`
  - `output/playwright/manager-design-system-shell-rollout.png`
