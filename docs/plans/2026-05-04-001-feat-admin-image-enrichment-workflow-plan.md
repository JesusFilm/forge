---
title: Admin Image Enrichment Workflow
type: feat
status: active
date: 2026-05-04
origin: docs/brainstorms/2026-05-04-admin-image-enrichment-workflow-requirements.md
---

# Admin Image Enrichment Workflow

## Overview

Add asynchronous image enrichment to `apps/admin` media assets. Uploaded images
remain usable as soon as storage succeeds, then a workflow backfills a
`next/image`-compatible blur data URL and localized title/alt text for the top
12 global languages. AI-generated localized values are auto-applied with
provenance, but once a human edits a locale/value, retries and future
regeneration must not overwrite it.

The UI slice upgrades the media inspector from a simple metadata panel into the
launch/status point for image localization management. Detailed localization
editing should use a dedicated modal if that gives the workflow better room
than embedding every control in the inspector.

## Problem Frame

`MediaAsset` already gives admin an editorial asset identity, storage backend,
and basic metadata, but image-specific derived data is still missing. Editors
need immediate upload usability, web consumers need a blur placeholder shape
that `next/image` can consume directly, and localized image title/alt metadata
needs a real management surface instead of a single canonical alt-text input
(see origin: `docs/brainstorms/2026-05-04-admin-image-enrichment-workflow-requirements.md`).

## Requirements Trace

- R1-R5. Preserve fast upload and add background enrichment status/failure
  visibility.
- R6-R8. Generate and persist one asset-global blur data URL and related image
  facts where practical.
- R9-R14. Add first-class localized image metadata with AI provenance,
  per-locale completion, and durable human override protection.
- R15-R18. Expose enrichment state and retry-safe localized metadata through
  service/GraphQL paths for editors and agents.
- R19-R24. Provide a polished localization management UI launched from the
  media inspector, with modal/drawer/inline layout chosen during implementation
  based on fit.

## Scope Boundaries

- Keep scope inside `apps/admin` plus docs.
- Do not make enrichment synchronous with upload.
- Do not use blurhash alone as the feature output; persist a data URL usable as
  `blurDataURL`.
- Do not overwrite human-authored localized title or alt values.
- Do not enrich every system locale on upload; use the configured top 12 global
  languages.
- Do not build public web/mobile/TV consumer migrations in this ticket.
- Do not build a generic localization platform; keep the model reusable where
  cheap, but ship the media image workflow.

## Context & Research

### Relevant Code And Patterns

- `apps/admin/prisma/schema.prisma` already has `MediaAsset`, `Language`,
  `LanguageLocale`, `WorkflowRun`, and `RevisedByKind` patterns to extend.
- `apps/admin/prisma/migrations/0005_media_assets/migration.sql` created the
  existing media asset model; the new migration should be additive.
- `apps/admin/src/services/media-asset.service.ts` owns media permission checks,
  validation, Prisma writes, and usage scanning entry points.
- `apps/admin/src/services/media-asset.schemas.ts` owns Zod input coercion for
  GraphQL/agent/server-action callers.
- `apps/admin/src/graphql/types/mediaAsset.ts` exposes abac-gated media fields
  and should gain localized/enrichment fields without exposing raw object keys.
- `apps/admin/src/graphql/mutations/media-asset.ts` keeps resolvers thin and
  service-backed.
- `apps/admin/src/storage/media.ts` already provides backend-aware read/write
  helpers that the enrichment workflow can use to read original image bytes.
- `apps/admin/src/workflows/experienceEmbedding.ts` shows the simple
  `"use workflow"` / `"use step"` structure.
- `apps/admin/src/services/experience.service.ts` and
  `apps/admin/src/workflows/experienceContentDump.ts` show dispatch through
  `start()` and why direct workflow invocation is not the production path.
- `apps/admin/src/services/workflow-run-log.service.ts` provides the generic
  workflow ledger if operator-visible run state needs to be joined to runtime
  state.
- `apps/admin/src/app/dashboard/media/media-asset-inspector.tsx` is the current
  inspector. It has preview, canonical metadata, delete, and where-used panels.
- `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` has existing
  modal/drawer patterns and locale-switching UI that can inform the
  localization manager.

### Institutional Learnings

- `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`:
  every `start()` dispatch path needs dispatch-level tests; direct workflow
  invocation is not equivalent to production.
- `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`:
  isolate per-target failures and preserve successful outputs.
- `docs/solutions/integration-issues/manager-elevenlabs-routing-and-rerun-2026-04-11.md`:
  keep provider attempt state separate from canonical artifact state so reruns
  can be non-destructive.
- `docs/solutions/best-practices/verify-infra-writes-via-independent-read-path-20260420.md`:
  verify storage-derived metadata by reading through the independent read path.
- `docs/solutions/security-issues/zod-validation-errors-must-not-echo-user-controlled-input-20260420.md`:
  surface clear operator errors without leaking raw provider or user-controlled
  payload details.

### External References

- Next.js Image docs confirm `placeholder="blur"` uses `blurDataURL`, and
  remote/dynamic images need the data URL supplied explicitly:
  https://nextjs.org/docs/app/api-reference/components/image
- OpenAI Responses API docs support image inputs plus structured JSON-style
  outputs, which fits localized title/alt generation if the implementation uses
  OpenAI directly: https://platform.openai.com/docs/api-reference/responses

## Key Technical Decisions

- **Add a localized media row:** Add a `MediaAssetLocale`-style model related
  to `MediaAsset`, keyed by `(mediaAssetId, locale)`. Keep title/alt/provenance
  and per-field override state there rather than expanding canonical
  `MediaAsset.altText`.
- **Keep blur data on `MediaAsset`:** Add canonical image fields such as
  `blurDataUrl`, optional `dominantColor`, and enrichment status timestamps to
  `MediaAsset`. Blur data derives from bytes, not locale.
- **Use separate enrichment state from upload status:** Preserve
  `MediaAsset.status` for storage/backend readiness. Track image enrichment
  state separately so a `READY` asset can still be waiting or processing for
  enrichment.
- **Top 12 languages as config, validated against data:** Start with a small
  repo-local ordered constant of BCP-47 codes. The workflow creates locale rows
  for those codes even if language reference labels are missing, but the UI
  should display known `Language`/`LanguageLocale` names where available.
- **Retry only AI-owned or incomplete values:** Retrying enrichment regenerates
  missing, failed, or AI-owned fields. Human-overridden fields are preserved
  independently for title and alt text.
- **Modal for detailed localization management:** The inspector should show
  enrichment summary/status and launch a dedicated localization manager modal.
  The modal owns the dense locale list, active locale editor, filters, and retry
  controls.
- **Provider isolation:** Add an image enrichment service with a deterministic
  fallback/test path. If OpenAI/OpenRouter keys are missing, the workflow should
  still produce blur data and mark text generation as skipped/failed clearly
  rather than breaking upload usability.

## Open Questions

### Resolved During Planning

- **Inspector vs modal:** Use the inspector as summary/launch point; implement
  detailed management in a modal unless implementation proves a drawer is
  materially better.
- **Upload status vs enrichment status:** Do not overload `MediaAsset.status`;
  store enrichment state separately.
- **Blurhash vs blur data URL:** The deliverable is `blurDataUrl` for Next
  Image compatibility.

### Deferred To Implementation

- Exact migration sequence number, because this repo currently has parallel
  numbered migrations. Use the next unambiguous descriptive folder and do not
  rewrite existing migrations.
- Exact top-12 language list labels. Start with ordered BCP-47 constants and
  refine only if existing product data exposes a stronger priority source.
- Exact image processing dependency. Prefer a small maintained dependency only
  if needed; otherwise implement a tiny PNG/JPEG/WebP dimension parser plus a
  simple SVG data URL placeholder as the first safe slice.
- Exact AI model name and schema shape. Reuse existing `OPENAI_API_KEY`,
  `OPENAI_BASE_URL`, and `OPENROUTER_API_KEY` env conventions where practical.

## Implementation Units

- [x] **Unit 1: Data Model And Migration**

**Goal:** Persist asset-global blur/enrichment state and localized title/alt
metadata with provenance and override locks.

**Requirements:** R3-R14, R17-R18

**Files:**

- Modify: `apps/admin/prisma/schema.prisma`
- Create: `apps/admin/prisma/migrations/<next>_media_image_enrichment/migration.sql`
- Test: `apps/admin/src/graphql/schema.test.ts`

**Test Scenarios:**

- Prisma schema exposes `MediaAsset` blur/enrichment fields and related locale
  rows.
- `MediaAssetLocale` uniqueness prevents duplicate locale rows per asset.
- GraphQL schema includes localized media fields without exposing raw storage
  keys or technical provider payloads.

- [x] **Unit 2: Service Layer For Enrichment And Locales**

**Goal:** Add service operations to inspect locales, upsert AI values, preserve
human overrides, edit localized values, and retry safely.

**Requirements:** R9-R18, R22-R23

**Files:**

- Modify: `apps/admin/src/services/media-asset.schemas.ts`
- Modify: `apps/admin/src/services/media-asset.service.ts`
- Create: `apps/admin/src/services/media-asset-enrichment.ts`
- Test: `apps/admin/src/services/media-asset.service.test.ts`
- Test: `apps/admin/src/services/media-asset-enrichment.test.ts`

**Test Scenarios:**

- AI upsert fills missing locale title/alt and marks provenance as AI.
- Human edit changes only the requested locale/value and sets a durable
  override lock for that field.
- Retry preserves human title while regenerating AI-owned alt, and vice versa.
- Failed generation for one locale does not erase other locale values.
- Non-image assets reject image-enrichment operations.

- [x] **Unit 3: Image Processing And AI Generation**

**Goal:** Generate canonical blur data and structured localized text with safe
fallback behavior.

**Requirements:** R5-R8, R10-R14

**Files:**

- Create: `apps/admin/src/services/image-metadata.service.ts`
- Create: `apps/admin/src/services/image-text-generation.service.ts`
- Test: `apps/admin/src/services/image-metadata.service.test.ts`
- Test: `apps/admin/src/services/image-text-generation.service.test.ts`

**Test Scenarios:**

- Generates a `data:image/...;base64,...` blur URL for supported image input.
- Rejects unsupported or corrupt image bytes with a clear domain error.
- Structured text generation validates model output and strips unsafe/empty
  locale values.
- Missing provider credentials return a controlled skipped/failed result that
  upload and blur generation can tolerate.

- [x] **Unit 4: Workflow Dispatch And Upload Integration**

**Goal:** Queue image enrichment after upload succeeds while keeping the asset
immediately usable.

**Requirements:** R1-R5, R10, R18

**Files:**

- Create: `apps/admin/src/workflows/mediaImageEnrichment.ts`
- Modify: `apps/admin/src/app/dashboard/media/page.tsx`
- Modify: `apps/admin/src/services/media-asset.service.ts`
- Test: `apps/admin/src/workflows/mediaImageEnrichment.test.ts`
- Test: `apps/admin/src/app/dashboard/media/page.test.tsx` or nearest existing
  dashboard/media test

**Test Scenarios:**

- Upload creates a READY image asset after storage write and dispatches
  enrichment through `start()`.
- Dispatch failure leaves the asset usable and records a visible enrichment
  failure state.
- Workflow reads original bytes through `readMediaObject`, writes blur data,
  creates top-12 locale rows, and isolates per-locale text failures.
- Retry only processes missing/failed/AI-owned values.

- [x] **Unit 5: GraphQL And Agent-Friendly Operations**

**Goal:** Expose enrichment state, localized metadata, edits, and retry controls
through service-backed GraphQL operations.

**Requirements:** R15-R18, R23

**Files:**

- Modify: `apps/admin/src/graphql/types/mediaAsset.ts`
- Modify: `apps/admin/src/graphql/mutations/media-asset.ts`
- Test: `apps/admin/src/graphql/schema.test.ts`

**Test Scenarios:**

- `MediaAsset` exposes blur data URL and localized metadata rows.
- Mutations for localized edits require media write permission.
- Retry mutation exposes only a controlled success/failure shape.
- Schema classification remains valid.

- [x] **Unit 6: Polished Inspector And Modal UI**

**Goal:** Add visible enrichment status to the inspector and a modal-based
localization manager for image assets.

**Requirements:** R3-R5, R15-R16, R19-R24

**Files:**

- Modify: `apps/admin/src/app/dashboard/media/page.tsx`
- Modify: `apps/admin/src/app/dashboard/media/media-asset-inspector.tsx`
- Create: `apps/admin/src/app/dashboard/media/media-localization-modal.tsx`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx` or a new colocated
  media inspector test if the existing suite is too broad.

**Test Scenarios:**

- Inspector shows waiting/processing/failed/complete enrichment status for
  image assets without disabling usage/selection.
- Inspector launches the localization modal.
- Modal lists top-12 locale rows with status/provenance/override signals.
- Editing a generated value communicates and persists human protection.
- Filters or state groupings let editors find failed/missing rows.

## Sequencing

1. Land data model and generated Prisma/Pothos type updates.
2. Add service-layer locale/enrichment rules with tests before UI.
3. Add image blur/text generation services and workflow tests.
4. Wire upload dispatch and retry operations.
5. Expose GraphQL fields/mutations for agents.
6. Build the inspector status and modal UI.
7. Run admin validation: lint, typecheck, tests, build.

## Verification Commands

- `pnpm --filter @forge/admin db:generate`
- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin build`

## Manual Verification

- Upload an image and confirm it appears/selects immediately before enrichment
  finishes.
- Confirm the inspector shows enrichment state and can open localization
  management.
- Confirm a blur data URL is present after enrichment.
- Confirm top-12 locale rows exist after enrichment.
- Edit one localized alt value, retry enrichment, and confirm the human value
  is preserved.
