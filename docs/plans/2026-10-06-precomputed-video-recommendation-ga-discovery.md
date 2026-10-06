# Historical GA source qualification

Observed October 6, 2026 (Pacific/Auckland), through the authenticated Google
Analytics and Google Cloud browser interfaces and the BigQuery, GA Data, and GA
Admin APIs. This is discovery evidence for
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
  temporary storage, without changing shell profiles. The user completed the
  remote-machine ADC flow using their Mac browser and the remote Linux terminal.
  Credentials exist on the remote machine with owner-only mode `600`; token
  refresh and BigQuery table metadata reads succeeded. This grants Cloud API
  access under existing account permissions, not a read-only OAuth grant. No
  service account, IAM change, or API enablement was introduced by the agent. The command
  omitted `analytics.readonly`: a direct GA Data API Watch-report request returned
  HTTP 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT`. This is an OAuth-scope gap, not proof
  of missing GA property access or absent data.
  Adding that scope with the default ADC OAuth client then produced Google's
  "This app is blocked" screen. SDK 587.0.0 explicitly lists
  `analytics.readonly` among scopes being blocked for its default client; Google's
  ADC troubleshooting guide documents this failure and directs non-Cloud scopes
  to a project-owned OAuth client or service-account impersonation. The previous
  Cloud ADC file remains present with mode `600`. Do not retry the same default
  client or infer a Workspace-admin policy from the generic error alone.
  A custom-client remote flow also requires `--no-browser`, not
  `--no-launch-browser`, according to the installed SDK's validation. No custom
  client, service identity, policy exception, or permission change was made by
  the agent.
  The existing account also cannot open Google Auth Platform's Clients page in
  `jfp-data-warehouse`: the console lists missing `iam.serviceAccounts.list` and
  `oauthconfig.verification.get`. This proves that page is inaccessible, not
  that every OAuth creation permission was independently tested. No access
  request was submitted. A project with authorized OAuth configuration access
  or help from the existing project's administrator is needed for that route.

## Service-account API access verified

Tatai supplied project `jesusfilm-org-1738781064783` and service account
`watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com` for
property `320198532`. The existing remote Cloud ADC identity successfully
impersonated that account for a ten-minute `analytics.readonly` access token.
Tokens remained in memory; no key was downloaded, no token was printed or saved,
and the existing ADC file was not replaced. Google Auth's Python impersonated
credentials also refreshed and read metadata successfully.

The initial Analytics request explicitly set this project's quota header and
returned `USER_PROJECT_DENIED` for `serviceusage.services.use`. The standard
service-account request without that optional override returned HTTP 200;
additional IAM grants were unnecessary for the verified reads. No APIs, IAM
policies, GA property access, or scheduled jobs were changed by the agent.

Verified reads:

- GA Data `runReport`, exact `hostName` allowlist and `pagePath` full regex
  `^/watch(/.*)?$`, both case-sensitive. September 8–October 5 returned all 32
  event rows, including 283,569 page views and 1,016 `videostarts` at that read.
- GA Data property metadata, including registered custom dimensions. The older
  `customEvent:mediacomponentid` is registered; `customEvent:video_id` is not.
- GA Admin property metadata: created June 21, 2022, timezone
  `America/New_York`, Analytics 360, correct account and property IDs.
- Watch-only monthly/event report from creation through October 3, 2026:
  all 200 rows returned with a 300-row limit. The response charged 26 reporting
  quota tokens; this is API usage, not a warehouse bytes or monetary-cost figure.

| Event            | First observed month | Last observed month | Events    |
| ---------------- | -------------------- | ------------------- | --------- |
| `page_view`      | July 2022            | October 2026        | 6,154,161 |
| `videostarts`    | September 2022       | October 2026        | 4,006,892 |
| `videoplay`      | September 2022       | October 2026        | 3,885,439 |
| `videocomplete`  | September 2022       | July 2026           | 408,619   |
| `video_progress` | July 2026            | October 2026        | 592       |

This proves historical reporting aggregates are available, not complete raw
event history or unchanged event semantics. Starts fell from 92,154 in July 2026
to 2,159 in August and 1,380 in September; page views did not fall proportionally.
That discontinuity must remain visible during measurement qualification.

A separate recent-window event/media-ID report returned all 55 rows. Of 1,017
starts, 297 had a nonempty/non-placeholder media ID and 720 did not. The count
differs from the earlier 1,016; the separate requests and dimension breakdowns
have not been reconciled into a frozen snapshot. A path/media-ID start report
returned 100 of 541 rows as a discovery sample, explicitly incomplete. Paths
include legacy `.html` video/language routes. Neither those paths nor familiar
media IDs have yet been mapped to canonical Admin Videos in this adapter.

Metadata contains an event timestamp custom dimension but no registered session
ID or proven source/target aggregate. No viewer IDs, user-level event sequences,
or custom identity dimension values were requested. Standard report totals and
referrers do not establish the required consecutive-video-start transitions.
Authentication is resolved; mapping, sequence provenance and adapter acceptance
remain open. API access does not silently relax the existing transition guard.

Task-local evidence is under `/tmp/forge-feat-590-orchestration/`:
`ga-service-account-probe-default-quota.json`, `ga-sa-metadata.json`,
`ga-sa-property.json`, `ga-sa-watch-monthly-coverage.json`,
`ga-sa-video-id-coverage.json`, and `ga-sa-watch-start-paths.json`.
The task-local `ga_api_read.py` uses existing ADC plus impersonation and only
metadata or aggregate report operations; it is a discovery helper, not the
production historical reader.

### Reader continuation: explicit source truncation

A further Watch-only `videostarts` report for June 21, 2022–October 3, 2026,
grouped by year and excluding empty or unset `mediacomponentid`, returned five
rows. Unlike the earlier standard-dimension monthly report, this report included
`metadata.dataTruncationReasons`: `DATA_TRUNCATION_TYPE_PROPERTY`, with the
explicit statement that data is complete only after August 5, 2022. Returning
every `rowCount` row is therefore insufficient to claim complete coverage.
Preserve the requested range and source warning; do not silently shorten the
range or turn unavailable earlier data into zero events.

The report returned non-placeholder media-ID starts of 140,046 (2022), 468,073
(2023), 785,855 (2024), 958,692 (2025), and 985,136 (2026 through October 3).
These are ID presence counts, not verified canonical mappings. Cross-report
comparisons suggest the large historical missing-ID gap is in 2023, while the
recent-window gap is concentrated in a small part of 2026; the reports are not
an atomic reconciled snapshot. This request consumed 626 API quota tokens.
The property currently declares `eventDataRetention: FIFTY_MONTHS` and
`userDataRetention: FOURTEEN_MONTHS`; those settings alone do not establish
recoverable ordered sequences. Evidence:
`ga-sa-watch-start-id-coverage-by-year.json` and `ga-sa-retention-settings.json`
under the task-local evidence directory.

The existing current route classifier/manifest and
`watchVideoRouteSnapshotBySlug` can identify current catalog candidates, including
episode-parent/language checks. They do not by themselves establish historical
slug ownership or the GA media-ID namespace. A bounded unauthenticated Admin
GraphQL lookup for two candidate slugs returned HTTP 403, so no live canonical
mapping was claimed. The read-only code report is
`/tmp/forge-feat-590-orchestration/2568-ga-path-mapping.md`.

The GA reader/preflight implementation is proceeding independently of those
external source qualifications. The existing generation transition guard remains
unchanged; no unavailable transition signal may become a fabricated zero.

The first live smoke of the TypeScript reader used its default impersonated
authentication path, without a supplied bearer token or SEO credential override.
For June 21, 2022–October 3, 2026 it returned 200 monthly/event rows plus five
identified-start rows in two report requests: 4,006,892 total starts and 3,337,802
starts with a non-placeholder media ID. It correctly returned
`status: incomplete`, `reason: source_truncation`, and
`sourceAvailableAfter: 2022-08-05`; mapped-event counts remain unknown.
The aggregate-page smoke returned 100 of 152,280 path/media-ID rows with
`nextOffset: 100`, the same truncation warning, and explicit unverified mapping
and unavailable transitions. This was one bounded page, not a complete import.
Evidence files are `2568-ga-reader-live-coverage.json` and
`2568-ga-reader-live-starts.json` in the task-local evidence directory.

The server-side reader is configured with `PRECOMPUTED_GA4_PROPERTY_ID` and
`PRECOMPUTED_GA4_SERVICE_ACCOUNT_EMAIL`. Production dependency wiring is pinned
to the verified property `320198532`, its creation date, and `America/New_York`
timezone. It requests dates through the last fully closed property-local day
before the generation cutoff and rejects a changed response timezone. Partial
days are deliberately excluded from this preflight. The read-only inspection
command accepts an explicit date range, for example from the Mastra package:

```sh
pnpm inspect:precomputed-ga-watch --start=2022-06-21 --end=2026-10-03 --mode=coverage
pnpm inspect:precomputed-ga-watch --start=2022-06-21 --end=2026-10-03 --mode=starts --offset=0
```

Use the existing remote ADC impersonation setup; this command does not require
an API key or downloaded service-account key. It reports only aggregates.
`mediaComponentIdCoverage` explicitly names `customEvent:mediacomponentid` and
keeps `canonicalVideoMappedEvents: null`. A successful inspection command is
not a successful recommendation build: generation still fails before calling
the model when source qualification is incomplete or transitions are unavailable.
No production workload credential configuration or deployment has been performed.

The bounded git-history investigation found no assignment to GA
`mediacomponentid` in tracked Web/Admin/package code. Commit `344522291`
(July 21, 2026) introduced Watch's explicit GA player events using `video_id`
and `video_dub_id`; it did not supply the older dimension. Later consent-gate
changes (`96dc3aeee`, August 31; removal `09c74a948`, September 10) do not prove
deployment dates or explain the earlier August discontinuity. The unrelated
Arclight use of `mediaComponentId` is not a GA-to-Core crosswalk. External
tag/source definitions or a verified crosswalk remain required. Details:
`/tmp/forge-feat-590-orchestration/2568-ga-legacy-id-provenance.md`.

## Current GA reporting data

The GA dashboard contains current data. The age of the warehouse copies below
must not be generalized to the property's reports. On October 6, the standard
Events report for September 8–October 5, 2026 was temporarily filtered by:

- Page path and screen class matches regex `^/watch(/.*)?$`.
- Hostname matches regex `^(www\.)?jesusfilm\.org$`.

The report displayed all 32 event types and said it used 100% of available data.
Selected event counts were:

| Event                |   Count |
| -------------------- | ------: |
| `page_view`          | 283,064 |
| `session_start`      | 253,336 |
| `videostarts`        |   1,014 |
| `videoplay`          |     865 |
| `video_progress`     |     282 |
| `a_media_progress10` |     243 |
| `a_media_progress25` |     141 |
| `a_media_progress50` |      75 |
| `a_media_progress75` |      30 |
| `a_media_progress90` |      13 |

These are browser-observed aggregate counts, not ingested model evidence,
unique human plays, or sequence/transition proof. `videocomplete` was absent
from the 32-row filtered report; that absence must not be interpreted as proven
zero completions. The unfiltered all-site report had 27,258 `videostarts`, which
must not be used as Watch starts. Only temporary report filters were applied;
no property configuration or saved shared report was changed.

Sol's repository trace confirms the current Watch player still emits
`videostarts` on first play per video/dub identity, while `videoplay` is
repeatable. Start payloads use `video_id` and `video_dub_id`, and v1 player calls
do not explicitly supply a page URL. The observed start/play counts and URL
coverage therefore need source-level qualification rather than assuming every
event follows today's repository implementation. Direct GA report ingestion
needs the Analytics read-only OAuth scope and verified dimension/mapping
coverage; it does not require access to the BigQuery copies merely to read
aggregate reports. Ordered video transitions remain a separate unmet need.

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
Repository tracing confirms that Core GraphQL `Video.id` is preserved verbatim
as Admin `Video.coreId`: `apps/admin/src/services/core-sync/phases/sync-videos.ts`
fetches it, validates it through `schemas/video.ts`, and upserts by `coreId`.
Admin's own `Video.id` is a separate generated identity. Existing Manager-owned
rows with the same core ID are skipped, and successful full syncs soft-delete
missing Core rows; those cases must be handled by a live mapping check.

There is still no proven bridge from the warehouse's historical
`mediacomponentid` or `nextsteps.public_Video.id` to that Core GraphQL source.
The Core-to-CMS transcript helper is not that bridge. `VideoOrigin` identifies
an origin shared by multiple videos, not a unique video. Unknown or ambiguous
IDs must remain unmapped rather than joined by guessed equality.

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

A further schema read found `prod.stg_ga4_events` has separate
`media_component_id`, `wess_media_component_id`, `session_id`, timestamps and URL
columns. Its `video_activity_key` links to an activity-shaped dimension containing
`activity_exit_code`, `activity_id` and `api_session_id`; a populated activity key
alone does not establish canonical video mapping. `nextsteps.public_Video` is a
Datastream-shaped copy with an unenforced primary key and a 24-hour maximum
staleness setting. Those declarations do not prove freshness or source lineage.
No additional viewer rows or transition aggregates were read.

Additional successful jobs (same query project and US location):

| Job                                | Purpose                                   | Rows | Dry-run estimate |
| ---------------------------------- | ----------------------------------------- | ---: | ---------------- |
| `job_mteNo4rV2waFsyhtQDYJFHgJT8iR` | Combined-event and mapping-view metadata  |    4 | 10 MB            |
| `job_gjSjGoA6iCyBMsWct-r5nLpmN6Ns` | Watch-only combined-event coverage        |   30 | 15.71 GB         |
| `job_1WgaL645HvZiOjJdgWGO5lZZDpJg` | Watch-start aggregate key quality by year |    3 | 17.17 GB         |
| `job_F49pTGG8mpTqSC8jVqkQzh3ZpWRt` | Staging, activity and Video schemas       |    6 | 10 MB            |

The two combined-table reads used a maximum-billed-bytes cap of `20000000000`
and a 60-second timeout after inspecting each dry run. No sampled viewer rows
were downloaded and no transition aggregate was constructed from this still
unqualified candidate.

## Remaining acceptance

Find a verified current event source with usable sequence identity, or a
qualified pre-aggregated transition source. Verify source lineage, canonical
Video mapping, event definitions, complete historical range, timestamp/session
and tie-order semantics, and query usage. BigQuery ADC authentication is now
verified on the remote machine. Direct GA report access is now verified through
Tatai's service account with `analytics.readonly`; the earlier default ADC
client failure is resolved by supported impersonation.
No keys or authorization codes belong in chat.

Manual snapshots and browser automation were discussed but neither has been
implemented, and the historical-transition requirement has not changed.
Successful API authentication enables source inspection; it does not by itself
establish ordered transitions, full history, or canonical video mapping.

The user clarified that the existing GA dashboard is the available source, and
current Watch reporting data was verified there. The API dataset listing for
`cru-ga4-prod-1` exposes no datasets to this account, and a metadata GET for the
conventional candidate `analytics_320198532` returns denied-or-nonexistent; neither
establishes the project's actual dataset inventory. A staging coverage query
was dry-run only: its 21,461,098,825-byte estimate exceeded the existing
20,000,000,000-byte cap, so it was not executed. Independent Watch-scope and
provenance improvements can proceed with explicit fixtures. #2568 remains
incomplete, #2569 remains held, and public
activation, deployment, new exports and recurring refresh remain outside this
discovery work.
