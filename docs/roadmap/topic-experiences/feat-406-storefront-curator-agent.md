---
id: "feat-406"
title: "Storefront Curator Agent"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-08-21"
duration: 5
depends_on: []
blocks: []
tags:
  - "admin"
  - "experiences"
  - "mastra"
  - "mcp"
  - "i18n"
  - "ai-pipeline"
---

## Problem

The public Watch homepage is an editorial storefront, but its Experience is
refreshed manually and can go stale while new videos, collections,
translations, languages, and seasonal opportunities enter the catalog. Forge
needs a bounded Mastra curator that can inspect Admin through MCP and prepare a
fresh homepage draft without silently changing live public content.

## Entry Points — Read These First

1. `apps/mastra/src/mastra/agents/storefront-curator-agent.ts` - private,
   structured, zero-tool model contract.
2. `apps/mastra/src/mastra/workflows/storefront-homepage-curation.ts` and
   `storefront-homepage-curation-route.ts` - deterministic workflow and protected
   operator entry point.
3. `apps/mastra/src/services/storefront-admin-mcp-client.ts` - bounded MCP/OAuth
   transport and operation-specific retries.
4. `apps/admin/src/mcp/admin-mcp-tools.ts` and
   `apps/admin/src/app/mcp/route.ts` - OAuth-protected Admin MCP catalogue and
   dispatch.
5. `apps/admin/src/services/experience-locale-mcp.service.ts` - minimal homepage
   context, guarded staging, validation, preview, and media primitives.
6. `apps/admin/src/domain/blocks.ts` - block contract the curator preserves.
7. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` - how homepage
   Experience blocks are rendered below the Watch hero.

## Grep These

- `storefront.homepage.context`
- `storefront.homepage.stage`
- `stage_outcome_unknown`
- `experience.locale.preview`
- `isHomepage`
- `STOREFRONT_CURATOR_SCHEDULE_ENABLED`
- `STOREFRONT_CURATOR`

## What To Build

1. A private, zero-tool Storefront Curator agent receives bounded evidence from
   deterministic workflow code. It is deliberately absent from Mastra's agent
   registry and cannot call Admin directly.
2. A default-off workflow starts with an English-only locale allowlist, checks
   model readiness before Admin, discovers the canonical homepage, validates a
   bounded decision, and optionally stages one shared `ExperienceLocale` draft.
   Its weekly Monday schedule has a separate default-false enable flag.
3. Manual execution uses the dedicated-bearer
   `POST /forge-storefront-curation` operator route. All built-in native routes
   for this workflow are denied; the same dedicated bearer can list and inspect
   bounded sanitized stored-run summaries through the custom operator surface.
4. Admin MCP returns minimal read-only homepage context without draft content or
   preview capability. Collection parents and leaf videos follow distinct
   validation paths, and only deterministic workflow code owns writes.
5. Stage attempts carry an `operationId` and candidate digest. An ambiguous
   response is reconciled against exact Admin draft attribution or reported as
   `stage_outcome_unknown`; the stage write is never retried.
6. The locale input remains explicit and schema-backed for later Russian,
   Spanish, French, and other supported-locale pilots without workflow copies.

## Constraints

- The schedule and all writes are independently default-off until model/Admin
  credentials are provisioned and an operator enables each gate.
- Automated runs stage drafts only. Publication continues to require a human, the separate `experience:publish` scope, and Admin ABAC.
- V1 schedules English only; the implementation must accept any Admin-supported locale without hard-coded translated copy.
- Never invent video, language, Experience, or collection identifiers. Every
  selection must originate in MCP evidence; collection parents must come from
  Admin's playable collection inventory and leaf videos must pass language-aware
  media validation.
- Always preserve an existing human or prior-agent active draft. The workflow
  has no replacement override.
- The curator's OAuth grant must contain only `offline_access`,
  `experience:read`, `video:read`, `media:read`,
  `experience:locale:validate`, and `storefront:homepage:stage`; the operator
  verifies the issued token excludes `experience:publish` despite broad seeded
  Admin MCP client defaults.
- Mastra must not import Admin application code or database types.
- No production deploy outside the normal PR-to-main flow.

## Verification

- [x] Focused Admin tests cover minimal context, no preview-token mutation or
      leak, authorization-before-query, normalized digest verification, attributed
      staging, active-draft refusal, concurrent canonical refusal, and MCP
      registry/dispatch parity.
- [x] Focused Mastra tests cover the private/unregistered zero-tool agent,
      protected operator route, native-route denial, independent schedule flag,
      English locale default, model readiness, bounded response reads and retries,
      collection-aware validation, first-curator-slot replacement, staging, and
      ambiguous-response reconciliation.
- [x] The run contract distinguishes `candidateDiffers`, `draftStaged`, legacy
      `changed`, and `writeOutcome`, including `stage_outcome_unknown`.
- [ ] Operational rollout gate: obtain three consecutive Watch Editorial
      on-call approvals in `#watch-editorial`, then perform one connected English
      stage smoke and review its Admin preview. This is intentionally not performed
      by the PR's local/unit validation.

## Completion Notes

- Added the private, unregistered `storefront-curator-agent` and default-off
  English homepage workflow. The model has no tools; deterministic code supplies
  evidence and owns Admin MCP access.
- Added minimal Admin context and guarded, operation-attributed staging. Human
  blocks retain their relative order; curator replacements occupy the first
  prior curator slot; collection parents are validated from collection evidence
  while leaf media still receives language-aware checks.
- Added a dedicated, fail-closed operator bearer route, native-route denial,
  English locale allowlist, separate schedule flag, provider readiness gate,
  bounded reads, operation-specific retries, and ambiguous-commit
  reconciliation. Storefront runs never publish or discard.
- Documented the exact OAuth scope, issued-token verification, three-run English
  editorial acceptance gate, active-draft/unknown-outcome disposition, rollback,
  and multilingual rollout in `docs/runbooks/storefront-curator-agent.md`.
- Feature implementation is complete. Connected staging and schedule activation
  remain post-merge operational rollout gates, not PR completion criteria.
