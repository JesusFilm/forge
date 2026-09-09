# Recommendation locale coverage

Use this runbook to distinguish missing source transcripts, incompatible embeddings, missing published card text, and unavailable exact audio. A successful inventory check does not establish ANN recall, a delivered slate, or usefulness to viewers.

## Current inventory for an explicit input

From the repository root, with the standard Admin environment loaded (including its validated database and auth settings):

```sh
pnpm --filter @forge/admin recommendations:coverage \
  --seed '<Admin video ID>' --locale te --audio telugu
```

For an existing `apps/admin/.env`, run from that package:

```sh
pnpm exec tsx --env-file=.env src/scripts/diagnose-recommendation-coverage.ts \
  --seed '<Admin video ID>' --locale zh --audio mandarin-china
```

`--help` works without database configuration. Supply credentials through the existing secret manager or environment, not command arguments. The command opens a single-connection pool, enforces a read-only repeatable snapshot, and limits each statement to five seconds, lock waits to one second, and connection establishment to ten seconds. It closes its connection on success or failure. No recommendation request, experiment, enrichment job, or embedding write is issued.

Inputs preserve three different identities: Admin seed video ID, exact transcript/display locale, and exact audio language slug. The diagnostic intentionally does not infer `telugu` from `te`, or `mandarin-china` from `zh`.

| Output                                                   | Interpretation                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `seedTranscripts`                                        | Transcript rows for the requested seed and locale, before contract checks                                          |
| `seedCompatibleTranscripts`                              | Seed transcript rows matching the active provider/model/dimension/transform contract                               |
| `seedEmbeddedTranscripts`                                | Compatible seed transcript rows with at least one compatible, non-null chunk vector in the requested locale        |
| `candidateTranscripts`, `candidateCompatibleTranscripts` | Other transcript rows, excluding the seed and its direct parents/children, before and after parent contract checks |
| `candidateEmbeddedVideos`                                | Distinct candidate video IDs with compatible chunk vectors                                                         |
| `watchableVideos`                                        | Embedded video IDs after deletion and Watch restriction checks                                                     |
| `publishedLocaleVideos`                                  | Watchable video IDs with non-deleted, published metadata in the exact requested locale                             |
| `exactAudioVideos`                                       | Watchable video IDs with the explicit audio slug and a playback ID on the transcript's edition                     |
| `eligibleInventoryVideos`                                | Intersection of publication and audio eligibility on the same transcript row                                       |
| `publishedLocalesOnExactAudioVideos`                     | Available published display locales on the watchable exact-audio inventory; descriptive, never automatic fallback  |

Transcript counts and distinct-video counts have different units. Publication and audio are parallel checks after watchability. The final intersection does not apply the serving query's neighbor window, semantic ranking, cross-ID deduplication, recent-item suppression, or current profile eligibility. An empty `blockers` list means eligible inventory exists; it does not promise six delivered cards. Seed blockers and candidate blockers are reported independently.

The SQL reuses `activeTranscriptContentEmbeddingWhere` from `apps/admin/src/services/content-embedding-contract.ts`, including parent provenance and chunk language/model/dimension checks. Changes to serving eligibility must update these diagnostics and their real-database fixtures together.

## Repeat a fixed request cohort

Use a configured `psql` connection, such as an existing `PGSERVICE`, without putting credentials in the command. Save the result under a gitignored local directory:

```sh
mkdir -p .tmp/recommendation-locale-coverage
psql --no-psqlrc --quiet --tuples-only --no-align \
  --set cohort_start='2026-09-09T00:00:00Z' \
  --set cohort_end='2026-09-10T00:00:00Z' \
  --file docs/operations/sql/recommendation-locale-coverage.sql \
  > .tmp/recommendation-locale-coverage/cohort.json
```

The script rejects non-positive windows and windows longer than 24 hours, runs read-only with a five-second statement limit, and rolls back. Run sequentially; if a cohort times out, divide it into smaller non-overlapping windows. Do not sum distinct session counts across windows or locale groups.

`top_empty_or_unavailable_inputs` supplies at most ten seed/locale/result groups for the next inventory audit, ordered by request count. It contains content identifiers and aggregate demand, so keep the output private.

The denominator is persisted request rows in the inclusive-start/exclusive-end window, not all HTTP attempts or verified humans. `session_digests` is an aggregate count of pseudonymous sessions; it is not a user count. `requests_with_items` means a positive stored `expected_item_count`, not a confirmed browser render or impression. Latency percentiles use only non-null observations and include their denominator. Keep `served`, `fallback`, `empty`, and `unavailable` separate when comparing outcomes.

Record the deployed Admin and Web revisions, active embedding contract, cohort bounds, and diagnostic observation times beside each result. Compare similar windows and preserve sample sizes. Coverage and latency cannot establish recommendation usefulness; use valid impression, selection, and playback outcomes for that question.

Existing `recommendation_request` rows do not store requested audio for empty results. A replay with an explicitly chosen audio slug is a new audit input, not a reconstruction of those requests. This limits attribution of historical `no_candidates` cases even when the seed and locale are known.

## Remediation routing

| Confirmed blocker                                          | Next action                                                                                                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seed_media_missing`                                       | Reconcile the request source with the Admin video identity                                                                                          |
| `seed_transcript_missing`, `candidate_transcripts_missing` | Resolve exact edition/language timed text through the existing source workflow in `feat-199`                                                        |
| `*_contract_incompatible`                                  | Inspect active contract versus stored parent provenance before proposing any re-embedding                                                           |
| `*_chunks_unavailable`                                     | Inspect matching-language chunk completion and model/dimension compatibility                                                                        |
| `published_metadata_missing`                               | Check Core localized metadata and Admin `VideoLocale` ownership/publication; resolve display policy in `feat-475`                                   |
| `exact_audio_unavailable`, `publication_audio_no_overlap`  | Resolve the exact dub, playback readiness, and transcript edition; do not substitute a sibling language sharing BCP-47                              |
| No inventory blocker but empty retrieval                   | Replay the bounded serving query with known audio and its normal planner/deadline settings; inspect neighbor filtering and deduplication separately |

Localized text is synchronized by `apps/admin/src/services/core-sync/video-localized-metadata.ts`; embedding generation does not create it. Preserve Manager-owned locale rows. Chinese `zh`, `zh-hans`, and `zh-hant` are separate stored locale labels; availability under a script label does not authorize accepting it for a different request.

The source handoff should contain at most ten prioritized `(video ID, edition ID, exact audio slug, transcript locale)` targets, their fixed-window request counts, current transcript counts, and subtitle source-pointer availability. Store it privately. A subtitle pointer is not proof of usable timed text, and absent Admin subtitles do not establish absent Manager artifacts. Resolve Core subtitles first, then Manager transcript artifacts, before considering any separately authorized paid enrichment. Keep processing ownership in `docs/roadmap/content-discovery/feat-199-transcript-embedding-operations-promotion.md`.

The display-text follow-up is `docs/roadmap/content-discovery/feat-475-recommendation-display-locale-policy.md`. Until that policy is decided, the serving rule remains published text in the requested locale plus the exact chosen audio. Do not relax one SQL join while hydration, candidate evidence, or cache eligibility still enforce another rule.

## Verification

Unit tests validate inputs and blocker classification. `coverage-diagnostics.db.test.ts` uses a uniquely named disposable database on an explicitly local PostgreSQL instance with pgvector. It verifies provenance, publication, same-BCP47 audio siblings, edition compatibility, family exclusion, and read-only connection settings. Enable it only with `RECOMMENDATION_DB_TEST=1` and a local `DATABASE_URL`; the test creates and drops its own database.

This operator-only addition changes no serving path, schema, or frontend loading behavior. Validation of a later serving repair must include the existing 1.5-second retrieval budget, positive and negative eligibility cases, normal PR-to-main deployment, and post-deploy coverage measurements.
