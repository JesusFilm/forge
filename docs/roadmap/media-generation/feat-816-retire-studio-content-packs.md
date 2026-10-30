---
id: "feat-816"
title: "Retire Studio Content Packs"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-28"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, admin]
---

## Decision and scope

Owner retired Content Packs after a read-only production audit found zero packs,
zero revisions, zero assignments across 64 projects / 227 revisions and zero pack
links across 56 releases. Remove discovery, assignment, API and generation/planner
support. Sources come from each project's selected media; calendar planning keeps
weekly themes, title suggestions and manual overrides.

Implementation plan: `docs/plans/2026-10-28-retire-studio-content-packs.md`.
Remove contract fields and storage models outright, using a direct drop migration.
Do not rewrite historical project/release JSON or apply production changes locally.

## Verification

- Full migration chain, including `0163_retire_studio_content_packs`, applied to a
  fresh local Postgres database. No production writes or deployments.
- Studio contracts: 56 tests passed. Mastra planner/agent: 7 tests passed.
- Manager workspace/editor/agent: 22 tests passed; calendar startup: 1 test passed.
  Initial calendar calls fall from three to two (`calendar-read`, `list`);
  14 days rendered in 179 ms in jsdom (component smoke, not browser timing).
- Admin source/assets/commands/calendar/catalog/operations: 42 tests passed.
  Canonical publication/playback/Mux: 16 tests passed against the migrated DB.
- Admin SDL and admin-graphql introspection regenerated through their scripts.
- Touched implementation lint, formatting and `git diff --check` pass.
  Admin (all four shards), contracts and Mastra TypeScript pass. Manager typecheck remains blocked by
  existing `LanguageGeoSelector.tsx` image types and media-workspace test drag
  mock types; this removal introduces no new Manager errors.
- Portable `skills/shorts-creator` instructions/example updated; downloadable ZIP
  rebuilt and `skill:check` passes. Executable validation fixtures no longer emit
  the removed field. Historical trial evidence stays unchanged.
