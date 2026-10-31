---
id: feat-922
title: Watch search lexical locale follows query language
owner: vlad
priority: P1
status: in-progress
start_date: "2026-10-07"
duration: 2
depends_on: []
blocks: []
tags: [admin, watch-search, i18n, ranking]
---

## Problem

Watch Search used the display or route locale for lexical video-title
retrieval, even when the query language or selected target language identified
a different locale. This reduced title recall for explicitly selected Spanish
and French searches under English UI chrome.

Linear source: [FGE-24](https://linear.app/jesus-film-project/issue/FGE-24).

## Progress

PR [#2615](https://github.com/JesusFilm/forge/pull/2615) prepares the
lexical-locale correction, keeps result text in the display locale, scores
exact hits with the matched-language title, and makes localized row selection
and ranking ties deterministic. The broader FGE-24 scope remains open for
generic media-token normalization, canonical/playability boosts, and the full
multilingual inventory benchmark.

October 31: integrating published `39498262e58fa11e17d2ec9a0b2620f849490381`
with actual main `c2e4bd3aec94198fc074ec7c37e546469d6001d1` as a staged,
uncommitted candidate. Execution and independent review are pending; keep this
ticket in progress. Incoming feat-635 is renamed to reserved feat-922 to preserve
PR2630's distinct topic-experiences feat-635 and PR2384's feat-919/920/921.
Dependencies remain empty: a namespace collision is not a feature dependency.

Selected production MODERN/CANDIDATE does not receive a primary ranking benefit
from this DEFAULT repair. There is no automatic MODERN-to-DEFAULT error/timeout
fallback; DEFAULT shadow cannot alter the primary response. Selected platform
configuration does not attest deployed release, process or generation health.

## Scope

Review prerequisite `R2615-INHERITED-VISIBILITY`: real main/candidate DEFAULT
SQL and service controls reproduced Watch-restricted metadata appearing as
unavailable exact-title cards. The repair applies the existing Watch visibility
predicate to all three lexical retrievers and the curated exact-title branch
before ranking/limits. Visible unavailable content remains eligible; generic
editor search, playback rules, ranking criteria and MODERN/CANDIDATE stay
unchanged. New source-level SQL controls are prepared; fresh review and actual
old/new SQL/service/public-GraphQL, pagination and performance checks remain
open. This prerequisite does not complete the broader FGE-24 scope.

Follow-up review found an inherited semantic sibling: successful transcript
retrieval could reintroduce restricted metadata after lexical filtering. The
semantic video join now applies the same canonical Watch predicate before its
candidate cap, preserving visible unavailable records and existing provenance,
scores and playback behavior. This adds the semantic retriever and its test to
the bounded scope (eleven main-relative paths). The new source control is
unexecuted; require actual successful-local-embedding pgvector/DEFAULT/public
RED/GREEN and stable-page controls. R5's 150 passing lexical units stay on the
prior tree; its stricter `skipLibCheck=false` failure is preserved. Next types
use the repository's unchanged declared `true` policy. Keep this ticket in
progress and retain all broader FGE-24 acceptance gaps.

- `apps/admin/src/services/watch-search.service.ts` — derive lexical locale
  from query language, then selected target language, then display/route locale.
- `apps/admin/src/services/watch-search.service.test.ts` — cover query and
  target locale precedence for keyword, trigram, and exact-title retrieval.
- `apps/admin/src/services/hybrid-search-keyword-first-retrievers.ts` and its
  colocated test — lexical filtering, stable published display-row projection,
  matched-title metadata, curated alias display copy and deterministic SQL ties.
- `apps/admin/src/services/search-language-resolution.ts` and its colocated
  test — canonical nullable query/target BCP-47 metadata without another lookup
  or changed signal precedence.
- `apps/admin/src/services/hybrid-search-retrievers.ts` and its colocated test
  — canonical Watch visibility in semantic candidates before limiting, with
  visible unavailable and active-provenance behavior preserved.
- `docs/plans/2026-10-31-fge-24-default-lexical-locale-integration.md` — exact
  scope, preserved boundaries and future validation.

## Grep These

- `lexicalLocale`, `displayLocale`, `matchedTitle`, `evidenceBoost`
- `bcp47ForCanonicalSlug`, `explicit_target`, `candidate_sources.title_matched`

## Constraints

- Keep UI/display locale separate from search lexical locale.
- Query language wins when known; only an explicitly selected target may
  override display locale when query language is unknown.
- Rank with the lexical locale while returning title and description text in
  the display locale when that translation exists.
- Do not add Latin-script language detection or change playback language
  interpretation in this ticket.
- Preserve current Admin deadlines, lane degradation/diagnostics, query embedding
  cache, curation first-page guarantee, watchability, privacy and caller auth.
- No MODERN/CANDIDATE ranking, schema, generation, revision, configuration,
  eligibility or Serving pointer changes; preserve current analytics policy.

## Verification

- NOT RUN in this source-only pass: tests, types, lint, build, hooks, CI, real
  database/planner, provider/ranking, runtime and loading validation.
- Future focused red/green command (against actual main with the same new tests,
  then the integrated candidate):

  ```sh
  pnpm --filter @forge/admin exec vitest run src/services/watch-search.service.test.ts src/services/hybrid-search-keyword-first-retrievers.test.ts src/services/search-language-resolution.test.ts --maxWorkers=2
  ```

- Then verify resolver/yoga/deadline/shadow/privacy/watchability and SQL parity;
  current Admin types/test/lint/format/build/SDL consistency, normal hooks and
  exact integrated-head CI. No Pothos or generated client change is included.
- Real PostgreSQL fixtures must cover missing/duplicate/unpublished/deleted
  display rows, published lexical recall, noindex, organic/curated overlap,
  minimum curation positions and deterministic adjacent pages. Measure real
  EXPLAIN/latency; SQL-shape mocks are not database or planner proof.
- Later authorized runtime validation must attest loaded mode/release and record
  canonical entity, rank, inventory, playback action language and retriever
  evidence. Broader FGE-24 normalization/boost/benchmark acceptance stays open.
