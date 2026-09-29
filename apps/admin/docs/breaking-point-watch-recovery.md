# Breaking Point recovery and search promotion review

Status: content and playback recovered; public search promotion awaits explicit
operator acceptance. Recorded September 30, 2026 (NZDT).

This records the initial manual recovery checkpoint. The subsequent request for
automatic import-to-Watch delivery is implemented in
[the publication plan](../../../docs/plans/2026-09-30-automatic-core-watch-publication.md).
It uses ordinary content publication against the existing qualified engine;
the pending manual acceptance bundle described here has not been submitted.

## User-visible result

[Breaking Point](https://www.jesusfilm.org/watch/breaking-point.html) now renders
all four episodes. Created, Sin, Jesus, and Invited each played in English in
the live browser. The underlying full replay completed with zero phase errors.

Private search against `breaking-point-recovery-20260930` returns the series
first, followed by all four episodes, each with an image and playback ID.
The final check returned HTTP 200, `degraded: false`, and Admin search latency
76.7 ms. Public Watch still selects the September 8 snapshot and therefore
still omits the series. This report does not claim public search is fixed.

## What changed

[PR #2476](https://github.com/JesusFilm/forge/pull/2476) removed a publisher-only
field from the anonymous Core query and capped dependent phase watermarks.
The full catalog/media replay then recovered content skipped during the outage.
No restriction was manually removed from Holly's videos. There is no evidence
that she added one. The optional Bearer/JWT mismatch was dormant and was not
the active production failure.

The new search snapshot has 1,134 catalog, 180,907 availability, and 24,590
lexical documents. It reuses the existing transcript collection and ranking
implementation; no ranking code or transcript embeddings changed.

## Evaluation evidence and limits

The deployed Mastra runner evaluated 83 development cases, then the frozen
21-case held-out set exactly once. Calls were sequential because simultaneous
private evaluation requests encountered publication-lock contention. The
unsuccessful concurrent baseline runs are retained as evidence.

| Observation                     |     Development |        Held-out |
| ------------------------------- | --------------: | --------------: |
| Search cases                    |              83 |              21 |
| Private request failures        |               3 |               0 |
| Model-rated useful or excellent | 49 / 80 (61.3%) | 15 / 21 (71.4%) |
| Model-rated unacceptable        | 10 / 80 (12.5%) |   1 / 21 (4.8%) |
| Private caller p95              |        8,307 ms |        2,617 ms |
| Successful Admin search p95     |          206 ms |          342 ms |
| Degraded successful responses   |               0 |               0 |
| Canonical duplicate results     |               0 |               0 |

The previous snapshot's sequential development baseline had zero request
failures, four degraded responses, and caller p95 2,988 ms. It was not model
judged, so these measurements do not establish a pointwise relevance change.
Across the 80 successful paired cases, 76 retained the same top result and
67 retained the same full top-ten order. No previously nonempty case became
empty. Normal, unrelated Admin releases occurred during the evaluation;
this was not an isolated fixed-load benchmark.

Automatic qualification did **not** pass: reviewed relevance labels are absent,
the model quality thresholds are not all met, and private caller latency
exceeds the 550 ms gate. Full fixed-load, exact-key RAM, incremental-disk,
steady/peak capacity, swap/free-disk, build/import, and Current-interference
benchmarks were not run. Any operator acceptance must explicitly retain those
gates as `FAIL` or `NOT_RUN` with the reasons in the evidence bundle.

Limited resource observations: the build took about 228 seconds; disk usage
increased about 762 MB and resident memory about 68 MB; swap stayed zero.
Public control searches continued returning successful MODERN responses.
These observations do not substitute for the missing benchmarks.

## Exact release identity

- Candidate: `breaking-point-recovery-20260930`, `READY`, version 1.
- Index contract: `watch-search-candidate/v4`; ranking: `title-and-brand-v3`.
- Evaluation revision:
  `watch-search-candidate:6b8e8b8e925c72b4ea945d2f4fe1040ea1472fe3eb405f04cae6da292b5595d0`.
- Transcript: `watch_search_transcripts_2026-08-11T21_40_18_843Z`, revision 1;
  embedding contract `semantic-transcript-pgvector-v2`; chunking
  `enriched-transcript-v2`.
- Proposed acceptance revision:
  `none:operator-accepted:breaking-point-recovery-20260930`.
- Current SERVING pointer: September 8 generation, version 5. Re-read before
  any compare-and-set operation; never reuse this observed version blindly.
- Full raw evidence is retained locally in
  `/tmp/breaking-point-recovery-evidence/`. The pending 2.7 MB acceptance bundle
  contains exact bindings, raw development/held-out/baseline outputs, measured
  results, waived gates, limitations, and the merged repair PR trail.
  `userAcceptance` is null and its status is `PENDING_USER_ACCEPTANCE`; it is
  deliberately not a valid promotion authorization.

## Proposed rollout after acceptance

The [production runbook](../../../docs/operations/typesense-watch-search-production-readiness.md)
requires dated user acceptance for a candidate whose automatic gates did not
pass. Do not manufacture that acceptance or describe this snapshot as qualified.

1. Record the actual acceptance statement, reviewer, and date in the bundle;
   retain the real failed/missing gates. Hash the exact final bytes and record
   the qualification using the deployed operator CLI. Recording does not pin.
2. Coordinate Admin's environment changes with normal PR-to-main autodeploys.
   First stage `WATCH_SEARCH_PRIMARY_MODE=DEFAULT` without triggering a manual
   deployment, then release the reviewed operational record through main.
   Verify all serving replicas use DEFAULT and drain the prior replicas.
3. Recheck the exact candidate, qualification, Current bindings, and fresh
   SERVING pointer version. CAS-pin the accepted candidate while every replica
   uses DEFAULT. Read the pointer back independently.
4. Stage the new Candidate selector and acceptance revision together with
   `WATCH_SEARCH_PRIMARY_MODE=MODERN`. Merge the second release record through
   main and wait for normal successful deployment. Never redeploy local code.
5. Verify canonical-origin public GraphQL and the live English Watch search UI
   return Breaking Point and its episodes. Click the series and test playback.
   Only then mark feat-578 complete.

The temporary DEFAULT phase avoids the existing failure mode: changing the
SERVING pointer while old replicas still select the September 8 generation
makes every MODERN request fail. A rollback also needs coordinated normal
releases; retain both generations and their qualifications.

Automatic future catalog publication and bounded Core workflow steps remain
separate follow-ups in feat-576 and feat-577.
