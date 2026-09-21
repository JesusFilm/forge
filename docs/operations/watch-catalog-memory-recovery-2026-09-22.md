# Watch catalog shared-memory recovery — 22 September 2026

Status: code and local proof complete; exact release and production observation
pending. Continue feat-496 under the
[runtime plan](../plans/2026-09-22-watch-runtime-error-formatting-plan.md).
This correction follows the separate error-amplification fix in PR #2369,
merged as `9492f01e92572777def7432d65b73f9910410fc4`.

## Cause and scope

The September 21 production burst started with PostgreSQL SQLSTATE 53100
(`could not resize shared memory segment`) in catalog hydration, then expanded
into 206 Yoga errors and a 38.55-second event-loop pause. PR #2369 removes the
repeated synchronous error inspection; it does not prevent the database error.

`createLoaders().videoMuxPlaybackIdByIdAndLanguageSlug` still used a nested
Prisma `take: 5`. The adapter fetched all eligible dubs, sorted them, and trimmed
them in application memory. The emitted SQL has OFFSET and no LIMIT. A real
PostgreSQL regression transfers **137,608 rows for 206 videos**, despite the
requested five-dub relation limit.

Bounded read-only production EXPLAIN, using 206 ordered active video IDs,
chooses a Gather Merge and Parallel Hash Join against the Mux catalog. It
estimates 35,280 output rows. These are representative catalog IDs, not recovered
incident parameters. Production estimates are 1,175 videos, 212,193 dubs and
176,297 Mux rows. Existing playable-duration and Mux primary-key indexes were
verified through `pg_indexes`. No production settings or data were changed.

An owned PostgreSQL 18 fixture reproduces SQLSTATE 53100 naturally with these
catalog cardinalities, the existing lookup indexes, 4 MB work memory, two
parallel workers per gather and ten concurrent reads. The local container has
64 MiB shared memory. This proves a workload that exhausts shared memory; it
does not establish the historical production concurrency or shared-memory size.

## Smallest correction

`apps/admin/src/services/video-mux-playback.ts` performs the existing
primary-within-five policy in a parameterized LATERAL query. PostgreSQL selects
the five eligible dubs in duration-descending, ID-ascending order, then chooses
the primary language within that set or its first entry. It returns one scalar
playback ID per video. DataLoader retains per-request caching and input order.

The production estimated plan now uses the existing playable-duration index
and Mux primary-key lookups, with per-video LIMIT 5 and LIMIT 1. No parallel
hash, new index, migration, pool enlargement, deadline change or retry is added.
Requested-language lookup, deleted/unpublished filters, non-null HLS/playback
semantics, PostgreSQL null ordering, empty strings and missing-video behavior
are preserved. Identity, authorization, capability budgets and mutation commit
boundaries are unchanged. Other Mux metadata loaders are outside this correction.

## Validation

The [checked-in results](../validation/watch-catalog-bounds-20260922/results.json)
retain separate SQL-only, actual Prisma and actual Next build populations.

| Actual Prisma adapter, four rounds of ten concurrent reads |    Existing |      Corrected |
| ---------------------------------------------------------- | ----------: | -------------: |
| SQLSTATE 53100 failures                                    |       20/40 |           0/40 |
| Request elapsed range, including failed calls              | 53–1,570 ms |       32–83 ms |
| Returned playback choices in the sequential parity check   |         206 | 206, identical |

The independent SQL-only experiment had 20/40 control failures and zero fixed
failures; it is not the same population as the table above. Its local database
execution plans took 206.4 ms for 37,286 rows versus 24.9 ms for 206 rows.
The initial synthetic fixture omitted the existing duration index: the first
bounded join avoided shared-memory errors but was slower. That candidate was
not accepted as performance proof; final comparisons include the verified
indexes for both implementations.

The actual production Next build was then run against an owned database with
the full current schema and the same catalog cardinalities. Three rounds each
issued ten simultaneous 206-video GraphQL catalog reads, five real selection
mutations and one real playback write. All **30 catalog reads** returned 206
videos without GraphQL errors (99–262 ms). All **15 selections** were accepted
in **239–330 ms**, within the unchanged 700 ms boundary. All three playback
writes were accepted in **262–319 ms**. This is local workload evidence, not a
production error-rate estimate or proof of the earlier capability-budget cause.

The real PostgreSQL regression first passed two behavior cases and failed the
row bound (137,608 versus at most 1,236). All three pass with the correction.
They run through the existing Watch PostgreSQL CI entry point in
`apps/admin/src/services/recommendations/playback-episode.db.test.ts`.
Fifteen loader unit tests, all 7,293 Admin tests, Admin lint, typecheck and
production build pass. One initial full run timed out an unrelated editor
test while build/lint were concurrent; all 81 editor tests and the full suite
subsequently passed without changing that test or its timeout.

## Release and closure gates

Incorporated newer main `dab14b21717f5c5ce271236841d6c4ab6eeaac37` before
the PR. Review sequentially under Compound Engineering, rerun relevant checks,
and release only through the normal PR-to-main deployment path. Verify exact
Admin and worker revisions and the compiled LATERAL helper. Continue sustained
Datadog/Railway observation with HTTP failures separate from HTTP 200 semantic
fallbacks. Retained spans are samples, not request denominators.

Keep feat-496 in progress: the isolated 701 ms capability-budget call has no
complete native-pool/database/WAL attribution. The shared-memory reproduction
and error-logging fix do not prove that separate cause. No production fault
injection, runtime monkeypatch, diagnostic setting change or manual redeploy
was used. The owned local services remain isolated from other agents.

PR #2370 independently records restoration of the authored English homepage
block for a tester pilot. The user subsequently confirmed that it must remain removed. This task is
preparing the single-block rollback through the authenticated publishing path;
no authenticated Admin browser is currently connected. It has not changed the
content or recommendation flag. Do not claim the block is still absent.
