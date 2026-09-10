---
title: "Extend recommendations without a seed while preserving profile and coverage boundaries"
date: "2026-09-10"
category: "architecture-patterns"
module: "Admin and Web user recommendations"
problem_type: "architecture_pattern"
component: "service_object"
severity: "high"
applies_when:
  - "Adding a source-free surface to a video-seeded recommendation system"
  - "Using curated pools only to fill missing personalized results"
  - "Exposing anonymous profiles to cookie-free clients"
tags: [recommendations, profiles, curated-pools, pgvector, native-api, coverage]
---

# Source-free recommendations with bounded curated reserves

## Context

The Watch homepage needs six recommendations without a current video. Existing
Admin profiles, qualified playback, privacy generations and vector retrieval can
be reused, but anonymous identity transport, selection-surface validation and
fallback coverage cross several independent boundaries.

## Guidance

**Count profile results after filtering.** Apply exact language eligibility,
canonical deduplication and recent completion rules before testing whether the
profile supplies six cards. Retrieve curated candidates only for a shortfall;
append them without replacing sufficient profile candidates. Preserve optional
embedding identity internally for deduplication, and construct the public DTO
explicitly so vectors and fabricated semantic metadata cannot escape through
object spreads. `user-delivery.service.test.ts` proves six-plus-zero,
four-plus-two, cold-start, alternate-edition suppression and persistence failure.

**A nullable seed must not produce a NULL exclusion row.** The existing SQL used
`NOT IN (SELECT id FROM excluded_video_ids)`. A NULL introduced by the source-free
seed poisons the predicate and rejects every candidate. Filter the seed arm with
`WHERE seed IS NOT NULL`; retain ordinary relation exclusions for seeded calls.
The real-Postgres profile projection test now obtains useful candidates both with
and without a seed after one qualified outcome.

**Distinguish a qualified interest from click-only intent.** The shared profile
retriever can return session interests before a qualified watch. Expose the
durable qualified-interest count internally and gate this surface on it, while
preserving the existing seeded surface's behavior. Test both a click-only profile
and retrieval following the first qualified outcome.

**Carry the surface through the complete evidence chain.** Accepting a new
capability surface in delivery alone is insufficient. Evidence verification,
selection, impression policy, integrity classification and profile lineage must
agree on the request's persisted surface. Review initially found the old literal
in `RecommendationIntegrityService.classifySelection`: valid For you selections
would be accepted over HTTP yet remain excluded from learning. The classifier
now requires the persisted surface to match the impression and tests both lanes.

**Separate application, installation and session identity.** A fleet bearer
identifies a consumer application. A random installation handle resolves the
server-owned anonymous profile; a separate high-entropy session token binds
playback. A spoofable rate-limit label is never profile authority. Compose viewer
creation/profile transitions atomically and retain generation/erasure controls.
This gives native clients cookie-free access without linking people across devices.

**Prove reserve capacity from eligible inventory.** Several theme pools can be
views of the same starter union. They do not multiply available stories. Six
cards with at most 24 recent exclusions needs a thirty-video eligible reserve;
a maximum count of twenty needs forty-four. Audit exact UI/audio contexts and
canonical identity, not language labels or raw catalog counts. A local audit
found 35 languages below six across the catalog under the current recommendation
filters. That is an eligibility count, not proof that dubs are missing. A later
source check found Persian Sign Language's 62 HLS declarations already in Admin:
61 fail the recommendation Mux requirement, and their live shortlinks also failed
with redirect errors. Keep those distinct causes explicit.

**Build the catalog map before applying delivery filters.** Start with all
`video` and `video_dub` rows, retaining optional language, edition and Mux links
through left joins. Overlay exact `video_locale` keys, publication/restrictions,
artwork and editorial membership afterward. Core `videoVariants` are Admin dubs;
raw variants also include non-stream collections. Separate declared HLS/Mux
sources, observed stream health, distinct videos and current recommendation
eligibility. The ordinary Watch player supports HLS without Mux, while the
recommendation contract currently requires a playback ID. Likewise, missing
card text cannot establish missing audio: all 200 display-blocked contexts in
the audit had substantial audio inventory. Use canonical `language_locale`
names and exact language IDs/slugs; preserve the legacy name map only as a
compatibility observation.

**Audit every exact locale key without repeating every database query.** Extract
shared publication, dub and image metadata in a read-only snapshot; reuse the
real curation materializer and compare representative results with the ordinary
audit service. Group identical output rows losslessly rather than sampling
languages. This covered 521,325 UI/audio contexts while retaining every zero
and every interest-pool count. The audit exposed both absent translations and
the `zh-Hans`/`zh-hans` identity mismatch. A locale listed in Web's UI catalog
does not prove published video text exists under that exact key. Preserve
translation eligibility instead of assuming that a working audio dub is enough.

**Separate immutable editorial data from mutable eligibility.** Seal the source,
ordered pools and provenance together. Promotion and rollback compare the active
version and recheck current eligibility; serving also rechecks a bounded candidate
set. Canonical JSON hashing preserves source digests across PostgreSQL JSONB key
normalization. This supports one-time curation now and deterministic updates later
without a live model call.

**Register the homepage surface as an Experience block.** A React component
inserted through a category appendix is not independently authored content. Use
the complete `HomepageRecommendationsBlock` pipeline: validated discriminator,
editor library/controls, GraphQL object and shared live/draft fragments, then Web
section dispatch. Preserve stored order and removal. Only placement and an
optional heading belong in the block; the private recommendation request stays
client-side. Deploy the Admin schema before the Web fragment and activate content
separately, following the existing mixed-version rollout guidance.

## Verification and references

The implementation and local preview are on `codex/feat-477-user-recommendations`.
Production coverage remains gated; these are implementation learnings, not a
production success claim.

- [Consumer and operations contract](../../operations/user-recommendations.md)
- [Exhaustive local coverage evidence](../../recommendations/curation/2026-09-10/all-context-coverage-report.md)
- [Recommendation boundary hardening](production-recommendation-boundary-hardening-pattern.md)
- [Recover transient admission on profile refresh](../ui-bugs/watch-recommendation-consent-refresh-in-flight-admission-race.md)

## Release integration checks

A disabled UI flag does not remove an unknown GraphQL type from a shared
Experience fragment. Admin and Web deploy independently: extend the existing
legacy-query fallback for `HomepageRecommendationsBlock` in both content and
preview loaders. Test homepage resolution, explicit Experience lookup, and the
bounded retry using both older block schemas. Publish the new discriminator only
after Admin has deployed; no content migration should introduce it early.

Database tests that create isolated schemas must include new migrations whenever
they call current Prisma services. Adding `RecommendationRequest.purpose` affects
Prisma reads and insert return values even in seeded delivery tests; adding viewer
retention also affects the existing purge test. Updating only the production
migration chain leaves these fixtures inconsistent. Run the real PostgreSQL suite,
including seeded delivery, retention, profile concurrency and the new pool tests.
