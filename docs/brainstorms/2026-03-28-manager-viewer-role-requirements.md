---
date: 2026-03-28T00:00:00.000Z
topic: manager-viewer-role
---

# Viewer Role for Manager App

## Problem Frame

The manager app currently has a single "Manager" role with full access to all features (job creation, job queue, coverage reports). Stakeholders who need to monitor translation coverage cannot access the system without receiving full write access, including the ability to create expensive enrichment jobs.

## Requirements

- R1. A new "Viewer" role is created in Strapi's Users & Permissions system
- R2. Users with the "Viewer" role can log in to the manager app and see the coverage report (`/dashboard/coverage`)
- R3. The jobs page (`/dashboard/jobs`) is completely hidden from Viewer users — no nav link, no direct URL access
- R4. If a Viewer navigates directly to `/dashboard/jobs` or `/dashboard/jobs/*`, they are redirected to `/dashboard/coverage`
- R5. The "Manager" role retains full access to all existing features (no regression)

## Success Criteria

- A Viewer user can log in, view the coverage report, and filter/interact with it normally
- A Viewer user cannot see, access, or create jobs through any path
- Existing Manager users are unaffected

## Scope Boundaries

- **Not in scope:** Granular per-feature permissions framework. This is a simple two-role system.
- **Not in scope:** Admin/super-admin distinctions within the manager app
- **Not in scope:** Changes to the web or mobile apps (public, no auth)
- **Not in scope:** New UI for role management — roles are managed in Strapi admin panel

## Key Decisions

- **Role name: "Viewer"** — generic enough to extend to future read-only views without renaming
- **Jobs page fully hidden** — not read-only access, but completely inaccessible (no nav link, redirects on direct access)
- **Strapi-managed roles** — no custom role table; uses existing Users & Permissions plugin roles

## Dependencies / Assumptions

- The Strapi Users & Permissions plugin supports custom role names (confirmed — "Manager" is already a custom role)
- The "Viewer" role must be created manually in Strapi admin (Settings > Users & Permissions > Roles)

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Technical] Should the dashboard nav be dynamically built from role permissions, or is a simple role-name check sufficient for two roles?
- [Affects R4][Technical] Should the redirect logic live in Next.js middleware or in a layout-level server component guard?

## Next Steps

-> `/ce:plan` for structured implementation planning
