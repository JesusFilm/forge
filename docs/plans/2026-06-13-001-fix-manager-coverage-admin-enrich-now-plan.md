---
title: "Fix Manager coverage Admin Enrich Now"
type: fix
status: completed
date: 2026-06-13
origin: docs/roadmap/media-generation/feat-186-manager-coverage-admin-enrich-now.md
---

# Fix Manager Coverage Admin Enrich Now

## Summary

Restore live Admin-backed enrichment job creation from the Manager Coverage
dashboard. The current UI sends Admin language/video IDs, but `/api/enrich`
still validates and behaves like the retired CMS/Core-ID path. The fix keeps
the coverage UI's Admin IDs, resolves them server-side into enrichment-ready
metadata, and preserves the existing Mux materialization behavior.

## Problem Frame

The visible production symptom is `Validation failed` after selecting English
and clicking `Enrich Now`. The request fails because `targetLanguageIds`
rejects Admin language IDs longer than 10 characters. A second blocker sits
behind that validation guard: admin mode currently returns the retired-CMS
`410` instead of creating jobs. Fixing only the max length would move users to
the next failure instead of restoring the workflow.

## Requirements

- `/api/enrich` accepts selected Admin language IDs and existing short/Core
  language IDs without breaking mock mode.
- Admin-backed language selections resolve to workflow language codes such as
  `en`, `fr`, and `es`.
- Admin-backed selected videos resolve to enrichment video metadata by selected
  coverage ID, whether that ID is a Core ID or an Admin document ID.
- Existing `materializeEnrichmentTargetForJob()` behavior stays in use so
  `MUX_ENRICHMENT_FORCE_STAGE_CLONE` and direct Mux reuse keep their current
  semantics.
- Per-video failures remain in the existing route response shape.
- Coverage UI feedback displays a useful failure detail instead of only the
  top-level `"Validation failed"` string.

## Scope Boundaries

In scope:

- Admin Manager read-model additions for language metadata and selected video
  enrichment metadata.
- Manager AdminGraphQL client support for those read models.
- `/api/enrich` admin-mode job creation.
- Focused Admin/Manager tests and generated GraphQL artifacts.
- One browser smoke using the Forge Helium/browser path.

Out of scope:

- Moving job ownership or Mux sync into Admin or Mastra.
- Replacing the coverage UI's Admin IDs with Core IDs.
- Reworking automation selection semantics beyond preserving
  `createEnrichmentJobs()` compatibility.
- Changing Watch playback behavior.

## Implementation Units

### 1. Admin Read Model Contract

Touch:

- `apps/admin/src/services/manager-read-model.service.ts`
- `apps/admin/src/graphql/types/managerReadModels.ts`
- `apps/admin/schema.graphql`
- `packages/admin-graphql/src/admin-graphql-env.d.ts`

Add `coreId`, `bcp47`, and `iso3` to `ManagerLanguage`. Add a
`managerVideosForEnrichment(ids: [String!]!)` query that accepts up to 100
coverage-selected IDs and returns the selected videos with `documentId`,
`coreId`, `primaryLanguage`, and variant metadata: variant language
`coreId/bcp47/iso3`, Mux `assetId/playbackId`, and download URLs.

Decision: this is a Manager read model, not a reuse of `videosByCoreIds`.
`videosByCoreIds` is optimized for admin-trigger source-artifact dispatch and
does not expose the variant/download graph needed to preserve
`materializeEnrichmentTargetForJob()`.

Tests:

- `apps/admin/src/services/manager-read-model.service.test.ts`
  - language rows include `coreId/bcp47/iso3`
  - enrichment videos resolve by Admin document ID and by Core ID
  - query rejects more than 100 IDs
  - variant metadata includes language, Mux, and download data
- `apps/admin/src/graphql/schema.test.ts`
  - `ManagerLanguage` exposes new fields
  - `managerVideosForEnrichment` exists with expected object fields

### 2. Manager Admin Client And Enrich Route

Touch:

- `apps/manager/src/backend/admin-client.ts`
- `apps/manager/src/app/api/enrich/route.ts`
- `apps/manager/src/app/api/enrich/route.test.ts`
- `apps/manager/src/app/api/enrich/route.mock.test.ts`

Add a client method for the new Admin query. Relax the `targetLanguageIds` and
`languages` schema to accept Admin document IDs. In admin mode, load language
geo to build an ID-to-language metadata map, load selected enrichment videos,
resolve target language codes with `deriveEnrichLanguagePlan()`, materialize
each selected video through `materializeEnrichmentTargetForJob()`, create the
Manager job, persist materialization metadata, and launch `runVideoEnrichment`.

Decision: keep the existing `CreateEnrichmentJobsResult` shape. Admin lookup
and per-video materialization failures should be represented as route-level
errors only for global failures, and as per-video `errors` where the request is
otherwise valid.

Tests:

- Long Admin language ID resolves to BCP-47 and creates a job in admin mode.
- Selected Admin document ID resolves to the matching video and launches
  enrichment.
- Unknown language ID returns a 400 with unresolved language details.
- Missing selected video reports a per-video `"Video not found"` error.
- Materialization failures produce per-video errors and do not dispatch.
- Mock mode still creates demo jobs with existing IDs.

### 3. Coverage UI Error Detail

Touch:

- `apps/manager/src/features/coverage/coverage-report-client.tsx`
- relevant focused test if one already covers `resolveEnrichSelectionOutcome`
  or enrich feedback behavior.

Parse the route's optional `details` and first per-video `errors` entry and
append the most useful detail to the feedback message. Keep successful redirect
behavior unchanged.

Tests:

- A non-OK response with `details.formErrors` or `details.fieldErrors` renders
  a specific message.
- A non-OK response with per-video `errors` renders the first video error.

## Verification Plan

Run:

- `pnpm --filter @forge/admin run schema:print`
- `pnpm --filter @forge/admin-graphql generate`
- `pnpm --filter @forge/admin test -- manager-read-model graphql/schema`
- `pnpm --filter @forge/manager test -- app/api/enrich backend/admin-client`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/admin-graphql typecheck`

Then run a Helium/browser smoke on Manager Coverage: select English, select one
missing subtitle tile, click `Enrich Now`, and verify the UI no longer fails
with only bare `Validation failed`.

## Risks And Defaults

- If Admin does not have a Core ID for a selected video, treat that video as a
  per-video validation failure because the workflow's source metadata depends on
  `coreId`.
- If a target language lacks `bcp47`, fall back through existing
  `resolveCmsLanguageCode()` behavior and report unresolved IDs when no code can
  be derived.
- If browser auth is unavailable in an automation session, prove the route with
  local/API tests and record the browser-smoke blocker rather than fabricating a
  visual pass.
