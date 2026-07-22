# Watch Home Modernization Missing Data

This file tracks source-design data that Forge cannot fully represent from
admin in the first watch home modernization PR.

Related implementation:

- `docs/roadmap/platform/feat-159-watch-home-modernization.md`
- `docs/roadmap/platform/feat-286-watch-home-editorial-programming.md`
- `docs/plans/2026-06-04-003-feat-watch-home-modernization-plan.md`
- `apps/web/src/lib/watch-home.ts`
- `apps/web/src/lib/watch-home-config.ts`

## Status After Editorial Programming (2026-07-22)

The Web editorial-programming and preview-exposure gaps are resolved by
`feat-286`. A locale's Admin-authored `WatchHomeHeroBlock` can now contain a
once-per-entry intro, typed video and promo buckets, and an exact repeating
rotation. Web resolves that document into playable slides, assembles a fresh
queue on every entry, and records meaningful browser exposure separately from
signed-in watch progress. The static Web playlist and promos remain only as a
migration fallback for missing, invalid, or wholly unplayable programs.

Mobile and TV do not consume the new hero program. Native adoption is an
intentional residual, not an incomplete part of `feat-286`; it should receive a
separately scoped roadmap ticket if product chooses to align those playback
experiences. Existing native home-parity tickets must not be read as silently
including this Web playback change.

The local/staging seed remains placement-only. A valid promo program requires
approved Admin `MediaAsset` poster IDs, so production editors publish the
program through the normal Admin Experience workflow instead of committing
environment-specific asset identities to the seed.

## How Gaps Are Reported

`resolveWatchHome` returns a `missingData` array on the server-side model. Each
entry includes:

- `sectionId` - home section or hero scope.
- `sourceId` - source Core id or source system identifier.
- `field` - `record`, `title`, `image`, `href`, `mux-insert`, or
  `local-thumbnail`.
- `detail` - exact missing source/admin condition.
- `fallback` - what Forge renders in this PR.
- `followUp` - recommended next PR shape.

The runtime inventory is not rendered to viewers. It exists so browser proof and
PR review can inspect concrete admin gaps without turning them into in-app
warnings.

## Known Source-System Gaps

| Gap                                | Source Reference                                                                                                        | Current Forge Fallback                                                                                            | Follow-Up                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Non-catalog Mux hero insert slides | `apps/watch/src/components/PageMain/useWatchHeroCarousel.ts` supports `CarouselMuxSlide` entries.                       | Resolved on Web through Admin-authored intro and promo buckets; static inserts remain fallback-only.              | Native adoption remains separately scoped.                                                      |
| Local thumbnail/poster overrides   | Source app uses watch-local thumbnail assets outside admin/Core data.                                                   | Cards use admin `VideoImage` fields, then Mux thumbnail, then styled placeholder.                                 | Ingest source thumbnail overrides into admin/Core image data or add editor-owned poster assets. |
| Editor-managed hero programming    | Source app hardcodes arrays in `collectionShowcaseConfig.ts`; Forge originally mirrored them in `watch-home-config.ts`. | Resolved on Web through the Homepage Experience's `WatchHomeHeroBlock`; static config is the migration fallback.  | Native adoption remains separately scoped.                                                      |
| Meaningful preview exposure        | The original Forge-native queue treated a slide as played as soon as it became active.                                  | Resolved on Web with visible-playback, explicit-skip, and short-promo-completion rules in a browser-local ledger. | Keep preview exposure separate from account progress on every future client.                    |
| Beta cookie routing parity         | Production beta design depends on an external cookie state.                                                             | Local route always renders the new Forge home once this PR lands.                                                 | Document exact cookie name/value only if product still needs dual home routing.                 |
| Analytics parity                   | Source app carries analytics tags on some sections.                                                                     | Visual/content parity only.                                                                                       | Add home hero/card/section analytics after data and design stabilize.                           |

## Runtime Gap Examples

These entries are emitted by `apps/web/src/lib/watch-home.ts` when admin data is
missing:

| Field    | Example Condition                                                                                     | Current Forge Fallback                                                      | Follow-Up                                                   |
| -------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `record` | `watchHomeVideos` does not return a configured Core id such as `11_Advent`.                           | The affected card or section is omitted.                                    | Verify admin Core sync coverage or replace the source id.   |
| `title`  | Admin returns a video without a published localized `VideoLocale.title` for the active home language. | The card uses slug or Core id.                                              | Backfill or publish localized metadata.                     |
| `image`  | Admin returns no cinematic/still image for a source video.                                            | The card uses Mux thumbnail when available, otherwise a styled placeholder. | Enrich admin/Core images or ingest source poster overrides. |
| `href`   | Admin record has an invalid public slug or the language slug cannot be represented by route builders. | The card renders without a link.                                            | Fix admin slug/language data before linking.                |

## Source IDs Mirrored In This PR

These IDs now describe the legacy Web fallback, not the primary authored hero
program. Production program membership is managed in Admin.

- `collectionShowcaseSources`: `1_jf-0-0`, `2_GOJ-0-0`,
  `GOMattCollection`, `GOMarkCollection`, `GOLukeCollection`,
  `GOJohnCollection`
- `collectionLumo`: `LUMOCollection`, `GOMarkCollection`,
  `GOLukeCollection`, `GOJohnCollection`
- `christmasAdventShowcaseSources`: `2_0-ConsideringChristmas`,
  `2_0-SupremeChristmas`, `2_0-Noelevator`, `2_0-TimeForChange`,
  `2_0-Stunned`, `1_wl604412-0-0`, `9_0-TheSavior5505`,
  `1_cl1301-0-0`, `3_0-40DWJ_02-0-0`, `1_jf6102-0-0`,
  `1_riv_11-0-0`, `1_wl604410-0-0`, `6_GOLuke2601`,
  `6_GOLuke2602`, `6_GOMatt2501`
- Primary collection sections: `11_Advent`, `7_0-ncs`,
  `7_Origins2Worth`
- `newBelieverCourse`: `8_NBC`
