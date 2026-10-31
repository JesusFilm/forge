# FGE-24 DEFAULT lexical locale integration

Date: 2026-10-31. Roadmap: incoming feat-635 is reserved to feat-922.
Status: source preparation in progress; execution and independent review pending.

## Semantic visibility follow-up

Review of the lexical repair found `R2615-INHERITED-VISIBILITY-SEMANTIC`:
successful DEFAULT transcript retrieval can still return Watch-restricted
metadata. A high-similarity unavailable semantic hit can exceed minimum
confidence, and the public response has no later visibility filter. The older
database fixture deliberately rejected the embedder and did not exercise this
success path. This mechanism is inherited and source-established; actual
semantic reproduction remains pending.

Explicit repair scope now includes
`apps/admin/src/services/hybrid-search-retrievers.ts` and its colocated test,
raising the main-relative scope from nine to eleven paths. Apply the existing
`notRestrictedFromWatchSql("v")` to the video join in
`visible_semantic_candidates`, before `transcript_source` orders and caps
results. Preserve provenance, locale, per-video evidence collapse, score,
playback, generic/editor exports and all four lexical gates. Visible content
without playback remains eligible; this does not add a playable-content gate.

The new SQL-construction regression expands real Prisma fragments in place
and requires the restriction inside the visible-candidate CTE before its cap.
Existing test helpers append fragment text and cannot prove placement. The new
test is unexecuted in this source pass. Require meaningful old-source
RED/new-source GREEN, plus actual SQL, DEFAULT service and public GraphQL
controls with a successful deterministic local query embedding, a valid active
contract/pointer, real pgvector vectors, no lexical match and no provider call.
Test high-ranked hidden rows before visible rows under limit one, stable page
concatenation, other-platform restrictions and visible unavailable positives.

On the prior `73de2133003bfeda3aac62eb312a7ad5ead46ac3` tree, 150 focused
tests and three lexical SQL-construction RED/restored GREEN controls passed.
The R5 brief incorrectly required `--skipLibCheck false`, overriding the
repository's declared `true`; the first shard reported 982 dependency
declaration diagnostics. Those failed receipts remain preserved. New validation
uses the unchanged declared compiler policy and normal 8192 MiB serial method,
with no source-config change, new suppression or root omission, before pending
SQL/public controls. Keep new source review, hooks/current CI and runtime and
performance gates open; no approval or readiness follows from source alone.

## Review prerequisite: DEFAULT metadata visibility

Independent review found inherited `R2615-INHERITED-VISIBILITY`: all three
lexical retrievers and the curated exact-title branch admitted videos whose
Core `restrict_view_platforms` contains `watch`. Real PostgreSQL and DEFAULT
service controls reproduced this on both main and the original integrated
tree. Watchability marked these records unavailable, but exact-title retention
still exposed their metadata. This is a visibility defect, not a playback or
authentication bypass, and no deployed inventory exposure is established.

The resumed PR repair includes this narrow eligibility prerequisite under the
existing Watch visibility contract. Reuse `notRestrictedFromWatchSql("v")` on
all four video joins before ordering and limits. Preserve visible videos with
no playable dub, curation position/deduplication, display copy, locale ranking
and pagination. The current production caller is DEFAULT Watch search; the
generic/editor search and its principal-aware visibility helpers are unchanged.
No new ranking criterion, schema, mode, provider or serving-pointer change is
included, and the broader FGE-24 criteria remain open.

The original integrated tree `65fa11279575176284ec6ba0ebac48c49c08d6fe`
passed 120 focused tests, four actual-main RED/restored GREEN controls, the
9,622-test Admin suite, complete four-shard Admin types, 35 candidate and 20
main SQL/service controls, six EXPLAIN plans and 18 interleaved timing samples.
These results stay attributed to that tree. Its visibility controls reproduce
the defect and do not establish eligibility acceptance. Small-fixture plans did
not select GIN; no production planner/nonregression claim follows. The R4 shared
temporary-cache preservation audit gap remains recorded; future TSX uses an
owned TMPDIR with its cache disabled.

New SQL-construction tests cover each organic branch and curated re-entry.
They have not run in the source-repair pass. Require old-source RED/new-source
GREEN controls on real SQL, DEFAULT composition and the public GraphQL path,
including restricted-only and alias-only records, visible unavailable content,
other platform restrictions, curation and stable pagination. Fresh independent
review, current checks/hooks/CI and relevant runtime/performance evidence remain
required. Keep feat-922 and FGE-24 in progress.

## Scope and parents

Integrate PR [#2615](https://github.com/JesusFilm/forge/pull/2615), published head
`39498262e58fa11e17d2ec9a0b2620f849490381`, with actual main
`c2e4bd3aec94198fc074ec7c37e546469d6001d1`. Keep those legitimate parents in
a detached, staged, uncommitted merge. Exclude coordinator `2fdee1e` source.

The October 8 FGE-24 owner comment authorizes the lexical-locale criterion.
Generic media-token normalization, canonical/playability boosts and the full
multilingual inventory benchmark remain unresolved, separate work. Original
observer is unknown. Selected production MODERN/CANDIDATE does not use this
DEFAULT primary ranker; DEFAULT shadow cannot change the primary response.
There is no automatic MODERN-to-DEFAULT error or timeout fallback. Selected
platform configuration does not attest deployed release or runtime health.

## Implementation

1. Preserve current main orchestration in
   `apps/admin/src/services/watch-search.service.ts`. Derive lexical locale
   from query slug mapping, query BCP-47, explicit-target-only mapping/BCP-47,
   then display fallback. Pass display locale separately to all three lexical
   retrievers. Carry matched title through metadata/curated fusion and use it
   for whole-title ordering and evidence score, with legacy title fallback.
2. Retain `hybrid-search-keyword-first-retrievers.ts` publication, deletion,
   noindex, bound SQL, token cap, shared GIN expressions and curation windows.
   Rank/filter lexical rows, project one stable published display row with
   row-presence fallback, and break locale/video ties deterministically.
   Curated alias projection continues to require a display-locale row.
   Qualify the source `title_matched`/`curated` sort flags inside deduplication:
   their window-output aliases are constant across the video partition and
   must not hide the organic-row preference when curated rows overlap.
3. Return optional nullable query/target BCP-47 metadata from
   `search-language-resolution.ts` using the existing canonical identity rows.
   Preserve exact-slug ambiguity, signal precedence, caches and script/named
   behavior. Add no language detector, provider call or extra identity lookup.
4. Retain existing tests and add discriminating es/fr versus en display,
   query precedence over explicit target, unmapped canonical BCP-47, non-explicit
   target controls, matched-title ranking, display copy and SQL-shape coverage.
   Update real producer expectations without weakening existing assertions.
5. Rename only this incoming ticket and its README reference to feat-922.
   Preserve PR2630's distinct feat-635 and PR2384's reserved feat-919/920/921,
   PR2647's feat-918, existing rows/statuses and empty dependency edges.

Expected delta against actual main: original seven paths (ticket renamed),
this plan, meaningful `search-language-resolution.test.ts` coverage, and the
two semantic visibility repair paths named above: eleven paths total.

## Boundaries

Keep the current 2300 ms hard budget, 1900 ms retrieval cutoff and 400 ms
hydration reserve, lane degradation/diagnostics, query embedding cache,
curation first-page guarantee, watchability, privacy/tracing and known-caller
authorization. Display copy, lexical evidence and playback target stay separate.
MODERN CURRENT/CANDIDATE ranking, physical collections, generation, revisions,
qualification, Serving pointer, configuration and public contracts stay intact.
No Pothos/schema/generated-client changes. Preserve GA/Datadog and analytics
policy, including no consent prerequisite and accepted sparse coverage.

## Validation and review

This bounded pass permits scoped existing Prettier, whitespace and static source
checks only. No tests, types, lint, build, hooks, server, browser/device,
database/EXPLAIN, provider/ranking or loading execution. Existing PR2384 validation
owns the Forge heavy slot. No dependency installation or cache mutation.
Own source self-check is not independent review or approval.

Source preparation preserved main's service lifecycle and test coverage; only
the README had a textual merge conflict. Its resolution retains main's rows,
adds the incoming row and increments total/in-progress counts once. Prettier
also adjusts table padding for the dated incoming row. No existing cell value
or feature status changes. The candidate remains uncommitted and unvalidated.

Future red/green: run the focused service, retriever and language producer cases
against actual main (wrong lexical locale/matched-title assertions must fail),
then this integrated candidate (must pass), using the same test sources:

```sh
pnpm --filter @forge/admin exec vitest run src/services/watch-search.service.test.ts src/services/hybrid-search-keyword-first-retrievers.test.ts src/services/search-language-resolution.test.ts --maxWorkers=2
```

Later authorized validation must include resolver/yoga, deadline, shadow,
privacy, watchability and SQL-parity suites; Admin typecheck/test/lint/format/build,
SDL consistency, normal hooks and exact integrated-head CI. Real PostgreSQL
fixtures must cover missing/duplicate/unpublished/deleted display rows, lexical
recall, noindex, curated overlap and deterministic pages; EXPLAIN/latency must
verify planner and deadline behavior. SQL mocks cannot establish those facts.
Mode controls must show DEFAULT behavior and unchanged MODERN with no automatic
fallback. Later isolated runtime benchmarking needs release/mode attestation,
canonical entity/rank/availability/action-language/retriever evidence and relevant
Web loading/analytics checks. None is claimed executed here.

## Compound note

A source locale repair can affect only shadow or other DEFAULT callers while
MODERN/CANDIDATE serves production. Keep source diagnosis, selected configuration,
historical CI, integrated execution and runtime acceptance as separate evidence.
Audit roadmap identities across retained branches and reservations, not main alone.
