---
title: "Admin experience media picker should persist asset IDs and resolve app URLs at read boundaries"
date: "2026-07-07"
last_updated: "2026-07-23"
category: best-practices
module: "apps/admin media assets, apps/web watch home"
problem_type: best_practice
component: service_object
severity: high
applies_when:
  - "Adding media-library selection to experience editor block fields"
  - "Serving admin-managed image assets to web, mobile, or TV consumers"
  - "Replacing raw persisted media URLs with structured MediaAsset references"
  - "Adding GraphQL block fields that expose public media asset metadata"
tags:
  - admin
  - media-assets
  - experience-editor
  - asset-ids
  - graphql
  - watch-home
  - public-preview
---

# Admin experience media picker should persist asset IDs and resolve app URLs at read boundaries

## Context

Experience blocks historically carried many URL-shaped fields:
`imageUrl`, `backgroundImageUrl`, `mediaUrl`, and similarly named nested item
fields. Authored image and background image fields now persist asset ids and
expose asset metadata instead. Once the admin Media Library became the editorial source of truth,
persisting preview URLs in those fields created a bad contract: editor state
looked correct in admin, but mobile/TV/web consumers could not rely on a stable
media identity or resolve the asset without knowing admin storage details.

The original implementation also added an `imageOverrideUrl` /
`imageOverrideAssetId` field family for MediaCollection and VideoCarousel items.
That parallel path turned out to be the wrong abstraction. It made app consumers
choose between "normal" image fields and "override" image fields even though both
represented the same authored asset, and it let real MediaAsset-backed images
look like arbitrary URL overrides.

The implemented pattern is to make the editor picker selection-oriented while
keeping `MediaAsset` as the durable reference:

- the editor writes the matching `*AssetId` field;
- the editor does not persist transient preview URLs for authored block images;
- GraphQL exposes `BlockImageAsset` metadata for authored block images;
- the admin media route serves READY previews publicly while keeping downloads
  admin-authenticated;
- web, mobile, and TV read authored experience item art from `imageAsset`
  and use `imageAsset.previewUrl` as the render URL.

Session-history check: a current-session compound review found this same stale
pattern in prior docs while removing the `imageOverride*` contract. That review
also caught the required production-safety pieces: legacy persisted JSON still
needed read-time canonicalization, asset hydration needed to normalize legacy
blocks before collecting asset IDs, and production needed a dry-run backfill
before the old GraphQL fields disappeared.

## Guidance

Keep the write contract and the read contract separate.

On editor writes, store asset identity and avoid persisting transient preview
URLs:

```ts
updateBlockAt(blockIndex, (currentBlock) => ({
  ...currentBlock,
  imageAssetId: asset.id,
}))
```

For nested items, do the same with the item-specific asset field, for example
`imageAssetId`. Empty image removals should clear the asset id, and persisted
empty strings should be normalized away before schema validation so optional
asset-id fields are absent rather than invalid empty strings.

Do not add a separate `imageOverride*` field family for authored item artwork.
If an editor-chosen image should replace video-derived artwork, it is still the
item's `imageAssetId` exposed through `imageAsset`. If card shape needs an explicit signal, store
that as shape metadata such as `thumbnailOrientation`, not by inferring vertical
poster intent from the presence of a special image URL.

At GraphQL read boundaries, expose public-safe asset metadata for authored block
images:

```ts
async function resolveBlockImageAsset(row: object, ctx: MediaPreviewContext) {
  const record = row as Record<string, unknown>
  const asset = await loadMediaAsset(ctx, record.imageAssetId)
  return asset
    ? { id: asset.id, previewUrl: publicMediaAssetPreviewUrl(asset) }
    : null
}
```

Consumers should not read authored block images or backgrounds from flattened
block `imageUrl` / `backgroundImageUrl` fields. Keep URL-shaped fields only
where they are still the explicit contract (`mediaUrl`, `ogImageUrl`, and
video/search result image URLs). For nested collection/carousel items,
`imageAsset` is the authored image field; app consumers should not need an
override-specific branch.

When removing an old URL field family from Experience block JSON, add a
temporary read-time canonicalizer and a production backfill. The safe sequence is:

1. Normalize legacy persisted blocks before `BlocksSchema` validation.
2. Promote legacy `imageOverrideAssetId` to `imageAssetId` when the canonical
   field is absent.
3. Delete legacy `imageOverrideUrl`, `imageOverrideAssetId`,
   `imageOverrideBlurDataUrl`, and `imageOverrideDominantColor` keys from the
   normalized representation.
4. If every item in a MediaCollection had legacy override art and the block has
   no explicit card shape, promote `thumbnailOrientation: "vertical"` so poster
   rails keep their intended layout after the image field is canonical.
5. Run the backfill dry-run against production, inspect counts, then execute.

For app consumers, do not require the admin session cookie for previews. Serve
only READY previews anonymously, use public cache headers for anonymous preview
responses, and keep downloads behind admin auth:

```ts
const asset = user
  ? await createServices(prisma).mediaAsset.getById({ id, user, query: {} })
  : await prisma.mediaAsset.findFirst({ where: { id, status: "READY" } })
```

When Pothos block types change, regenerate both committed contracts in the same
change:

```bash
pnpm --filter @forge/admin schema:print
pnpm --filter @forge/admin-graphql generate
```

## Why This Matters

An app route such as `/api/media-assets/:id/preview` is a delivery URL, not the
source of editorial truth. Persisting it inside block JSON couples content to a
specific route shape, makes deletion/replacement harder to reason about, and
does not give agents or editors a structured way to inspect usage.

Persisting `MediaAsset` IDs keeps experience content connected to the media
library's metadata, folder organization, usage scanning, and replacement
workflows. Resolving URL-shaped fields at GraphQL read time keeps web, mobile,
and TV consumers compatible while the internal data model becomes more
structured. When the consumer needs an actual image source, it should read
`imageAsset.previewUrl`.

Using one canonical authored-image path also prevents app drift. Web enrichment,
mobile Watch Home, TV Watch Home, SDUI renderers, GraphQL fragments, and admin
editor state all agree that authored item art is `imageAssetId` / `imageAsset`.
Card shape is a separate `thumbnailOrientation` concern, and blur/color metadata
must match the selected image source instead of leaking video-derived metadata
onto an authored asset.

The public preview route is the cross-app delivery boundary. Mobile and TV
cannot depend on admin cookies or a web-only proxy, but they can render a stable
absolute URL returned by admin GraphQL.

## When to Apply

- A block or nested item has a `*Url` media field and a corresponding
  `*AssetId` field.
- Editor UI needs to show image previews but should not persist preview URLs.
- A consumer app reads admin GraphQL and needs renderable media URLs.
- A media picker uploads/selects from the admin Media Library rather than
  accepting arbitrary URLs.
- A Pothos block field starts resolving data from storage-backed media assets.
- A legacy Experience block field is being removed and existing production JSON
  may still contain old keys.

## Examples

The image picker browser should remember user navigation and selection without
turning folder management into picker scope:

- folder tree on the left;
- selected-folder image grid on the right;
- global search across the entire image library;
- drop upload into the selected folder;
- explicit `Select` and `Cancel` actions;
- selected asset highlighted when reopening;
- last browsed folder reused only when the target has no selected asset.

The watch-home side should treat editor-authored media as part of the public
homepage experience contract:

```ts
const imageUrl = item.imageUrl ?? hydratedVideoImage ?? muxThumbnail ?? null
const orientation = block.thumbnailOrientation ?? mapVariant(block.variant)
```

For legacy JSON compatibility, canonicalize before validating or hydrating asset
IDs:

```ts
const blocks = normalizeLegacyExperienceBlockMediaFields(row.blocks)
const parsed = BlocksSchema.parse(blocks)
```

Use tests at each boundary:

- editor tests: selecting/removing an asset writes asset IDs and does not write
  preview URLs;
- route tests: anonymous READY previews work, non-READY previews 404, downloads
  redirect to admin login;
- GraphQL/schema tests: new block discriminators and asset-backed URL fields
  remain in the union contract;
- domain/service tests: legacy override keys are promoted to canonical fields and
  removed from normalized output;
- web/native tests: authored `imageUrl` wins for imagery, `thumbnailOrientation`
  wins for card shape, and authored image blur/color metadata does not fall back
  to the linked video's metadata.

## Related

- [Admin Media Storage Local Development](../platform/admin-media-storage-local-development.md)
- [Admin image enrichment with localized metadata and durable human overrides](./admin-image-enrichment-localized-media-workflow-20260504.md)
- [Admin experience preview cards should hydrate referenced video images](./admin-experience-preview-cards-video-reference-images-20260423.md)
- [TV/mobile clients consume only public admin GraphQL queries](../conventions/tv-mobile-clients-consume-only-public-admin-queries.md)
- [Mobile carousel images blank: relative image URL without base origin](../integration-issues/mobile-relative-image-url-no-base-origin-20260408.md)
- [TV SDUI MediaCollection card image/title resolution](../architecture-patterns/tv-sdui-mediacollection-card-image-title-resolution.md)
