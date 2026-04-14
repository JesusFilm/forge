---
id: "feat-091"
title: "Build Forge admin dashboard UI"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-14"
duration: 2
depends_on:
  - "feat-086"
blocks: []
tags:
  - "platform"
  - "admin"
  - "ui"
  - "tailwind"
---

## Problem

The admin app backend is implemented, but the operator-facing UI is still placeholder markup. Unit 12 needs the Forge Editorial design system, a shared dashboard shell, and the first production-facing admin pages so editors can navigate the app without placeholder scaffolding.

## Entry Points — Read These First

1. `docs/handoffs/2026-04-14-admin-ui-codex-handoff.md`
2. `apps/admin/AGENTS.md`
3. `apps/admin/CLAUDE.md`
4. `apps/admin/src/app/layout.tsx`
5. `apps/admin/src/app/login/page.tsx`
6. `apps/admin/src/app/dashboard/page.tsx`
7. `apps/admin/src/app/dashboard/system-status/page.tsx`

## Grep These

- `Placeholder UI|Placeholder. Authenticated-state UI`
- `requireSession`
- `list_design_systems|get_screen`
- `IBM_Plex|tailwindcss|lucide-react`

## What To Build

1. Install Tailwind CSS v4 for `apps/admin` and wire a `globals.css` file that encodes the Forge Editorial tokens and shared UI primitives.
2. Update the root layout to load IBM Plex Sans and IBM Plex Mono with `next/font/google`.
3. Add a dashboard shell wrapping `/dashboard/*` with the sidebar, top bar, active-nav treatment, dense cards, and mono-heavy metadata.
4. Restyle `/login` without changing auth behavior.
5. Build the dashboard overview, experiences index, videos index, and the remaining sidebar routes as operational admin surfaces using the Stitch screen references.

## Constraints

- Do NOT modify `apps/admin/src/auth/`, `src/graphql/`, `src/services/`, `src/db/`, `src/domain/`, `src/config/`, or `prisma/`.
- Do NOT change existing auth API behavior on `/login`; JSX and styling only.
- Prefer Stitch screens titled `(Final)` over `(Unified Nav)` when both exist.
- Keep brand red constrained to a single primary action per viewport.

## Verification

- `pnpm --filter @forge/admin build`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
