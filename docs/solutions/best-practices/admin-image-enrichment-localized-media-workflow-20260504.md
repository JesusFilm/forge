---
title: "Admin image enrichment with localized metadata and durable human overrides"
date: 2026-05-04
category: best-practices
module: apps/admin media assets
problem_type: best_practice
component: background_job
severity: medium
applies_when:
  - "Adding derived metadata to uploaded admin media"
  - "Generating AI-authored localized title or alt text"
  - "Queuing enrichment after upload while keeping assets immediately usable"
  - "Designing media inspector workflows that expose per-locale state"
related_components:
  - service_object
  - database
  - tooling
tags:
  - admin
  - media-assets
  - image-enrichment
  - localization
  - useworkflow
  - next-image
  - ai-provenance
---

# Admin image enrichment with localized metadata and durable human overrides

## Context

Admin media assets are editorial identities, not storage-object records. The
asset library already keeps local/S3 object keys behind service and route
boundaries, so image enrichment should extend the same model instead of making
upload wait for derived metadata or leaking storage details to callers.

The solved pattern for `feat-115` is: store the uploaded image first, mark it
usable, then dispatch a workflow that backfills one asset-global blur data URL
plus per-locale title and alt text for the configured top 12 global languages.
AI can create the first pass, but human-authored locale fields become permanent
locks that future retries must preserve.

Session history reinforced two adjacent decisions: `MediaAsset` should remain
the durable editorial identity over local/S3 paths, and the media inspector had
already been tuned into a compact workflow surface rather than a large detail
page. This enrichment work builds on both decisions.

## Guidance

Keep upload readiness separate from enrichment readiness. `MediaAsset.status`
answers whether the file is stored and usable; image enrichment needs its own
status lifecycle such as `WAITING`, `PROCESSING`, `COMPLETE`, `FAILED`, and
`SKIPPED`.

Persist byte-derived facts on the canonical asset:

```prisma
model MediaAsset {
  blurDataUrl String?
  dominantColor String?
  width Int?
  height Int?
  imageEnrichmentStatus MediaImageEnrichmentStatus @default(WAITING)
}
```

Persist human-facing localized text in child rows keyed by asset and locale:

```prisma
model MediaAssetLocale {
  mediaAssetId String
  locale String
  title String?
  altText String?
  titleSource RevisedByKind?
  altTextSource RevisedByKind?
  titleLocked Boolean @default(false)
  altTextLocked Boolean @default(false)

  @@unique([mediaAssetId, locale])
}
```

Make AI writes conditional per field, not per row. A retry should be able to
fill a missing AI-owned title while leaving a human-authored alt text alone:

```ts
const canWriteTitle = !existing?.titleLocked
const canWriteAltText = !existing?.altTextLocked
```

Dispatch enrichment after the storage write and ready-state update succeeds.
If dispatch fails, mark enrichment failed but leave the asset usable. This keeps
editor workflows fast and makes retry an operational concern rather than an
upload failure.

For `useworkflow`, keep Node-only work inside `"use step"` functions. Workflow
bodies are transformed by the Next build plugin, and direct Node/Prisma/storage
work in the workflow body can cause bundling or extraction surprises. Step
functions are the durable boundary for service construction, object reads,
metadata generation, and provider calls.

Expose localization management as a real workflow, not as raw JSON or one
overloaded metadata textarea. The inspector should summarize status and launch
a dedicated modal or similarly spacious surface with locale list, filters,
per-field provenance, edit forms, failed/missing states, and retry controls.

## Why This Matters

Upload and enrichment have different reliability profiles. Storage is required
for the image to exist; AI text generation and placeholder derivation are
valuable backfills. Coupling them makes a provider outage or image parser edge
case block editors from using a perfectly good upload.

Asset-global and locale-specific facts also age differently. A blur data URL is
a property of the image bytes and can be shared by every locale. Alt text and
titles are user-facing content, so they need first-class localization,
provenance, and human override semantics.

The human-lock rule is especially important because AI regeneration is cheap to
trigger and easy to over-trust. Once an editor has corrected a French alt text
or Japanese title, the system must treat that value as canonical editorial
intent, not as another draft candidate.

## When to Apply

- You are adding derived media metadata that can safely arrive after upload.
- The derived values include a mix of asset-global facts and localized
  user-facing text.
- AI generation should auto-fill useful defaults but never own final editorial
  authority.
- Operators need to inspect waiting, processing, failed, and completed
  enrichment work from the media UI or GraphQL.

## Examples

The implemented `feat-115` flow follows this sequence:

1. `uploadMediaAssetAction` stores the object and marks the asset `READY`.
2. For image assets, the server action dispatches
   `start(runMediaImageEnrichment, [{ mediaAssetId }])`.
3. `runMediaImageEnrichment` marks the asset processing, seeds the top-12
   locale rows, reads the original bytes, writes `blurDataUrl` and dimensions,
   generates structured localized text, and upserts only AI-writable fields.
4. `MediaAssetService.updateImageLocale` marks human edits as locked fields.
5. The inspector shows waiting/processing/failure state and opens the
   localization modal for review, editing, filtering, and retry.

The key preservation behavior belongs in service tests:

```ts
await service.updateImageLocale({
  id,
  locale: "fr",
  altText: "Human-written French description",
})

await service.upsertAiImageLocale({
  id,
  locale: "fr",
  title: "AI French title",
  altText: "Regenerated AI alt text",
})

expect(saved.altText).toBe("Human-written French description")
expect(saved.altTextLocked).toBe(true)
```

## Related

- `docs/solutions/platform/admin-media-storage-local-development.md` for the
  underlying `MediaAsset` storage boundary and local/S3 behavior.
- `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`
  for testing `start()` dispatch instead of relying on direct workflow calls.
- `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`
  for workflow failure-reporting patterns that matter if enrichment later fans
  out per locale or provider call.
- `docs/brainstorms/2026-05-04-admin-image-enrichment-workflow-requirements.md`
  and `docs/plans/2026-05-04-001-feat-admin-image-enrichment-workflow-plan.md`
  for the feature-specific requirements and implementation plan.
