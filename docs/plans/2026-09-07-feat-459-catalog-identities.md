# feat-459 execution plan

Prerequisite base: `b1f24f74` (reviewed 454 and 455). Implements the confirmed
Studio brief and full authoring plan. Publication remains feat-460.

## Scope and agreed seams

Neutral contracts and real disposable Postgres service/schema tests are the
user-agreed TDD seams. Use only port 55459 / forge_studio_459_test. Test real
concurrent identical ingest, conflicting replay, Core required/unique identity,
immutable derivation, materialized sources and current restrictions. Review
Standards and Spec independently against the fixed prerequisite base.

## Identity and retention

Nullable real Core IDs on Video, Dub and Edition retain global uniqueness and
CORE-required checks. Forge IDs/slugs identify generated records. MANAGER can
retain an existing real Core ID; never manufacture one. Generate hidden locale,
dub, edition and Mux associations in one serialized project transaction. Pin
immutable release evidence to exact revision/render, separate from draft edits.
Retain canonical 455 source snapshots, exact tuple/ranges, pack versions and
render/generation dependencies; descriptor digests are not media evidence.
Current eligibility restrictions govern staging and future publication.

## Consumer audit

- Admin video.ts: Video/Dub/Edition plus WatchCollectionFeedItem and
  WatchLanguageInventoryItem have non-null Core fields; update SQL DTOs too.
- Mapper catalog pages all dubs before exposing required Core IDs. Exclude
  generated identities before pagination; retain existing real-Core tombstones.
- Sync edition/Mux bulk conflict updates lack MANAGER guards. Bound changes to
  ownership protection and explicit real-ID maps; preserve incomplete-page and
  CORE-only soft-delete behavior, without redesigning sync.
- Manager read models already nullable. Legacy enrichment, automation, Smart Crop
  and Shorts require real Core identities; deliberately reject/exclude generated
  rows there. New Studio staging uses its own canonical command.
- Web detail normalization accepts nullable IDs. Home normalizeCard currently
  drops them; dynamic collection DTO and language inventory assume strings.
  Use Forge identity for general catalog cards, preserve curated Core lists.
- Mobile/TV playback uses Forge documentId; curated home hydration, TV showcase
  and experienceHydration remain explicitly Core-only. Pin safe nullable behavior
  without widening mobile UI release scope.
- Transcript ingest resolves Forge IDs but its response and Mastra contract require
  Core identity. Keep that legacy pipeline explicitly Core-only. Mapping/backfill
  scripts must exclude absent Core IDs. Typesense identifiers/dedup already nullable.
- Generic video-search-social locale writes need Studio release protection.
- Source Edition membership is through Dub.videoId/videoEditionId, not merely
  independently existing IDs. 455 owns canonical source registry/revalidation.

## Verification

Regenerate Prisma/Pothos, Admin SDL and gql.tada outputs with scripts. Run regular
focused tests/typechecks, final affected full suites/builds/format/lint. Record
frontend loading impact where rendering changes. Resolve independent review,
compound durable evidence, complete ticket and commit locally with hooks enabled.
No provider calls, shared database writes, uploads, push or publication.
