---
date: 2026-05-04
topic: admin-image-enrichment-workflow
---

# Admin Image Enrichment Workflow

## Problem Frame

`apps/admin` now has a first-class media asset library, but uploaded images still
need derived metadata before they work well across editorial surfaces and
Next.js consumers. Editors should not wait for enrichment before using an
uploaded image, but the system should backfill high-value image metadata:
asset-global blur placeholders for `next/image`, plus localized titles and alt
text for the languages most likely to be used globally.

The important product split is that visual/file facts belong to the canonical
asset, while human-facing text belongs in localized image metadata. AI can write
the first pass, but human edits must be respected permanently for that locale.

## Requirements

**Upload And Lifecycle**

- R1. Image upload remains fast and usable immediately after the file is stored;
  enrichment must not block editors from selecting or publishing with the asset.
- R2. Every newly uploaded image is queued for enrichment after upload succeeds.
- R3. The media UI shows enrichment state while work is pending or active, using
  editor-readable states equivalent to `waiting` and `processing`.
- R4. Completed enrichment does not need to interrupt the browse UI; completion
  may appear in asset detail, history, or normal metadata fields.
- R5. Failed enrichment leaves the image usable and surfaces a clear operator
  message or retry affordance without exposing provider internals.

**Asset-Global Derived Data**

- R6. Each image enrichment run generates one asset-level blur data URL that is
  compatible with `next/image` `placeholder="blur"` usage.
- R7. The blur data URL is stored as canonical image metadata shared by every
  locale and should not be regenerated as part of locale text updates.
- R8. Asset-global image facts such as dimensions, MIME/file metadata, checksum,
  and optional dominant-color style data may be captured alongside blur data
  when available, but blur data URL is the required deliverable.

**Localized Title And Alt Text**

- R9. Image title and alt text are first-class localized metadata, not fields
  that live only on the canonical `MediaAsset`.
- R10. On upload, the enrichment workflow creates or updates localized image
  metadata for the top 12 global languages.
- R11. AI-generated localized title and alt text are auto-applied into their
  locale records with clear AI provenance.
- R12. Editors can override generated title and alt text per locale.
- R13. Once a human overrides a localized title or alt text value, automated
  enrichment must never regenerate or overwrite that human-authored value.
- R14. The localized metadata model supports partial completion: one locale can
  be complete, processing, failed, or human-overridden independently of another
  locale.

**Editor And Agent Experience**

- R15. Asset detail lets editors inspect localized title and alt text values,
  see which ones were AI-generated, and edit or override them.
- R16. Media listing and picker views expose pending/processing enrichment
  state without making the image feel unavailable.
- R17. Agents can inspect enrichment state, asset-global blur metadata,
  localized title/alt values, provenance, and human-override locks through
  admin-owned service or GraphQL paths.
- R18. Retry behavior must preserve human overrides and should only regenerate
  missing, failed, or still-AI-owned values.

**Localization Management UI**

- R19. The media asset inspector becomes the primary place to manage image
  localization access and status, not just canonical asset metadata.
- R20. Detailed localization management may open from the inspector into a
  modal instead of being fully embedded in the inspector, so the workflow has
  enough room for editing, scanning, filtering, and review.
- R20a. The localization management surface exposes a polished view for image
  assets that can scale beyond a single alt-text input: locale list, status,
  title, alt text, provenance, last updated state, and override state.
- R21. Editors can move efficiently between localized records, scan which
  locales are AI-generated, human-overridden, missing, failed, or processing,
  and edit the active locale without losing media-library context.
- R22. The localization UI should make human override behavior obvious before
  save: editing a generated title or alt text converts that value into a
  protected human-authored value.
- R23. The localization management surface should provide clear bulk or
  workflow-oriented affordances where useful, such as retry failed locales,
  retry missing AI-owned values, or filter the locale list by state.
- R24. The UI should feel like a first-class localization surface, whether it is
  modal-based or inspector-embedded, and should be reusable for other localized
  media/entity metadata later without requiring this feature to build a generic
  localization framework upfront.

## Success Criteria

- An editor uploads an image, immediately selects it in the media UI, and sees
  enrichment progress without being blocked.
- After enrichment completes, the asset has a `next/image`-compatible blur data
  URL available from canonical asset metadata.
- The asset has localized title and alt text for the configured top 12 global
  languages.
- A human can edit the French alt text, rerun enrichment, and confirm the French
  human-authored value is not changed.
- Failed AI generation for one locale does not prevent the image, blur data URL,
  or other completed locales from remaining usable.
- An editor can open localized metadata management from the media inspector,
  scan all top-12 language rows, edit one locale, see provenance/override
  status, and retry failed AI-owned rows without losing human edits.

## Scope Boundaries

- Do not make image enrichment part of the synchronous upload transaction.
- Do not require all locales in the system to be enriched on upload; start with
  the configured top 12 global languages.
- Do not overwrite human-authored localized metadata during backfill, retry, or
  future regeneration.
- Do not treat blurhash alone as sufficient for this feature; the required
  output is a blur data URL shape that `next/image` can consume directly.
- Do not build public web/mobile/TV migrations in this feature; expose metadata
  in admin-owned surfaces first.
- Do not reduce localization management to a single expanded metadata form; the
  media UI should treat localized image text as a real management workflow.
- Do not build a universal localization platform in this feature; create a
  polished media-localization experience with reusable patterns where practical.

## Key Decisions

- **Usable immediately after upload:** Editors get fast feedback and can keep
  working while enrichment improves metadata in the background.
- **Asset-global blur, locale-specific text:** Blur data is a property of the
  image bytes; title and alt text are user-facing content that need
  localization.
- **Top 12 global languages on upload:** The first background pass creates broad
  global coverage without attempting every possible locale.
- **AI auto-applies, humans permanently win:** Generated values provide useful
  defaults, but a human override becomes a durable lock for that locale/value.
- **Inspector launches localization management:** Since this is the first place
  the detail is exposed in the interface, the inspector should surface status
  and entry points, while the full workflow can use a dedicated modal or another
  spacious pattern when that produces a better editor experience.

## Dependencies / Assumptions

- `apps/admin` owns the media asset library and durable workflow system.
- Existing media upload creates a usable `MediaAsset` before enrichment exists.
- Planning should identify the authoritative source for the top 12 global
  languages, preferably from existing admin/Core language data or a small
  configured priority list.
- Planning should decide whether enrichment state is represented as a separate
  workflow/enrichment status model or derived from workflow run records plus
  localized metadata rows.

## Outstanding Questions

### Deferred to Planning

- [Affects R3-R5][Technical] What persistence model best represents
  asset-level enrichment state and per-locale title/alt completion without
  overloading generic media upload status?
- [Affects R6-R8][Technical] Which image processing path should generate the
  `next/image`-compatible blur data URL in local, test, and production
  environments?
- [Affects R10][Technical] Where should the top 12 global languages be sourced
  and how should changes to that list be managed?
- [Affects R11-R14][Technical] What provenance and override-lock fields best
  fit admin's existing locale and revision conventions?
- [Affects R17][Technical] Which GraphQL/service operations should expose
  enrichment inspection and retry controls for agents and operators?
- [Affects R19-R24][Design/Technical] Should detailed localization management
  use a modal launched from the inspector, an inline split view, a locale drawer
  pattern similar to the experience editor, tabs, or another management layout?

## Next Steps

-> /ce:plan for structured implementation planning.
