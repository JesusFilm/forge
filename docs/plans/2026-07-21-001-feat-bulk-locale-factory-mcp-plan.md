---
title: "Build the Bulk Locale Factory MCP"
type: "feature-plan"
status: "active"
date: "2026-07-21"
roadmap: "docs/roadmap/topic-experiences/feat-276-bulk-locale-factory-mcp.md"
requirements: "docs/brainstorms/2026-07-21-bulk-locale-factory-mcp-requirements.md"
owner: "tataihono"
priority: "P1"
---

# Build the Bulk Locale Factory MCP

## Goal

Build an OAuth-protected MCP surface in Admin that lets a bring-your-own-AI client create, validate, adapt, update, and publish Experience locales quickly. The AI client owns the bulk loop. Admin owns source-of-truth data, authorization, validation, media availability, audit trails, and publish enforcement.

The first deliverable is the Bulk Locale Factory, not the full Experience Editor MCP. Tool names and scope boundaries should leave room for the broader editor later.

## Requirements Trace

- R1-R5: expose small MCP primitives so external AI clients can run bulk locale creation across many Experiences and locales without an Admin-owned background job.
- R6-R9: publish a Codex skill that drives translation/adaptation policy, the working loop, QA rubrics, MCP tool usage, and publish gates. The skill must not store live Experience data.
- R10-R13: default to locale-aware adaptation that preserves intent, required schema shape, scripture references, editorial constraints, and non-translatable identifiers.
- R14-R18: detect video/media availability for the target locale, prefer target-language audio, accept target-language subtitles where appropriate, replace videos when viable, and hide/remove video-heavy blocks when no acceptable alternative exists.
- R19-R23: provide read, create, update, validate, diff, media, video, Bible, and publish capabilities through explicit MCP tools.
- R24-R31: make the MCP OAuth-able with the agreed scopes: `experience:read`, `experience:locale:create`, `experience:locale:update`, `experience:locale:validate`, `media:read`, `video:read`, `bible:read`, and `experience:publish`. Publish is a separate scope and must never be implied by create/update scopes. `experience:locale:update` may update any authorized ExperienceLocale, not only locales created in the current run.
- R32-R34: keep writes and publishes auditable, produce run summaries, and allow AI publish only after validation, explicit user instruction, `experience:publish`, and Admin ABAC permission.

## Current System Facts

- Admin is the canonical owner for Experiences and locales.
- `apps/admin/prisma/schema.prisma` has `Experience` with language-agnostic fields and `ExperienceLocale` rows keyed by unique `[experienceId, locale]`.
- `apps/admin/src/services/experience.service.ts` already has `createLocale`, `updateLocale`, and `publishLocale` service methods. UI server actions use them from `apps/admin/src/app/dashboard/experiences/[id]/page.tsx`.
- `apps/admin/src/graphql/mutations/experience.ts` exposes `updateExperienceLocale` and `publishExperienceLocale` but not `createExperienceLocale`; the MCP can use the service layer directly.
- `apps/admin/src/domain/blocks.ts` and `apps/admin/src/services/experience.schemas.ts` are the validation source for locale block payloads.
- Current agent tools live under `apps/admin/src/app/api/internal/agent-tools/` and `apps/admin/src/services/experience-ai/agent-tools.service.ts`. Their bearer auth is for server-to-server Mastra use and should not be reused for delegated OAuth MCP access.
- `apps/admin/src/services/search-watchability.ts` already classifies video availability as `target_audio`, `target_subtitle`, `related_language`, or `unavailable`.
- `apps/auth/src/domain/scopes.ts`, `apps/auth/src/domain/apps.ts`, `apps/auth/src/services/oauth-policy.service.ts`, and `apps/auth/src/services/token-policy.service.ts` are the Auth-side places to extend first-party OAuth grants and scope validation.
- `apps/admin/src/auth/oauth-client.ts` verifies Admin browser OAuth tokens. The MCP should have a separate resource verifier with its own audience/resource checks.

## External References

- [MCP Authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization): treat the HTTP MCP server as an OAuth resource server; require bearer tokens on requests; validate token audience/resource and scopes; publish protected resource metadata; require PKCE for public clients.

## Key Decisions

1. Host the MCP in `apps/admin`, because Admin owns Experience data, service-layer validations, ABAC, revision history, media state, and watchability data.
2. Keep the MCP tool layer thin. Tools gather data, validate drafts, and call existing Admin services. The external AI client performs orchestration, batching, retries, and translation.
3. Add a first-party JFP Admin MCP OAuth registration in Auth with narrow resource scopes. `experience:publish` is allowed for trusted Admin operators but remains a distinct, explicitly granted scope.
4. Verify MCP OAuth tokens as resource tokens, not Admin browser-login tokens. The verifier must enforce issuer, audience/resource, environment, expiry, revocation policy where available, and required scopes.
5. Map delegated OAuth requests back to an Admin user/principal before touching Experience data. Existing Admin ABAC remains the final edit/read authority.
6. Model media decisions as structured validation output: keep, replace, remove, or warn. Do not silently drop video blocks.
7. Preserve asset IDs and resolve URLs at read boundaries, following the existing Admin media-picker pattern.
8. Ship the Codex skill as repo-owned source under `skills/forge-bulk-locale-factory/`, with references for policy, JFP Admin MCP tools, QA, and publish gates. The skill stores durable instructions, not live locale content.
9. Publish the skill for Admin-side operators through the team's Codex skill distribution path so users can run the same factory loop without rebuilding prompts by hand.

## Implementation Units

### Unit 1: Auth Scopes and First-Party Admin MCP App Registration

Files:

- `apps/auth/src/domain/scopes.ts`
- `apps/auth/src/domain/scopes.test.ts`
- `apps/auth/src/domain/apps.ts`
- `apps/auth/src/domain/apps.test.ts`
- `apps/auth/src/scripts/seed-first-party-apps.test.ts`

Work:

- Add the eight Bulk Locale Factory scopes with clear consent labels and descriptions.
- Add a first-party app registration for the broader JFP Admin MCP resource/client, separate from Admin browser access and intentionally not named after Experiences.
- Ensure trusted Admin operator grants can include locale factory read/create/update/validate/media/video/Bible scopes plus `experience:publish`, while lower-trust grants can still omit publish.
- Keep token policy validation rejecting unknown scopes and respecting environment-bound app grants.

Verification:

- Unit tests for known-scope validation, scope descriptions, app seed shape, grant variants, and publish scope isolation from create/update.

### Unit 2: Admin MCP OAuth Resource Verification

Files:

- `apps/admin/src/auth/mcp-oauth.ts`
- `apps/admin/src/auth/mcp-oauth.test.ts`
- `apps/admin/src/config/env.ts`
- `apps/admin/src/config/env.test.ts`
- `apps/admin/src/auth/principal.ts`
- `apps/admin/src/auth/principal.test.ts`

Work:

- Add env config for Auth issuer, MCP audience/resource identifier, JWKS discovery, and accepted environments.
- Implement bearer parsing and JWT verification for MCP requests.
- Enforce required scopes per tool call.
- Map the delegated Auth subject to an Admin principal with the same user-level ABAC checks used by the editor.
- Return structured auth failures: unauthenticated, insufficient scope, invalid audience/resource, inactive user, or forbidden by Admin permissions.

Verification:

- Tests for missing token, malformed token, expired token, wrong audience, missing scope, environment mismatch, and valid delegated editor access.

### Unit 3: MCP HTTP Transport and Tool Registry

Files:

- `apps/admin/src/app/mcp/route.ts`
- `apps/admin/src/app/.well-known/oauth-protected-resource/route.ts`
- `apps/admin/src/mcp/admin-mcp-server.ts`
- `apps/admin/src/mcp/admin-mcp-tools.ts`
- `apps/admin/src/mcp/admin-mcp-errors.ts`
- `apps/admin/src/app/mcp/route.test.ts`

Work:

- Build the HTTP MCP entrypoint using the existing MCP dependency already available to Admin.
- Publish protected resource metadata for OAuth-capable MCP clients.
- Register tools with stable names, descriptions, input schemas, output schemas, and required scopes.
- Apply existing Admin patterns for request size limits, rate limiting, JSON error shapes, and observability.

Initial tool set:

- `experience.list`
- `experience.locale.list`
- `experience.locale.read`
- `experience.locale.missing`
- `experience.locale.validate`
- `experience.locale.diff`
- `experience.locale.create`
- `experience.locale.update`
- `experience.media.check`
- `video.search_replacements`
- `bible.lookup`
- `experience.locale.publish`

Verification:

- Route tests for MCP metadata, unauthorized calls, scope-gated calls, schema validation errors, and successful tool dispatch.

### Unit 4: Locale Read, Missing, Validate, and Diff Primitives

Files:

- `apps/admin/src/services/experience-locale-mcp.service.ts`
- `apps/admin/src/services/experience-locale-mcp.service.test.ts`
- `apps/admin/src/mcp/experience-locale-tools.ts`
- `packages/experience-schema/src/experience-ai.schemas.ts`

Work:

- Provide compact read models for Experiences and ExperienceLocales suitable for AI clients.
- Add missing-locale discovery by source locale and target locale list.
- Validate incoming locale drafts with existing `BlocksSchema` and locale input schemas.
- Return actionable validation output: schema errors, missing required fields, unlocalized text hints, invalid slugs, duplicate locale conflicts, and media availability warnings.
- Produce machine-readable diffs between source and target locales so the skill can review deltas.

Verification:

- Tests for locale missing discovery, schema validation, duplicate locale handling, nested block validation, and diff output stability.

### Unit 5: Locale Create/Update Writes and Audit Provenance

Files:

- `apps/admin/src/services/experience.service.ts`
- `apps/admin/src/services/experience.service.test.ts`
- `apps/admin/src/services/experience-locale-mcp.service.ts`
- `apps/admin/src/services/experience-locale-mcp.service.test.ts`
- `apps/admin/src/mcp/experience-locale-tools.ts`

Work:

- Reuse `ExperienceService.createLocale` and `ExperienceService.updateLocale` for writes.
- Extend service write options only where needed to capture MCP provenance, prompt/run identifiers, source locale, target locale, and reason text.
- Mark MCP-authored revisions as `revisedByKind: "AI"` while preserving the delegated user identity in `revisedBy`.
- Add an MCP publish path that calls `ExperienceService.publishLocale` only after validation succeeds, the token has `experience:publish`, the user explicitly requested publish, and Admin ABAC permits it.
- Make writes idempotent enough for AI retries: create should report an existing locale conflict with the current locale id, and update should require the target locale id or an optimistic revision timestamp.

Verification:

- Tests for create, update, publish, conflict handling, permission denial, AI revision provenance, and no publish without validation/scope/explicit instruction.

### Unit 6: Video and Media Availability Tools

Files:

- `apps/admin/src/services/experience-locale-media-availability.ts`
- `apps/admin/src/services/experience-locale-media-availability.test.ts`
- `apps/admin/src/services/search-watchability.ts`
- `apps/admin/src/services/watch-search.service.ts`
- `apps/admin/src/mcp/experience-media-tools.ts`
- `apps/admin/src/services/experience-ai/agent-tools.service.test.ts`

Work:

- Walk Experience blocks recursively and extract video references from `video`, `videoHero`, `videoCarousel`, `mediaCollection`, nested `section`, and nested `container` blocks.
- Reuse `SearchWatchabilityService.hydrate` to classify each referenced video for the target locale.
- Return per-block recommendations: keep for target audio, keep-with-subtitle-warning for target subtitles, replace for unavailable/unsuitable media, or hide/remove when no acceptable alternative exists.
- Use `WatchSearchService` for replacement candidates, including availability metadata in the MCP output.
- Keep media asset checks separate from video watchability checks so future image/audio asset rules can evolve independently.

Verification:

- Tests for nested block traversal, target-audio keep, subtitle fallback warning, unavailable replacement recommendation, hide/remove recommendation, and stable output for blocks with no media.

### Unit 7: Codex Skill Source and Publication

Files:

- `skills/forge-bulk-locale-factory/SKILL.md`
- `skills/forge-bulk-locale-factory/references/mcp-tool-contract.md`
- `skills/forge-bulk-locale-factory/references/translation-policy.md`
- `skills/forge-bulk-locale-factory/references/block-preservation-rules.md`
- `skills/forge-bulk-locale-factory/references/media-replacement-policy.md`
- `skills/forge-bulk-locale-factory/references/quality-rubric.md`
- `skills/forge-bulk-locale-factory/references/publish-policy.md`
- `docs/operations/codex-skills.md`

Work:

- Create a Codex skill that runs the loop: discover missing locales, read source, prepare target draft, check media, replace or remove unsuitable video blocks, validate, write, optionally publish, diff, and produce a review summary.
- Encode policy and rubrics in references rather than embedding live Experience data.
- Include tool preconditions, retry behavior, validation gates, publish gates, and required human review outputs.
- Make the skill opinionated about when to stop and ask for editorial input: scripture ambiguity, missing core CTA intent, no viable media replacement, or high-risk theological adaptation.
- Document and automate the internal publication path for the skill so Admin-side operators can install or receive updates from the versioned repo source.

Verification:

- Manual skill review against the skill-creator guidelines: concise description, deterministic workflow, no live data, references only where useful, publish gate explicit, and MCP contract aligned with implemented tool names.

### Unit 8: Operator Docs, Smoke Tests, and Rollout

Files:

- `docs/operations/bulk-locale-factory-mcp.md`
- `apps/admin/CLAUDE.md`
- `apps/auth/CLAUDE.md`
- `docs/roadmap/topic-experiences/feat-276-bulk-locale-factory-mcp.md`

Work:

- Document OAuth setup, allowed scopes, local development setup, tool list, and example AI-client loop.
- Add a local smoke script or test fixture that exercises OAuth verification, locale read, validate, media check, create, update, publish denial without scope, and publish success with scope.
- Update package guides with the MCP boundary: Admin data owner, Auth token owner, skill owns loop policy.
- Complete the roadmap ticket only after implementation and verification land.

Verification:

- Run package-scoped tests for Auth and Admin.
- Run format/typecheck for touched packages.
- Run the MCP smoke path with a fixture token or test verifier.

## Risks and Mitigations

- Risk: the Admin MCP app drifts into broad Admin power.
  - Mitigation: keep resource scopes separate from `admin:access`; enforce per-tool scopes and Admin ABAC.
- Risk: AI writes invalid or subtly broken blocks.
  - Mitigation: all write tools validate with existing schemas before persistence; validation output is available before create/update.
- Risk: video replacement becomes subjective and inconsistent.
  - Mitigation: MCP returns availability facts and candidate metadata; the skill applies documented policy and reports every replacement/removal.
- Risk: hidden publish automation bypasses editorial judgment.
  - Mitigation: publish requires `experience:publish`, explicit user instruction, successful validation, Admin ABAC, and an audit reason.
- Risk: full Experience Editor MCP scope swallows the Bulk Locale Factory.
  - Mitigation: keep this plan's tool set locale-focused while naming scopes and services for later extension.

## Validation Command Set

Run the final command set after implementation, adjusting package filters if files move:

```bash
pnpm --filter @forge/auth test -- scopes apps token-policy oauth-policy seed-first-party-apps
pnpm --filter @forge/admin test -- mcp-oauth experience-locale-mcp experience-locale-media-availability experience.service search-watchability route
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/auth typecheck
pnpm format:check
```

## Confidence Review

Confidence: 8/10.

Why:

- The plan reuses existing Admin Experience services, block schemas, ContentRevision provenance, Auth scope policy, and watchability services.
- The biggest unknown is the exact MCP HTTP adapter API for the installed `@mastra/mcp` / MCP SDK versions; this should be resolved in Unit 3 before broad tool implementation.
- The other meaningful uncertainty is how Auth wants to represent the MCP as a first-party app/resource. Unit 1 isolates that decision before Admin depends on it.

## Planning Review Notes

- Coherence: scope names, requirements, implementation units, and verification all align around Bulk Locale Factory first.
- Feasibility: no raw DB write path is required; all writes can go through Admin service methods with small provenance extensions.
- Security: OAuth/resource verification and per-tool scope enforcement are explicit early units, and publishing is intentionally scope-gated and auditable.
- Product scope: full Experience Editor MCP is preserved as a future path without forcing editor-wide tools into this milestone.
