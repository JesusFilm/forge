# Catalog inventory and recommendation delivery

Use the PostgreSQL map to discover what content exists. Apply recommendation
rules afterward. A rejected recommendation card does not establish that its
audio language lacks videos.

## Verified relationships

| Question                       | Authoritative local records                                                                           | Interpretation                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which video is this?           | `video.id`, `video.core_id`, `video.slug`, `video.label`                                              | Admin ID and Core video ID are different identifiers. A video can be a film, chapter, episode, series or collection.                                                               |
| Which language version exists? | `video_dub.video_id` → `video.id`; `video_dub.language_id` → `language.id`                            | Core `videoVariants` are stored as Admin `video_dub`. Preserve a dub's own Core ID. Join exact language IDs/slugs, never a BCP-47 prefix.                                          |
| What sources are declared?     | `video_dub.hls`, optional `video_dub.mux_video_id` → `mux_video.playback_id`                          | HLS and Mux are separate evidence. A left join retains HLS-only dubs. Neither a nonempty URL nor a playback ID establishes current media health.                                   |
| Which cut owns subtitles?      | `video_dub.video_edition_id` → `video_edition.id`; `video_subtitle.video_edition_id`                  | Sharing an edition does not itself prove two video records are duplicates.                                                                                                         |
| How is the catalog organized?  | `video_relation.parent_id`, `child_id`, `order`                                                       | A parent-child edge may represent film chapters or collection membership. Having children does not make a video unplayable; owning a published dub does not prove it has a stream. |
| What text can a card display?  | `video_locale.video_id`, `locale`, `language_id`, `language_slug`, `language_core_id`, `status`       | Display locale and audio language are independent dimensions. Preserve exact keys, publication and deletion state.                                                                 |
| What is a language called?     | `language_locale.language_id`, `locale`, `value`                                                      | These are canonical names. Legacy `language.name` JSON is a compatibility mirror, not an identity join.                                                                            |
| What can support curation?     | `video_image`, `video_keyword` → `keyword`, localized descriptions, relationships, editorial manifest | These provide artwork and editorial evidence. A keyword or shared parent is not automatic approval or canonical identity.                                                          |

The schema is in `apps/admin/prisma/schema.prisma`. The Core boundary in
`apps/admin/src/services/core-sync/phases/sync-dubs.ts` stores `variant.hls`
independently of Mux metadata. No additional `videoVariants` PostgreSQL table is
required to find those sources.

## Consumer differences verified in code

The ordinary Watch player, `apps/web/src/components/watch/HeroPlayer.tsx`, chooses
`variant.muxVideo?.playbackId` and supplies `variant.hls` as `src` when no Mux
playback ID exists. Search's `playableDubWhere` in
`apps/admin/src/services/search-watchability.ts` requires nonempty HLS and allows
a nullable Mux playback ID. Neither path performs a live stream-health check in
that selection predicate.

Current recommendations have a narrower media contract. In
`apps/admin/src/services/recommendations/curated-pools.catalog.ts`, the selected
dub must be published, nondeleted, in the exact audio language, and associated
with a nondeleted Mux row with a nonempty playback ID of at most 512 characters.
Its optional edition must not be deleted. An HLS-only dub consequently produces
`exact_audio_unavailable` here even when the dub and its HLS URL exist. That
reason describes eligibility under this contract, not missing catalog audio.
`nominationEligibilityReasons` in `eligibility.ts` and the composition code in
`user-delivery.service.ts` also require a playback ID; changing only an inventory
query would not add HLS support to this API.

Curated hydration independently requires published, nondeleted, nonblank card
text under the exact requested `video_locale.locale`, a title of at most 512
characters, usable HTTPS artwork, a valid public video slug and no Watch
restriction/deletion. Among rows for that display locale, matching audio-language
text is preferred; matching audio language is not an additional mandatory text
join. After hydration, editorial exclusions, canonical deduplication and recent
viewing history can further reduce the returned set.

## How the map should drive curation

1. Identify actual distinct videos with declared sources in each exact audio
   language. Keep leaf content, streaming series and non-stream containers
   distinguishable. Retain all raw rows for inspection.
2. Overlay the 208 reviewed editorial choices and their alternate Core IDs.
   Report candidates outside those choices with titles, relationships, themes
   from the existing manifest, and source metadata. Unreviewed inventory is an
   opportunity for curation, not an automatically approved pool.
3. Report display, publication, source and artwork failures separately. Adding
   more interest labels does not repair missing translations or broken media,
   and overlapping pools do not create unique reserve inventory.
4. Materialize and validate a versioned pool through the existing Admin service.
   Retain profile-first filling, exact audio, deduplication and history rules.

The [fresh source comparison](video-variants-cross-check.md) and its timed media
observations complement the restored PostgreSQL snapshot. In particular, Persian
Sign Language's 61 HLS-only chapters exist locally, but their tested shortlinks
failed with redirect errors. Preserve that negative evidence; do not label those
streams healthy because the metadata contains a URL. All other untested sources
remain untested. Inventory reconstruction does not activate pools, enable text
fallback, or verify current production state.
