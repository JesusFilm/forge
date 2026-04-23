---
id: "feat-106"
title: "Seed Studio Watch Parity Generator"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-04-22"
duration: 10
depends_on: []
blocks: []
tags:
  - "cms"
  - "web"
  - "watch"
  - "ai-pipeline"
---

## Problem

Seed Studio can already save generated experiences, but its output still falls
short of the production `/watch` experience shape. The generator produces a
flatter block structure than `/watch/easter`, preview support is incomplete for
the richer section wrappers and collection modules, and publish-time nested
video relation handling is easy to break when `sectionKey` or slug hygiene
falls out of sync. That makes the tool feel experimental instead of dependable
for real editorial use.

## Entry Points — Read These First

1. `docs/plans/2026-04-22-001-feat-seed-studio-watch-parity-plan.md` — plan,
   implementation units, and parity acceptance criteria
2. `apps/seed-studio/src/app/api/chat/route.ts` — search, generation, SSE, and
   fallback provider orchestration
3. `packages/experience-templates/src/template.ts` — canonical easter-shaped
   layout, archetypes, and `sectionKey` generation helpers
4. `packages/experience-templates/src/parity.ts` — structural diff logic for
   comparing generated experiences to the reference shape
5. `apps/seed-studio/src/components/preview/SectionRenderer.tsx` — preview
   coverage for section wrappers and nested content
6. `apps/cms/src/api/seed-studio/services/seed-studio.ts` — publish flow,
   nested video relation collection, and relation patching
7. `apps/cms/src/api/seed-studio/controllers/seed-studio.ts` — slug validation
   and publish error contract returned to the studio UI

## Grep These

- `supportsStrictJsonSchema|generateExperience|patch`
- `collectVideoRelations|patchNestedVideoRelations|sanitizeSlug`
- `sections.section|media-collection|navigation-carousel`
- `EASTER_SHAPED_TEMPLATE_LAYOUT|parityDiff|buildSectionKey`

## What To Build

1. Move the watch-parity section contract into
   `packages/experience-templates/` and make seed-studio consume it for shared
   types, alias normalization, template layout, and structural parity checks.
2. Upgrade the studio generation path to use the existing CMS search surface
   for candidate videos and the strict JSON Schema generator path where the
   selected provider supports it, while preserving the legacy free-form
   fallback.
3. Harden the CMS publish flow with central slug sanitization, deterministic
   nested video relation collection, and collision feedback that the seed-studio
   publish dialog can surface directly.
4. Add package-level parity tests and focused CMS publish-path tests so the new
   shared template package and nested relation behavior stay trustworthy.

## Constraints

- Keep canonical content modeling in `apps/cms`; do not invent a separate
  experience schema inside seed-studio.
- Preserve the existing seed-studio publish endpoint contract for current
  callers.
- Do not expand this scope into unrelated admin editor or login-copy work.
- If the CMS schema changes as part of this work, regenerate downstream GraphQL
  types in the same PR.

## Verification

- `pnpm --filter @forge/experience-templates lint`
- `pnpm --filter @forge/experience-templates typecheck`
- `pnpm --filter @forge/experience-templates test`
- `pnpm --filter @forge/seed-studio lint`
- `pnpm --filter @forge/seed-studio typecheck`
- `pnpm --filter @forge/cms lint`
- `pnpm --filter @forge/cms typecheck`
- `pnpm --filter @forge/cms test src/api/seed-studio/services/seed-studio.test.ts src/lib/sanitize-slug.test.ts`
