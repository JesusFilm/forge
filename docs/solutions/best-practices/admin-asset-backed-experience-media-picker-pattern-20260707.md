---
title: "Admin experience media picker should persist asset IDs and resolve app URLs at read boundaries"
date: "2026-07-07"
category: best-practices
module: "apps/admin media assets, apps/web watch home"
problem_type: best_practice
component: service_object
severity: high
applies_when:
  - "Adding media-library selection to experience editor block fields"
  - "Serving admin-managed image assets to web, mobile, or TV consumers"
  - "Replacing raw persisted media URLs with structured MediaAsset references"
  - "Adding GraphQL block fields that expose media URL values derived from assets"
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
`imageUrl`, `backgroundImageUrl`, `mediaUrl`, `imageOverrideUrl`, and
similarly named nested item fields. Once the admin Media Library became the
editorial source of truth, persisting preview URLs in those fields created a
bad contract: editor state looked correct in admin, but mobile/TV/web consumers
could not rely on a stable media identity or resolve the asset without knowing
admin storage details.

The implemented pattern is to make the editor picker selection-oriented while
keeping `MediaAsset` as the durable reference:

- the editor writes the matching `*AssetId` field;
- the editor clears the legacy/raw URL field for media-library selections;
- GraphQL read fields resolve asset-backed URLs for consumers;
- the admin media route serves READY previews publicly while keeping downloads
  admin-authenticated;
- web watch-home reads public homepage experience blocks and applies image
  overrides from those resolved URL fields.

Session-history check: the only matching session found in the last seven days
was this current Codex session, so no prior-session context was incorporated.

## Guidance

Keep the write contract and the read contract separate.

On editor writes, store asset identity and avoid persisting transient preview
URLs:

```ts
updateBlockAt(blockIndex, (currentBlock) => ({
  ...currentBlock,
  backgroundImageUrl: "",
  backgroundImageAssetId: asset.id,
}))
```

For nested items, do the same with the item-specific field pair, for example
`imageOverrideUrl` plus `imageOverrideAssetId`. Empty image removals should
clear both values, but persisted empty strings should be normalized away before
schema validation so optional asset-id fields are absent rather than invalid
empty strings.

At GraphQL read boundaries, preserve the existing URL-shaped public field while
backing it with the asset reference:

```ts
async function resolveAssetBackedUrl(
  row: object,
  ctx: MediaPreviewContext,
  urlField: string,
  assetField: string,
) {
  const record = row as Record<string, unknown>
  return (
    optionalString(record[urlField]) ??
    (await resolveMediaAssetPreviewUrl(ctx, record[assetField]))
  )
}
```

This lets consumers keep reading `imageUrl`, `backgroundImageUrl`,
`mediaUrl`, or `imageOverrideUrl` while the stored block JSON moves to asset
IDs.

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
workflows. Resolving URL-shaped fields at GraphQL read time keeps existing web,
mobile, and TV consumers compatible while the internal data model becomes more
structured.

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

The web watch-home side should treat editor-authored media overrides as part of
the public homepage experience contract:

```ts
const overrides = collectMediaOverrides(homepageExperience.blocks)
const card = applyMediaOverride(baseCard, {
  sectionId,
  mediaOverrides: overrides,
  video,
  sourceVideo,
})
```

Use tests at each boundary:

- editor tests: selecting/removing an asset writes asset IDs and does not write
  preview URLs;
- route tests: anonymous READY previews work, non-READY previews 404, downloads
  redirect to admin login;
- GraphQL/schema tests: new block discriminators and asset-backed URL fields
  remain in the union contract;
- web tests: homepage media overrides replace configured child card imagery.

## Related

- [Admin Media Storage Local Development](../platform/admin-media-storage-local-development.md)
- [Admin image enrichment with localized metadata and durable human overrides](./admin-image-enrichment-localized-media-workflow-20260504.md)
- [Admin experience preview cards should hydrate referenced video images](./admin-experience-preview-cards-video-reference-images-20260423.md)
- [TV/mobile clients consume only public admin GraphQL queries](../conventions/tv-mobile-clients-consume-only-public-admin-queries.md)
- [Mobile carousel images blank: relative image URL without base origin](../integration-issues/mobile-relative-image-url-no-base-origin-20260408.md)
