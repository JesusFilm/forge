# Historical GA source qualification

Observed October 6, 2026 (Pacific/Auckland), through the authenticated Google
Analytics and Google Cloud browser interfaces. This is discovery evidence for
[#2568](https://github.com/JesusFilm/forge/issues/2568), not a completed ingestion
adapter or proof of live recommendation quality.

## Required scope

The user restricted recommendation history to `/watch` and `/watch/**` on
JesusFilm.org. Observed production hosts are `jesusfilm.org` and
`www.jesusfilm.org`. Parse the source URL, require one of those exact hosts,
and accept pathname `/watch` or the `/watch/` prefix. Query strings and fragments
do not participate in the path match. Exclude `/watching`, other site pages,
staging, translation/proxy hosts, and missing or malformed URLs. Keep exclusion
and mapping coverage explicit and event-weighted when the source provides event
weights. The discovery SQL used anchored host/path checks; it does not substitute
for the adapter's tested URL parsing and scope contract.

For successive-video evidence, order the original qualified start sequence
before applying endpoint scope. Both endpoints must be Watch. An intervening
non-Watch start or invalid URL must not be removed to fabricate a direct pair.
Successive starts do not prove recommendation clicks. Unknown historical bot
filtering remains unknown and separate from live A/B eligibility.

## GA property and access

- Account `181145622`, property `320198532`, Jesus Film - jesusfilm.org - GA4,
  Analytics 360.
- Registered event dimensions: `mediacomponentid`, `languageid`, `video_title`.
- Existing BigQuery link: project `cru-ga4-prod-1`, number `213317923036`,
  created March 7, 2023; daily event export checked, streaming unchecked,
  one selected stream and no excluded events. Default dataset creation
  location: US. No link or export setting was changed.
- Cloud browser login and read queries work in `jfp-data-warehouse`.
  `cru-ga4-prod-1.analytics_320198532` is only a conventional candidate;
  metadata and event-wildcard validation return access-denied-or-nonexistent.
  Do not present an empty Explorer tree as proof of missing permissions.
- Browser authorization is not local/server API authentication. Google Cloud
  SDK 587.0.0 was downloaded from Google and checksum-verified in task-owned
  temporary storage, without changing shell profiles. The standard local ADC
  sign-in is awaiting the user's account/consent action; it requests Cloud API
  access under existing account permissions, not a read-only OAuth grant. No
  service account, IAM change, or API enablement was introduced.

## Verified readable copies

| Table                                           | Shape                                                                                        | Actual Watch history  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------- |
| `jfp-data-warehouse.data_sources.ga4_320198532` | GA report aggregates with event count, minute, page URL and custom video/language dimensions | March 1–July 16, 2023 |
| `jfp-data-warehouse.prod.ga4_320198532`         | Flattened event-shaped rows                                                                  | March 1–July 16, 2023 |

Recent table creation times do not establish recent event history. Both copies
have matching Watch event totals; treat them as overlapping evidence and never
sum them. Their transformation lineage remains unverified.

| Watch event     |   Count |
| --------------- | ------: |
| `videostarts`   | 702,930 |
| `session_start` | 752,837 |
| `first_visit`   | 468,785 |

These are event counts, not unique sessions, bot-qualified plays, recommendation
clicks, or a live experiment baseline. The report copy contains 425,408
video-start aggregate rows, of which 33,146 have a nonblank media-component
dimension other than `(not set)`. That is row presence, not event-weighted or
canonically resolved mapping coverage.

All 702,930 Watch video-start rows in the flattened copy lack nonempty viewer
and session keys; every Watch event lacks a session key. Present timestamps
cannot recover viewer sequences. These sources cannot supply transition
evidence. Missing transitions are unavailable, not zero. Time proximity and
page referrer are not replacements for verified sequence identity.

Admin's canonical catalog exposes `Video.id`, unique `Video.coreId`, and `slug`.
The repository contains no proven bridge from historical `mediacomponentid` to
those identities. The Core-to-CMS transcript helper is not that bridge. Unknown
or ambiguous IDs must remain unmapped rather than joined by guessed equality.

## Read-only query evidence

Jobs ran in `jfp-data-warehouse`, US. Results returned metadata or aggregate
coverage, never individual viewer records. No destination table or scheduled
query was created. BigQuery's normal temporary result handling was retained.

| Job                                | Purpose                                  | Returned rows / limit | Dry-run estimate |
| ---------------------------------- | ---------------------------------------- | --------------------- | ---------------- |
| `job_edE0syivh3h4SpxZx-5AxaQgWQ4l` | Grouped table-family metadata            | 140 / 200             | 10 MB            |
| `job_RpRD3_jASIJ-CDv_QrGElwUc2E7T` | Exact-property table schemas             | 2                     | 10 MB            |
| `job_MXgk1pnbG4FIKJi3sdr6zRdCCLOc` | Flattened-copy host/path/date coverage   | 14 / 100              | 205.96 MB        |
| `job_cPWePS5xKJM510uT57rtDy2g-Ea1` | Watch-only report event/date/ID presence | 3 / 100               | 216.07 MB        |
| `job_xcGnitFa7xMl6L8v_d2Hqmbr0NrH` | Watch-only sequence-key completeness     | 3 / 100               | 293.26 MB        |

The three data queries used maximum bytes billed `500000000` and a 60-second
job timeout. Estimates are not a monetary cost report. The initial ungrouped
metadata discovery reached its 100-row limit; the grouped replacement above
did not. Neither establishes coverage of inaccessible projects or other regions.

## Combined-event candidate

A further metadata check found `jfp-data-warehouse.prod.int_ga4_events`, with
`web_page_url`, `event_date` (DATE), `event_timestamp`, `user_pseudo_id`,
`session_id`, `video_activity_key`, and pipeline validity fields. Its strict
Watch-only aggregate query returned 30 event names (limit 100). Watch page views
span January 1, 2021–May 19, 2026; video starts span January 1, 2021–April 21, 2023. The page-view range is not the video-start range.

| Event year | Watch video starts | Distinct viewer-key count | Distinct session-value count |
| ---------- | -----------------: | ------------------------: | ---------------------------: |
| 2021       |          1,410,043 |                   823,795 |                      897,940 |
| 2022       |            503,004 |                   276,227 |                      331,711 |
| 2023       |                  3 |                         3 |                            3 |

All those starts have nonempty keys, timestamps and video-activity keys and
are marked valid by the upstream pipeline. No tested common placeholder value
was found in their viewer/session fields. These checks do not prove collection
semantics, tie ordering, identity stability, bot filtering, or trusted eligibility.
The final 2022 video-start timestamp is in September; the three 2023 rows do not
establish continuing coverage. Individual keys were never returned.

Upstream job-reference discovery was refused because the signed-in account lacks
`bigquery.jobs.listAll` on `jfp-data-warehouse`. The query was not executed, and
no permission change was requested or made. The source lineage and its relation
to GA property `320198532` remain unverified; do not silently combine it with
the exact-property copies.

The mapping view `core_analytics_views.bi_view_media_component` selects
`nextsteps.public_Video.id AS media_component_id` and `originId AS source_id`.
`core_analytics_views.bi_view_video_variant` actually selects the Video table.
These definitions are useful leads, not proof of a temporally valid mapping to
current Admin Videos. Neither table names nor similar-looking IDs establish that
bridge.

Additional successful jobs (same query project and US location):

| Job                                | Purpose                                   | Rows | Dry-run estimate |
| ---------------------------------- | ----------------------------------------- | ---: | ---------------- |
| `job_mteNo4rV2waFsyhtQDYJFHgJT8iR` | Combined-event and mapping-view metadata  |    4 | 10 MB            |
| `job_gjSjGoA6iCyBMsWct-r5nLpmN6Ns` | Watch-only combined-event coverage        |   30 | 15.71 GB         |
| `job_1WgaL645HvZiOjJdgWGO5lZZDpJg` | Watch-start aggregate key quality by year |    3 | 17.17 GB         |

The two combined-table reads used a maximum-billed-bytes cap of `20000000000`
and a 60-second timeout after inspecting each dry run. No sampled viewer rows
were downloaded and no transition aggregate was constructed from this still
unqualified candidate.

## Remaining acceptance

Find a verified current event source with usable sequence identity, or a
qualified pre-aggregated transition source. Verify source lineage, canonical
Video mapping, event definitions, complete historical range, timestamp/session
and tie-order semantics, and query usage. Set up local/server read authentication
through a normal Google authorization flow without putting keys in chat.

The user has been asked for the current event table/view link or its data owner's
help. Independent Watch-scope and provenance improvements can proceed with
explicit fixtures. #2568 remains incomplete, #2569 remains held, and public
activation, deployment, new exports and recurring refresh remain outside this
discovery work.
