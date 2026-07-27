---
id: "feat-286"
title: "Experience create + generate tools for the JFP Admin MCP"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-07-27"
duration: 5
depends_on:
  - "feat-276"
blocks: []
tags:
  - "cms"
  - "admin"
  - "i18n"
  - "ai-pipeline"
---

## Problem

The Bulk Locale Factory MCP (feat-276) scoped deliberately to locales of _existing_ Experiences. Tataihono has asked for the next slice: creating brand-new Experiences through the MCP avenue instead of building more generation UI inside the admin app, with "translate the homepage into ~50 languages" as the driving workload. Today no MCP tool can create an Experience, and the AI-generation pipeline (quick-draft, personas, exemplars, normalization) is reachable only from admin's editor UI and operator scripts.

> **Sign-off:** Proposed to Tataihono per the proposal-first working agreement (plan: `docs/plans/2026-07-24-001-feat-experience-create-generate-mcp-tools-plan.md`). Pending his ruling; record it here (Slack or PR comment link) before deploy.

## Entry Points — Read These First

1. `docs/plans/2026-07-24-001-feat-experience-create-generate-mcp-tools-plan.md` — the implementation plan (requirements R1–R8, timeout chain, scope rationale).
2. `apps/admin/src/mcp/admin-mcp-tools.ts` — tool catalogue (`ADMIN_MCP_TOOLS`); new tools register here with name, description, `requiredScopes`, JSON input schema.
3. `apps/admin/src/app/mcp/route.ts` — JSON-RPC endpoint; dispatch if-chain; rate limit 120/min; 64KB body cap; typed JSON-RPC error mapping.
4. `apps/admin/src/services/experience-locale-mcp.service.ts` — service layer behind the 12 existing tools; the shape the new experience-level service mirrors.
5. `apps/admin/src/services/experience.service.ts` — `create()` (new Experience + initial DRAFT locale, caller becomes owner, `write:experiences` check, blocks validation, ContentRevision snapshot).
6. `apps/admin/src/app/dashboard/experiences/` generate-variant server action + `apps/admin/src/scripts/generate-persona-variants.ts` — the generation composition to lift: candidates → mastra → normalize → create.
7. `apps/admin/src/services/experience-ai/experience-ai-normalize.ts` — `normalizeExperienceDraft`, the mandatory schema/grounding gate.
8. `apps/auth/src/domain/scopes.ts` + `apps/auth/src/domain/apps.ts` — scope registry and the Admin MCP grant seed.

## Grep These

- `ADMIN_MCP_TOOLS` in `apps/admin/src/mcp/`
- `requiredScopes` in `apps/admin/src/mcp/admin-mcp-tools.ts`
- `callAdminMcpTool` in `apps/admin/src/app/mcp/route.ts`
- `experience:locale:create` in `apps/auth/src/domain/scopes.ts` (the registration pattern to mirror)
- `ADMIN_MCP_DEFAULT_SCOPES` in `apps/auth/src/domain/apps.ts`
- `normalizeExperienceDraft` in `apps/admin/src/services/experience-ai/`
- `loadExperienceAiVideoCandidates` in `apps/admin/src/`
- `MASTRA_DRAFT_TIMEOUT_MS` in `apps/admin/src/config/env.ts`
- `resolveTimeoutMs` in `apps/admin/src/`

## What To Build

Two experience-level MCP primitives plus their OAuth scopes:

1. **`experience.create`** (scope `experience:create`): client-supplied draft `{locale, slug, title, blocks, optional meta}` → new DRAFT Experience via `ExperienceService.create`; owner = delegated principal; revision records MCP provenance. Validated by the same schemas as the editor.
2. **`experience.generate`** (scope `experience:generate`): `{topic, locale, personaId?, exemplarExperienceId?}` → server-side chain `loadExperienceAiVideoCandidates` → mastra quick-draft (`/forge-experience-variant` when `personaId` present, `/forge-experience-draft` otherwise) → `normalizeExperienceDraft` → `ExperienceService.create` as DRAFT. Reuses the hardened node:http client, typed failure envelopes, and `resolveTimeoutMs` guard.
3. Scope registration in `apps/auth` (registry + consent metadata + `ADMIN_MCP_DEFAULT_SCOPES`), mirroring the eight feat-276 scopes.
4. New sibling service `apps/admin/src/services/experience-mcp.service.ts` mirroring the locale service's shape (Zod input schemas, principal threading, typed errors).
5. Docs: skill reference, `apps/admin/CLAUDE.md` MCP section, `/dashboard/mcp` starter copy if it enumerates tools.

## Constraints

- Primitives only: no bulk-create or bulk-generate server operation; fan-out (many topics/languages) stays in the client agent loop.
- DRAFT only: neither tool publishes or implies publish authority. Publishing remains exclusively `experience.locale.publish` + `experience:publish` + explicit user instruction + ABAC.
- Quick mode only for generation in v1: the multi-step workflow (~180s) cannot fit Cloudflare's ~100s proxy window; quick (~60s mastra budget) fits with margin. Mode is not client-selectable.
- Timeout chain ordered end-to-end: mastra internal budget < admin→mastra client timeout < ~100s transport ceiling, so the MCP caller always gets a structured failure, never a severed connection.
- Two separate scopes: `experience:generate` spends paid AI tokens and must be grantable/revocable independently of `experience:create`.
- No new mastra routes, no persona roster changes, no admin editor UI changes, no GraphQL schema changes, no changes to the 12 existing tools' contracts.
- Generation config absence (`MASTRA_BASE_URL`/`MASTRA_SERVICE_API_KEY` unset) degrades to a `config_missing` tool error — never a deploy-time requirement (`.optional()` env law).
- Byte-cap the buffered mastra response; size caps at 3 bytes per UTF-16 code unit (non-Latin scripts).
- Deploy order: apps/auth (scopes + grant) deploys FIRST, then apps/admin (tools). Users re-authenticate MCP clients to pick up new consent scopes.

## Verification

- Auth + admin suites pass (`pnpm --filter @forge/auth test`, `pnpm --filter @forge/admin test`).
- Route tests prove scope enforcement fires BEFORE dispatch for both tools; missing scope → -32003 naming the required scope.
- A real MCP client against local admin can `experience.create` a draft visible in the dashboard editor; nothing appears on the public site (no publish side effects).
- With mastra running, `experience.generate` returns a draft grounded in real videos within the quick-mode budget; with mastra stopped, it fails `config_missing`/network cleanly and admin stays healthy.
- A generated/created DRAFT is readable via `experience.locale.read` and passes `experience.locale.validate` (tools compose with the feat-276 loop).
- Tataihono's sign-off recorded above before production deploy.
