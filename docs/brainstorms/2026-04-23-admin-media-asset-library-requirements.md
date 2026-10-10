---
date: 2026-04-23
topic: admin-media-asset-library
---

# Admin Media Asset Library

## Problem Frame

`apps/admin` is replacing Strapi as the editorial source of truth, but media is
still treated as scattered URL fields inside experience metadata and block JSON.
Editors need a real media library for uploaded images and generic files, and
agents need a structured way to inspect, manage, and trace media usage without
manually spelunking through blocks.

The first version should solve the immediate image needs across existing
experience blocks while choosing a storage model that can also handle PDFs and
future video assets. Video storage should be Mux-ready, but local development
must never require uploading test videos to Mux. Images and generic files need
the same local-development rule: useful local behavior without depending on
production object storage.

## Requirements

**Asset Library**

- R1. `apps/admin` owns the canonical media asset library for new editorial
  work; Strapi compatibility is out of scope.
- R2. The library supports generic asset records from the start, at minimum
  images, videos, PDFs, and other files, while making the first authoring UX
  image-forward for experience blocks.
- R3. Each asset has enough editor-facing metadata to support search,
  accessibility, and safe reuse: display name, description or notes, alt text
  when relevant, media kind, MIME type, file size, dimensions or duration when
  known, storage backend, processing status, and timestamps.
- R4. Assets can be browsed, searched, filtered, previewed, and selected from
  the media library without opening raw JSON.
- R5. Replacing or deleting an asset must show usage impact before the action
  is allowed, so editors do not silently break published experiences.

**Storage And Backends**

- R6. The media system uses a backend abstraction so metadata, usage, and block
  references are independent of where the bytes live.
- R7. Production images and generic files use admin-managed object storage,
  matching the existing Railway S3 direction.
- R8. Production videos are modeled so a future Mux backend can own video bytes,
  processing, playback IDs, thumbnails, and duration metadata.
- R9. Local development never uploads to Mux by default. Local video assets use
  a local placeholder/file backend with enough metadata to exercise library,
  selection, usage, and editor workflows.
- R10. Local development for images and generic files uses a filesystem-backed
  object store plus local database metadata, so uploads work offline and tests
  can run without Railway S3 credentials.
- R11. Public or preview URLs are generated through admin-owned access rules;
  callers should not build storage URLs by concatenating paths.
- R11a. Planning should evaluate S3-compatible local emulators from npm or
  containerized tooling as an alternative or supplement to plain filesystem
  fallback, so development can exercise production-like object-store APIs
  without real Railway S3 credentials.

**Experience Blocks And Metadata**

- R12. Existing image-bearing experience surfaces can select managed assets:
  locale OG image, block-level images, card media, background images, Bible quote
  images, navigation carousel images, media collection item overrides, video
  carousel item images, and video/video hero media fields.
- R13. Block references should be asset-aware rather than durable arbitrary URL
  strings, while planning may define a migration bridge for any existing URL
  payloads already stored in admin.
- R14. The editor keeps image selection ergonomic inside the block inspector:
  choose, preview, clear, replace, and jump to the asset detail page.
- R15. Non-image files such as PDFs can be attached where the product needs a
  downloadable or linked file, but the first milestone does not need bespoke PDF
  rendering inside every block.

**Usage Visibility**

- R16. The media library shows every known place an asset is used, including
  entity type, entity title, locale, block type, nested item label when known,
  field name, and a direct route back to the editor context.
- R17. Usage detection covers both structured asset references and legacy
  admin URL fields during the transition, so agents can find real usage even
  before every block payload has been normalized.
- R18. Usage data is queryable by agents in a structured form; the answer should
  not require interpreting raw JSON paths without labels.

**Agent Operations**

- R19. Agents can list assets, inspect metadata, inspect usage, register or
  upload local/dev assets, attach assets to known fields, replace asset
  references, and report blockers with typed errors.
- R20. Agent operations respect the same permission and service-layer rules as
  the UI; no direct database or storage bypass becomes the blessed path.
- R21. Agent-facing results include stable identifiers, media kind, backend,
  status, human-readable labels, and edit routes so follow-up work is grounded.

**Safety And Operations**

- R22. Uploads enforce size, MIME type, and extension allowlists by media kind.
- R23. Image uploads should capture or derive dimensions and support preview
  placeholders where practical.
- R24. Failed processing, missing local files, missing object-store keys, and
  unsupported backend operations surface clear operator messages without
  leaking storage credentials or raw provider errors.
- R25. The first version includes tests for local storage behavior, usage
  detection, permission gates, and block editor asset selection.

## Success Criteria

- An editor can upload or register an image in `apps/admin`, select it inside an
  image-bearing experience block, save the locale, and see the image preview
  without touching raw JSON.
- An editor can upload or register a PDF or other generic file and see it in the
  library with correct type/status metadata.
- A developer can exercise image, file, and video-placeholder workflows locally
  without Railway S3 or Mux credentials.
- An asset detail view answers "where else is this used?" with direct links to
  the relevant experience editor contexts.
- An agent can answer "show me all places this image is used" and perform a
  guarded replacement through admin service/API paths.
- Production design is ready for Railway S3-backed images/files and future
  Mux-backed videos without rewriting block usage semantics.

## Scope Boundaries

- Do not use Strapi as the source of truth for this capability.
- Do not build Mux video upload/transcoding in the first milestone; make the
  model and local-dev behavior ready for it.
- Do not require public web/mobile/TV consumer migration as part of this work.
- Do not build a full digital asset management system with approvals,
  licensing workflows, renditions marketplace, or external CDN purge tooling.
- Do not make deletion silent for assets with usage.

## Key Decisions

- **Admin-native source of truth:** The work belongs in `apps/admin` because it
  is replacing Strapi and already owns the new editorial model.
- **Generic assets now, image-forward UX first:** Supporting generic file kinds
  early avoids painting the model into an image-only corner, while keeping the
  first user workflow focused on the blocks that need images today.
- **Backend abstraction:** Assets should not be synonymous with S3 objects or
  Mux assets. The product needs stable editorial references even as storage
  backends differ by environment and media kind.
- **Local-first development behavior:** Local uploads should use filesystem
  storage and local metadata. Local videos should not call Mux unless explicitly
  configured for an integration test or staging workflow.
- **Production-like local storage is worth exploring:** A simple filesystem
  fallback is useful, but an S3-compatible local emulator may catch integration
  issues earlier while still keeping local development offline.
- **Structured usage map:** "Where used" is a first-class requirement because
  both editors and agents need safe replacement and cleanup workflows.

## Dependencies / Assumptions

- `apps/admin` already has service-layer, permission, storage, and dashboard
  foundations to extend.
- Existing admin block payloads include URL-shaped media fields; planning should
  decide whether to migrate them immediately or support a transitional bridge.
- Railway S3 remains the production object storage direction for admin-managed
  non-video files.
- Mux is the preferred future production backend for uploaded videos, but local
  development should default to a non-Mux backend.

## Outstanding Questions

### Deferred to Planning

- [Affects R3-R8][Technical] What exact asset table shape, backend enum, and
  processing status model best fit the existing Prisma conventions?
- [Affects R11][Technical] Should preview/public delivery use signed admin
  routes, direct object URLs, or a mixed policy by asset visibility?
- [Affects R10-R11a][Needs research] Should local development keep the current
  filesystem fallback, use an npm/container S3-compatible emulator, or support
  both with explicit test tiers?
- [Affects R12-R17][Technical] Should usage be computed on demand from block
  JSON, maintained as an index table, or both?
- [Affects R13][Technical] How aggressively should existing URL fields in admin
  data be normalized to asset references in the first implementation?
- [Affects R19-R21][Technical] Should agent operations be exposed as GraphQL
  mutations/queries only, or should MCP/tool wrappers be added after the API is
  stable?

## Next Steps

-> /ce:plan for structured implementation planning.
