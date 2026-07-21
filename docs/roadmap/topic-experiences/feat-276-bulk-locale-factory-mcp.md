---
id: "feat-276"
title: "Bulk Locale Factory MCP and Codex skill"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-08-15"
duration: 21
depends_on: []
blocks: []
tags:
  - "cms"
  - "admin"
  - "i18n"
  - "ai-pipeline"
---

## Problem

Editors need to create, repair, and publish additional Experience locales quickly using bring-your-own AI. A plain translation pass is insufficient: target locales must preserve editorial intent, validate against current Admin block rules, avoid unavailable target-language videos/media, and only publish through explicit scoped authorization.

## Entry Points — Read These First

1. `docs/brainstorms/2026-07-21-bulk-locale-factory-mcp-requirements.md` — product requirements, scope boundaries, OAuth scope model, and skill/MCP division of labor.
2. `apps/admin/src/services/experience.service.ts` — current create/update/publish service boundaries and ABAC checks for ExperienceLocale.
3. `apps/admin/src/services/experience.schemas.ts` — current create/update input validation and BlocksSchema boundary.
4. `apps/admin/src/app/dashboard/experiences/[id]/page.tsx` — existing UI server actions for create/update/publish locale behavior.
5. `apps/admin/src/app/api/internal/agent-tools/` — existing bearer-gated agent tool receiver pattern for video, Bible, and image lookups.
6. `apps/admin/src/services/experience-ai/agent-tools.service.ts` — current agent-facing video/scripture/media context helpers.
7. `packages/experience-schema/src/experience-ai.schemas.ts` — shared AI draft schema contract.

## Grep These

- `createLocale` in `apps/admin/src/services/experience.service.ts` and `apps/admin/src/app/dashboard/experiences/[id]/page.tsx`
- `canEditExperienceLocale` in `apps/admin/src/`
- `BlocksSchema` in `apps/admin/src/domain/blocks.ts`
- `agent-tools` in `apps/admin/src/app/api/internal/agent-tools/`
- `ADMIN_AGENT_TOOLS_API_KEYS` in `apps/admin/src/`
- `ExperienceLocale` in `apps/admin/prisma/schema.prisma`
- `videoId` and `locale` in `apps/admin/src/domain/blocks.ts`

## What To Build

Plan and implement an OAuth-protected remote MCP surface plus a Codex skill for Bulk Locale Factory:

1. MCP read tools for listing Experiences/locales, reading source locale content, finding missing target locales, and reading relevant video/media/scripture context.
2. MCP validation/diff tools for target-locale block validity, media availability, scripture/reference validity, and source-vs-target change summaries.
3. MCP write tools for creating and updating draft ExperienceLocale rows through Admin-owned service boundaries.
4. OAuth scope enforcement using resource-centered scopes:
   - `experience:read`
   - `experience:locale:create`
   - `experience:locale:update`
   - `experience:locale:validate`
   - `media:read`
   - `video:read`
   - `bible:read`
   - `experience:publish`
5. Trusted Bulk Locale Factory grants may include `experience:publish`, but publish remains separate from create/update and requires explicit user instruction.
6. Codex skill `forge-bulk-locale-factory` that drives the external-agent loop, stores durable localization policy, and uses MCP for live data/validation/writes.
7. Media availability behavior that replaces unavailable target-locale videos when strong replacements exist, removes weak video lists from the draft content when necessary, and reports every material change for editor review.

## Constraints

- The MCP must expose primitives; do not hide the workflow in a single bulk-create operation.
- Live Experience content must stay in Admin and be fetched through MCP, not stored in the Codex skill.
- `experience:locale:update` allows updating any locale the authenticated user may edit; do not restrict it to current-run-created locales.
- Every write must pass OAuth scope checks, Admin ABAC, and current block validation.
- The flow must not publish locales without explicit user instruction, successful validation, `experience:publish`, and Admin ABAC permission.
- Do not pass MCP client OAuth tokens through to downstream Admin APIs.
- Insufficient-scope failures must name the minimum required scope set for the attempted operation.
- External-agent tools must have bounded payload sizes and request limits.
- Do not hand-edit generated GraphQL env/type outputs.

## Verification

- An OAuth-authenticated MCP client with a trusted Bulk Locale Factory grant can create, update, validate, and publish locales when explicitly instructed.
- A client can discover missing locales for a batch of Experiences.
- A client can read a source locale, validate a generated target draft, and persist it as a draft through Admin service boundaries.
- Video-bearing blocks are checked for target-locale availability; unavailable videos are replaced or removed according to policy and surfaced in the final report.
- Existing ABAC tests or new equivalents prove a scoped MCP token cannot update a locale the user cannot edit.
- The Codex skill can run a one-experience, one-target-locale smoke workflow using MCP tools and produce a summary with created/updated/skipped/failed/warning states.
