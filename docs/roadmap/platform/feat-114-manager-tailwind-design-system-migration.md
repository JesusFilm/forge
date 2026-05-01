---
id: "feat-114"
title: "Manager Tailwind Design System Migration"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-20"
duration: 4
depends_on:
  - "feat-113"
blocks: []
tags:
  - "manager"
  - "design-system"
  - "tailwind"
  - "styling"
---

## Problem

The manager app now shares the Studio shell and page-level visual direction, but its styling still lives mostly in a large semantic CSS file. That makes reuse harder and slows down future UI work because shell, auth, coverage, jobs, and agents still depend on screen-specific global selectors.

## Entry Points — Read These First

1. `apps/manager/src/app/globals.css` — current styling source of truth; contains shell, auth, coverage, jobs, agents, and legacy standalone rules.
2. `apps/manager/src/features/shell/manager-shell.tsx` — shared Studio dashboard shell and current route-driven navigation.
3. `apps/manager/src/features/shell/studio-auth-shell.tsx` and `apps/manager/src/features/shell/studio-auth-background.tsx` — login/auth shell structure and image treatment.
4. `apps/manager/src/features/coverage/coverage-report-client.tsx`, `apps/manager/src/features/jobs/live-job-detail-screen.tsx`, and `apps/manager/src/features/agents/automation-form.tsx` — the heaviest screen surfaces that currently rely on global CSS.

## Grep These

- `design-system-`
- `studio-`
- `coverage-`
- `geo-`
- `jobs-`
- `agents-`
- `login-`
- `body.coverage-standalone`
- `body.jobs-standalone`

## What To Build

1. Add a Tailwind 4 setup local to `apps/manager`, following the repo’s modern Next.js app pattern.
2. Add manager-local shadcn-style infrastructure (`components.json`, `src/components/ui`, `src/lib/utils.ts`) and move shared visual primitives there.
3. Convert manager design tokens into Tailwind-consumable theme variables while keeping `globals.css` only for tokens, resets, browser-specific rules, and unavoidable third-party overrides.
4. Rebuild the Studio shell, auth shell, shared UI primitives, and production screens using Tailwind-backed components and utilities.
5. Remove migrated global CSS sections as each subsystem moves into TSX-level Tailwind composition.

## Attached Follow-up — Coverage Language Persistence

This ticket also owns the small Manager coverage state follow-up captured in `docs/brainstorms/2026-05-01-manager-coverage-language-persistence-requirements.md` and planned in `docs/plans/2026-05-01-fix-manager-coverage-language-persistence-plan.md`.

The follow-up keeps the Studio shell's route and session-state behavior aligned with the migrated Manager UI:

1. Default bare `/dashboard/coverage` visits to English when no explicit query or remembered selection exists.
2. Remember the user's latest custom coverage language selection for the current dashboard session.
3. Restore that remembered selection when returning to bare `/dashboard/coverage` from Jobs, Agents, or other Manager pages.
4. Preserve the canonical URL contract: explicit `languageId` wins, legacy `languageIds` remains accepted, and coverage writes normalize back to `languageId`.
5. Treat clearing all selected languages as an explicit reset so later bare visits fall back to English.

## Constraints

- Preserve the current Studio visual language; this is not a redesign.
- Preserve existing route behavior, auth behavior, URL/query state, and page information architecture.
- Do not introduce new color tokens or one-off hex values without explicit approval.
- Keep third-party CSS only where inline migration is unrealistic.
- Do not replace URL-backed coverage state with hidden-only preferences.
- Do not hardcode an English core ID; resolve English from the existing language data path.

## Verification

- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- Route screenshots or browser verification for:
  - `/login`
  - `/dashboard/coverage`
  - `/dashboard/jobs`
  - `/dashboard/jobs/[id]`
  - `/dashboard/agents`
- Confirm no large migrated screen blocks remain in `apps/manager/src/app/globals.css`.
- Coverage language persistence browser smoke: open `/dashboard/coverage`, confirm English is selected; select a custom language set; navigate to Jobs or Agents; return to Report and confirm the same language set is selected.

## Completion Notes

- Tailwind 4 now powers the manager app through local `apps/manager` configuration, shared UI primitives in `src/components/ui`, and route-level Tailwind composition across shell, auth, coverage, jobs, and agents surfaces.
- `apps/manager/src/app/globals.css` has been reduced to tokens, theme mapping, base rules, and small browser-specific affordances rather than screen-level styling systems.
- Browser and route checks were completed for login, coverage, jobs, and agents on the local manager app. The current snapshot exposes no jobs, so a live `/dashboard/jobs/[id]` detail page could not be opened during this pass.
- The attached coverage language persistence follow-up is complete: bare Coverage defaults to English, custom language selections persist for the dashboard session, explicit query state wins, legacy `languageIds` links normalize to `languageId`, and clearing the final custom language resets back to English fallback behavior.
