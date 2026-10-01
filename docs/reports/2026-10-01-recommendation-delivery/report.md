# Why recommendations return empty and partial rows

The low fill rate combines a reproducible retrieval-order defect, inconsistent language identities, absent display translations and limited fallback inventory. It is not predominantly a timeout problem. This is a read-only diagnosis; no runtime fix or publication was performed.

## Cohort and verification

The exact original below-player request cohort is September 30, 07:42 through October 1, 07:42 NZDT, end exclusive (`2026-09-29T18:42:00Z` to `2026-09-30T18:42:00Z`). Fresh production reads reproduced all 5,958 requests: 4,633 full six-card rows, 395 partial rows and 930 empty rows. Thus any-card delivery is 84.39%, full delivery 77.76%, partial delivery 6.63% and empty delivery 15.61%. These are recorded requests, not verified distinct humans.

Railway still reports Admin/worker at `99554c8b0759ca4d88d02a0d63bf518e0a89b4cf` and Web at `2cada63166aabfa2d9214009c6515a4c7576e880`. Admin's internal database identity and the query connection were matched to its production PostgreSQL service without exporting credentials. The first database check was October 1, 08:30:46 NZDT. All queries were serial, read-only, time-bounded and rolled back. Catalog and replay observations are current snapshots, not a reconstruction of every historical request's inputs.

## Empty rows: reconciled reasons

| Recorded reason                   | Requests | Share of empty rows |
| --------------------------------- | -------: | ------------------: |
| No candidates                     |      811 |              87.20% |
| Missing compatible seed embedding |      118 |              12.69% |
| Retrieval timeout                 |        1 |               0.11% |
| Total                             |      930 |                100% |

The next layer explains substantially more than these generic reason codes:

- **683 empty requests span 99 locales with no published display-text rows and no active curated pool for that locale.** Of these, 576 have a compatible seed embedding; 107 also lack a seed transcript. The exact-locale display join cannot return a candidate, and the exact-context curated lookup cannot rescue it.
- **246 empty requests use `en`:** 235 have compatible seed embeddings but retrieve no candidates, while 11 lack the seed transcript. Of all English-locale empty requests, 222 are on the full `jesus` video. English locale does not establish English audio.
- **One Portuguese-locale request timed out.** It is the only timeout in this empty cohort.

The 118 requests labeled missing seed embedding all lack a transcript for that seed/locale in the current snapshot. There is no evidence here of those 118 being excluded solely by a stale embedding contract. That does not establish whether timed text exists upstream or whether ingestion can recover it.

An important diagnostic limitation: `recommendation_request` stores locale but not requested audio language. Audio is recoverable from served-item presentation when a card exists, but the inspected empty-request evidence does not preserve it. Consequently the precise requested audio and filter failure cannot be recovered for each of the 246 English-locale empty requests from this ledger. Do not attribute all of them to the reproduced defect below.

## Confirmed defect: audio filtering happens after the neighbor limit

The deployed [retriever](https://github.com/Jesusfilm/forge/blob/99554c8b0759ca4d88d02a0d63bf518e0a89b4cf/apps/admin/src/services/recommendations/delivery-retriever.ts#L98) takes up to 48 nearest transcript chunks per seed probe. Only afterward, in `eligible_chunks`, does it require a playable dub in the exact requested audio language and a published display locale. A bounded neighbor set can therefore be consumed by videos with the wrong audio; eligible videos farther down never reach ranking.

Read-only comparisons used the same source, locale, audio, seed sampling, vector bounds and final eligibility checks. The comparison adds the existing exact-audio predicate before the neighbor limit; it does not substitute another audio language or change production code.

| Video / exact audio               | Deployed SQL candidates | With audio eligibility before the limit |
| --------------------------------- | ----------------------: | --------------------------------------: |
| Birth of Jesus / Gbii             |                       1 |                                      36 |
| The Beginning / Kwanyama          |                       2 |                                      36 |
| Creation / Idioma Wanca           |                       4 |                                      31 |
| Birth of Jesus / English, control |                      20 |                                      36 |
| Full JESUS film / Gbii            |                       0 |                                       2 |

For Birth of Jesus/Gbii, 192 nearest chunk rows collapse to two eligible chunks from one video. Prefiltering instead yields 54 eligible distinct videos across the probes, capped to 36 returned candidates. The other language cases independently reproduce the same mechanism. Full JESUS/Gbii still only yields two candidates, demonstrating that filtering earlier does not guarantee six where the remaining exact-language inventory is small after source/parent/child exclusion.

These are SQL candidate counts before application canonical deduplication, ranking and issuance. They are not promises of final six-card delivery or a measured global lift. The diagnostic queries used a 25-second safety timeout, not the complete-service 1.5-second acceptance gate. An implementation must prove representative cold/warm and concurrent latency before shipping.

## Confirmed Chinese locale mismatch

The same request locale is used for both transcript retrieval and display-text publication. Mandarin's language mapping and transcripts use `zh`; published video text uses `zh-hans` and `zh-hant`. There are 472 videos with compatible `zh` embeddings but zero published `video_locale.locale = 'zh'` rows. The inspected Mandarin language record maps to `zh`; the example video has published simplified and traditional Chinese text, so this is not simply absence of Chinese content.

A current replay for JESUS/Mandarin finds 35 seed chunks and 384 nearest chunk rows but returns **zero candidates**. Keeping transcript retrieval at `zh` and changing only the display joins to the existing `zh-hans` rows returns **36 candidates**. This establishes the incompatible identity constraint, not permission to silently choose a script for every viewer.

Other failures have a different supply condition: Telugu has 231 compatible embedded videos and Central Kurdish 132, but neither has published display text under its requested locale. A Telugu replay reaches 47 neighboring transcripts and then loses all of them at eligibility. Treating every `no_candidates` result as a need for more embeddings would miss this.

## Partial rows and fallback behavior

Of 395 partial rows, 383 are recorded as `insufficient_candidates` and 12 as `eligibility_exhausted`. Distribution: 91 one-card, 110 two-card, 37 three-card, 83 four-card and 74 five-card rows.

All 386 English-locale partial rows use other exact audio slugs, and none of those locale/audio pairs has a current approved fallback pool. Examples include Gbii, Ipunu, Kwanyama and English African. Among nonempty rows with `locale=en` and exact `audio=english`, all 1,885 return six cards; empty English-locale rows cannot be included in that exact-audio comparison because their audio was not retained.

The remaining nine partial rows use French African audio with French display text, and do have a current curated context. The [delivery service](https://github.com/Jesusfilm/forge/blob/99554c8b0759ca4d88d02a0d63bf518e0a89b4cf/apps/admin/src/services/recommendations/delivery.service.ts#L1022) invokes curated fallback only when `selected.length === 0`. It deliberately leaves one-to-five-card results unchanged. A top-up policy is separate work; pool existence alone does not prove six currently eligible, unique, noncurrent cards.

The active fallback generation contains 51 exact locale/audio contexts across 21 locales and has not changed since September 14. It successfully rescued 521 requests in the original cohort, including 519 with missing seed embeddings. The fallback mechanism works where inventory exists. Expanding it is existing feat-497 scope, previously accepted as partial coverage rather than a universal launch gate.

## Recommended work and regression evidence

1. **Fix audio-aware bounded retrieval first.** Keep exact-audio eligibility inside candidate selection rather than losing the candidate budget before applying it. Preserve active-contract, source/parent/child exclusion, privacy, deduplication and the full-service deadline. Add a database fixture where the nearest 48 chunks lack the requested audio but at least six farther eligible videos exist; the service must return those eligible videos without wrong-audio cards. Target `delivery-retriever.db.test.ts` and `delivery-retriever.ts`.
2. **Separate transcript and presentation locale identities.** Define explicit Chinese script/variant resolution and display fallback policy rather than using one locale for incompatible records. Add a `zh` transcript plus `zh-hans`/`zh-hant` display fixture and an unavailable-translation fixture. Never silently change audio or weaken publication requirements. Trace Web locale construction, GraphQL inputs, cache keys, candidate context and Admin evidence together.
3. **Record audio context and stage shortfalls on empty delivery.** Retain bounded request-level locale/audio identities and distinguish absent transcript, no published display, absent exact dub, bounded retrieval exhaustion and missing curated context. Do not add viewer history or a second telemetry store.
4. **Handle coverage and optional top-up separately.** Reuse feat-497 for approved context expansion; distinguish missing display text from missing transcript sources under feat-199. A partial-row top-up must preserve semantic results and admit only distinct, eligible, exact-language reserve cards under the existing budget. The current empty-only behavior is intentional, not a failed fallback attempt.

Existing fallback tests mock empty retrieval and verify exact-language rejection; they do not exercise a real ANN population dominated by wrong-audio neighbors. Existing real-database latency checks do not establish this multilingual selectivity invariant. Add those targeted cases before implementing a fix. No new application tests were run in this diagnosis; the independent live read-only comparisons above are the reproduction evidence.

Feat-589 records the newly demonstrated retrieval and locale-identity repair. Feat-473 is complete for this investigation; operational fixes remain pending. Current catalog reads cannot assign a complete root-cause label to every historical empty request, and the sample replays cannot quantify the eventual global fill-rate improvement.

## Reproduction files

`overview.sql/json` reconciles the original request and stage counts, locales and active pools. `supply.sql/json` resolves packed/legacy item audio and current seed/publication state. `partial-seeds.sql/json` records aggregate public-video examples and embedding/display coverage; `locale-identity.sql/json` checks publication and language mappings. Named replay SQL/JSON pairs reproduce each comparison. `metadata.json` records provenance and bounds. Run SQL only inside verified read-only transactions with UTC parsing, bounded statement/lock timeouts and rollback; no credentials are included.
