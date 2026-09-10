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

## Completed verification — 2026-09-08

Implementation commit `3bfe2ecc252ddd8c2761f9e8fff577ed90f8e384` was reviewed
against prerequisite base `b1f24f748fd4097cdb234b92eda04860619f14ef`.
The separately reviewed source-trigger correction `dd3465cc` is already integrated
by the coordinator; exclude it and prerequisites from the final cherry-pick list.

- Empty disposable Postgres18 database: all **89 migrations** deploy; **28 Studio
  cases** pass, including all **132 preserved originals** and actual source/pack
  revision insertion. Separate real Core-sync ownership/tombstone test: **1 passed**.
  Prisma's read-only schema diff reports no new catalog-model drift; unrelated
  pre-existing schema differences are outside this slice.
- TDD evidence: null Manager identity rejected before migration; Manager edition
  overwritten before Core ownership guard; staged Video visible via direct lookup
  before release exclusion; Mux alias registration and moving a dub into a release
  accepted before their guards. All corresponding regressions now pass.
- Full Admin: **6,135 passed**, 114 skipped, one todo, and one environmental Redis
  fallback failure. Local Redis was running on6379; unchanged fallback suite passes
  **8/8** with `unshare --user --map-root-user --net pnpm --filter @forge/admin exec
vitest run src/auth/rate-limit.test.ts`. No shared Redis changes.
- Full Manager: **1,168 passed**. Full TV: **1,835 passed**. Full mobile: **2,736
  passed**, three failures in two files under concurrent build load; unchanged
  PlaybackHost and PlayerSettingsSheet files pass **116/116** in an isolated rerun.
- Full Web: **3,692 passed**, one skipped, one todo; translated-message formatting
  timed out under build load. The unchanged messages-parity suite passes **458/458**
  in isolation. The new nullable generated Watch card is covered; focused Watch
  home suite passes **13/13**. Neutral contracts: **4 passed**. Admin-graphql has no
  test files and its configured test command exits successfully.
- Typechecks pass: Admin, Manager, Web, mobile, TV, studio-contracts and
  admin-graphql. Production builds pass: Admin (including workflow bundle verifier),
  Manager and Web. Web requires `ADMIN_GRAPHQL_URL`; its successful build used
  `http://127.0.0.1:9/graphql`, not a production endpoint. Mobile/TV configured build
  commands pass but intentionally do not create native bundles; no native release
  artifact is claimed.
- Admin SDL and admin-graphql output were regenerated with package scripts and
  reproduced byte-for-byte. ESLint with zero warnings, full-tree Prettier and
  commit hooks passed for the implementation. No hook bypass.
- Loading impact: nullable card normalization adds no network request, module
  import, hydration effect, media initialization or cache invalidation. Existing
  cached Watch-home model behavior remains tested. Public lookup exclusion uses
  the unique release video-ID index; it adds no client roundtrip.

### Independent review

**Standards:** zero documented-standard violations. One nonblocking P3 heuristic
suggested sharing source fixtures across the source-trigger and catalog tests.
Disposition: keep fixtures independent so the focused prerequisite regression is
self-contained and the catalog test's materialization/policy mutations remain
explicit. No duplicated production behavior is involved.

**Spec:** zero actionable findings. The review independently checked native
identities, Core constraints, concurrent ingest, retained derivation, current
restrictions, sync ownership and public exclusion against the confirmed brief,
full plan and ticket.

Both reviews used the frozen candidate now committed as `3bfe2ecc`; final follow-up
changes only record verification and mark the ticket complete. Durable handoff:
`docs/solutions/database-issues/studio-generated-catalog-identity.md`.

### Remaining release gate

Feat-459 is complete. Feat-460 must produce actual render codec/dimension and signed
Mux-readiness proof, require trusted interactive human approval, revalidate current
source restrictions, and atomically admit immutable catalog visibility through its
dedicated publication boundary. This work performs no publication, production
write, paid call, upload, push, merge or deployment.
