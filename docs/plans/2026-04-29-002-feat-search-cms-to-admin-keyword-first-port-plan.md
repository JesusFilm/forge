---
title: "feat(admin): port keyword-first lexical search to admin (R4 extension)"
type: feat
status: active
date: 2026-04-29
origin: docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md
predecessors:
  - docs/plans/2026-04-23-002-feat-admin-r4-hybrid-search-plan.md
  - docs/plans/2026-04-29-001-feat-search-keyword-first-mode-plan.md
---

# feat(admin): port keyword-first lexical search to admin (R4 extension)

## Overview

Port the keyword-first lexical search capability that shipped to
`apps/cms` in PR #852 onto `apps/admin`'s R4 hybrid search foundation.
Same opt-in `mode="keyword-first"` contract, same byte-identical-default
invariant, same dilution cap and origin-gated debug payload — implemented
against admin's Prisma schema (per-locale `VideoLocale` rows, cuid ids,
Prisma migrations) instead of cms's Strapi v5 link-table model.

This is **an extension of R4**, not a new R-stage. R4's
`HybridSearchService` is the orchestrator we extend; the four R4
retrievers stay untouched on the hybrid path; the keyword-first branch
adds three new retrievers + the post-fusion cap. After R8 consumer
cutover, cms's keyword-first work is deprecated alongside the rest of
cms search.

## Problem Frame

The keyword-first capability was built on cms (PR #852, merged) when it
should have extended admin's R4 (PR #837, merged 2026-04-23). The miss
is documented in
`docs/solutions/workflow-issues/check-migration-playbook-before-extending-source-side-20260429.md`
and `docs/solutions/best-practices/challenge-predecessor-plan-framing-and-read-named-memory-pointers-20260429.md`.

Per the migration playbook
(`docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md`),
all new search work belongs on admin. cms is the source side; admin is
the destination. R4 is the right foundation for any new search
capability.

The recovery path is to port keyword-first to admin so admin's search
surface matches the cms-side contract by R8 cutover. Until R8, both
surfaces coexist (cms serves consumers; admin is canary).

## Inherited Assumptions to Challenge

Per the new compound learning
(`docs/solutions/best-practices/challenge-predecessor-plan-framing-and-read-named-memory-pointers-20260429.md`),
every load-bearing decision from the predecessor plan
(`docs/plans/2026-04-29-001-feat-search-keyword-first-mode-plan.md`) is
re-derived against admin's repo state below. Empty re-derivation cells
would be a blocking review comment.

| Inherited assumption (from cms feat-109)                                                      | Re-derived against admin                                                                                                                                                                                          | Still valid?                                              |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `mode` is a nullable String, not a closed enum                                                | Future modes (`"instant"`, `"persona-aware"`) ship without GraphQL schema changes. Pothos accepts nullable `String` args; warn-and-fall-back semantics work the same.                                             | **Yes**                                                   |
| Single branched orchestrator, not twin functions                                              | Admin's `HybridSearchService.search()` is the natural branch point. R4 already centralizes embed → retrieve → fuse → dedup → paginate. Same shape.                                                                | **Yes**                                                   |
| Default behavior MUST stay byte-identical to main when `mode` is unset/null/""/hybrid/garbage | R4's response contract is the new baseline. Test-first regression snapshot lands before any keyword-first code.                                                                                                   | **Yes — same posture, snapshot is against R4's behavior** |
| Dilution cap default 0.5×, top-N=3                                                            | No reason to change. R4's RRF is verbatim port of cms (k=60, OVERFETCH_FACTOR=3).                                                                                                                                 | **Yes — same starting values**                            |
| Origin-as-soft-gate for `debug` payload (not auth)                                            | Same threat model. Admin's CORS allowlist is configurable via env. Fail-closed on undefined origin still applies. Per `docs/solutions/security-issues/origin-header-soft-gate-not-security-boundary-20260429.md`. | **Yes — same posture**                                    |
| Bootstrap-on-every-boot pattern (idempotent DDL) via `ensure-search-lexical.ts`               | **NO — flips.** Admin uses Prisma migrations (`prisma/migrations/0009_*/migration.sql`), append-only. Same idempotency property at the migration layer.                                                           | **No — Prisma migration replaces on-boot DDL**            |
| Strapi v5 raw SQL (snake_case, `knex.raw`)                                                    | **NO — translates.** Admin uses Prisma `$queryRaw` template literals + `Prisma.raw(EXPR)` for unbindable fragments. R4 already established the pattern.                                                           | **No — translates to Prisma idioms**                      |
| Locale filter via `bcp_47` link tables (`languages.bcp_47 = ?`)                               | **NO — flips.** Admin filters via `vl.locale = ?` (column on `VideoLocale`). The `Language.bcp47` field is only consulted in semantic-video's `VideoDub` LATERAL lookup.                                          | **No — direct column filter**                             |
| Single-row `videos.title` / `videos.description`                                              | **NO — flips.** Admin's title/description live on `VideoLocale` (per-locale rows). The new generated columns and GIN indexes are on `VideoLocale`, not `Video`.                                                   | **No — schema attachment changes**                        |
| Retrievers return rows that need `annotateVideo()` to inject `resultType`/`resultId`          | **NO — already adopted.** R4 retrievers return `RankedItem`-shaped rows directly. The new keyword-first retrievers should match this.                                                                             | **No — stronger pattern, no annotate step**               |
| `MAX_EXACT_TITLE_TOKENS = 16` token cap (DoS guard)                                           | Same DoS guard rationale. Admin doesn't loosen any input bounds vs cms.                                                                                                                                           | **Yes**                                                   |
| Log-injection sanitizer on user-supplied `mode` value                                         | Same threat. Admin uses Pino-equivalent logging; same `replace(/[\r\n\t]/g, " ").slice(0, 64)` sanitizer applies. Confirm logger surface during implementation.                                                   | **Yes — apply with admin's logger**                       |
| Six cms-paths solution docs                                                                   | **NO — extend.** The six docs need cross-references to admin paths (or new admin-side companion docs). The R4-extension solutions doc is the natural anchor.                                                      | **No — solution docs need admin-side cross-refs**         |
| `searchMode` (response field) vs `mode` (input arg) naming collision                          | Same trap on admin (R4 already exposes `searchMode: "hybrid" \| "keyword-only"`). GraphQL schema description must explicitly disambiguate.                                                                        | **Yes — same disambiguation discipline**                  |

## Requirements Trace

From the playbook (R4 contract) and the cms feat-109 origin:

- **R1.** Add a nullable `mode` argument (REST query param + GraphQL
  nullable `String` arg) on admin's existing search surface. Accepts
  `"hybrid"` (default) and `"keyword-first"`. Unknown values fall back
  to hybrid with a structured warn log; never error.
- **R2.** Default behavior is byte-identical to admin's R4 main when
  `mode` is unset or `"hybrid"`. Locked in by a snapshot test that
  runs throughout the PR.
- **R3.** `mode="keyword-first"` activates the new video lexical stack
  on admin's data model: phrase-aware tsquery (`websearch_to_tsquery`),
  per-field weighted tsvector (`title_tsv` weight A, `description_tsv`
  weight B) on `VideoLocale`, trigram matching on `VideoLocale.title`,
  exact-token-in-title retriever as the 4th RRF list. Experience
  retrievals (semantic + keyword) stay unchanged in either mode.
- **R4.** DB infrastructure (`pg_trgm` extension, weighted generated
  columns on `VideoLocale`, GIN indexes) lands in a Prisma migration.
  Dormant on the hybrid path; the legacy R4 keyword retriever
  (`searchVideoKeyword` against the existing
  `video_locale_fulltext_search_idx`) stays untouched.
- **R5.** Optional `debug=true` (REST query param + GraphQL arg)
  surfaces per-retriever ranks + fused score + dilution-cap state per
  result. Origin-gated at the boundary (REST controller + GraphQL
  resolver); service trusts the boolean.
- **R6.** `searchMode` response field semantics (`"hybrid" |
"keyword-only"` — degradation signal) preserved verbatim. The new
  input `mode` is orthogonal; documented disambiguation in the
  GraphQL schema description.
- **R7.** Strapi-v5 conventions DO NOT apply on admin. All raw SQL is
  Prisma `$queryRaw` template literals; column names map to
  snake_case in DB but `Prisma.raw(...)` is reserved for unbindable
  expression fragments (per R4's established pattern).
- **R8.** Admin's R0 (Core sync entity coverage) is upstream-blocked.
  This plan ships code that's correct against admin's schema; data
  lands when R0 runs. Real-DB integration tests are a deferred
  follow-up gated on R0, same posture as R4 + R5.

## Scope Boundaries

**In scope:**

- Prisma migration `0009_keyword_first_lexical/migration.sql`: pg_trgm
  extension; generated `title_tsv` (A) + `description_tsv` (B) columns
  on `VideoLocale`; weighted GIN index; GIN trigram index on
  `VideoLocale.title`.
- Shared SQL constants in
  `apps/admin/src/services/hybrid-search-sql.ts` (the existing R4
  module, extended). Per `docs/solutions/best-practices/gin-byte-parity-trigram-vs-expression-indexes-20260429.md`,
  byte-parity guards apply only to the expression-based weighted GIN —
  the trigram path uses operator-class indexing and needs no shared
  constant.
- Three new retrievers in
  `apps/admin/src/services/hybrid-search-keyword-first-retrievers.ts`
  (sibling to the R4 retriever module): `searchByKeywordWeighted`,
  `searchByTrigram`, `searchByExactTitle`.
- Branched orchestrator: `mode` plumbed through
  `apps/admin/src/services/hybrid-search.service.ts`, REST handler at
  `apps/admin/src/app/api/search/route.ts`, and GraphQL resolver at
  `apps/admin/src/graphql/queries/hybrid-search.ts`.
- Semantic-dilution cap behind `SEARCH_DILUTION_CAP_ENABLED` (default
  on for keyword-first; no-op for hybrid).
- Origin-gated `debug` field via a new
  `apps/admin/src/services/hybrid-search-debug-allowlist.ts`. GraphQL
  surface adds `SearchResultDebug` + `SearchRetrieverRank` types with
  retriever labels marked UNSTABLE in schema descriptions.
- Default-mode regression snapshot test (gating, test-first).
- Bible Project headline acceptance test (orchestrator-level, mocked
  retrievers).
- Updated `apps/admin/CLAUDE.md` "Hybrid search keyword-first mode"
  section appended after the R4 section.
- New solution doc:
  `docs/solutions/platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md`.
- Cross-links to the admin-side from the six existing cms-paths
  solution docs from feat-109.

**Out of scope (deferred follow-ups):**

- **Consumer cutover (R8).** apps/web / mobile / tv keep calling cms's
  search endpoints during the R3→R8 window. R8 is a separate
  one-shot.
- **Deprecating cms keyword-first.** Happens at R8 alongside the rest
  of cms search deprecation. This plan does NOT delete cms code.
- **R0 Core sync.** Tracked as
  `docs/roadmap/platform/feat-109-admin-core-sync-entity-coverage.md`.
  The keyword-first port ships code that's correct against the
  schema; meaningful prod data depends on R0.
- **Real-DB integration tests** (`EXPLAIN`-based GIN-index
  verification, Bible Project headline against seeded fixtures,
  canary diff vs cms across a fixed query set × locales). Same
  posture as R4 + R5: deferred until R0 lands. Captured here as
  the explicit follow-up gate.
- **`statement_timeout` for SQL retrievers.** Pre-existing
  cross-cutting concern (R4 doesn't have it either). Broader-scope
  follow-up; not introduced in this PR.
- **Token-based debug auth.** Origin gate is the soft feature flag
  posture inherited from cms; replacing with auth happens only if
  the debug payload starts carrying user-scoped data.
- **Tolerant parser for `SEARCH_DILUTION_CAP_ENABLED`** (currently
  only literal `"false"` disables). Quality-of-life improvement;
  follow-up.
- **Apply lexical stack to `experiences`.** R4 covers experience
  semantic + keyword. Adding keyword-first to experience-locale is a
  separate ticket; videos-only this round.
- **`apps/cms` ID collision cleanup.** `feat-109` is duplicated
  between content-discovery and platform tickets. Out of scope here;
  flag as a roadmap-hygiene follow-up.

## Context & Research

### Relevant Code and Patterns

**Admin (target — extend these):**

- `apps/admin/src/services/hybrid-search.service.ts` —
  `HybridSearchService` orchestrator. Add `mode` parameter; branch the
  video retrieval set on `mode === "keyword-first"`; insert the
  dilution-cap step between fusion and dedup.
- `apps/admin/src/services/hybrid-search-sql.ts` — extend with
  `WEIGHTED_TSV_INDEX_EXPR` / `WEIGHTED_TSV_QUERY_EXPR` constants for
  the new lexical stack. Existing four constants stay untouched.
- `apps/admin/src/services/hybrid-search-retrievers.ts` — UNTOUCHED
  on hybrid path. Continues to host the four R4 retrievers.
- `apps/admin/src/services/hybrid-search-fusion.ts` — RRF + dedup;
  unchanged. The dilution cap operates on its output, not on the
  fusion algorithm.
- `apps/admin/src/services/hybrid-search-health.ts` — unchanged.
- `apps/admin/src/app/api/search/route.ts` — REST handler. Extend
  with `mode` and `debug` query-param parsing; pass `debug:
isDebugAllowedForOrigin(...)` to the service.
- `apps/admin/src/graphql/queries/hybrid-search.ts` — Pothos resolver
  - types. Extend with `mode: String` arg, `debug: Boolean` arg, and
    `debug: SearchResultDebug` field on the result type.
- `apps/admin/src/graphql/types/` — add `hybrid-search-debug.ts` for
  `SearchResultDebug` + `SearchRetrieverRank` types.
- `apps/admin/src/auth/rate-limit.ts` — `rateLimitAuthRoute` already
  used by R4 search endpoints. No change.
- `apps/admin/prisma/migrations/0009_keyword_first_lexical/` — new
  migration directory.

**Admin precedent (the R4 plan that this extends):**

- `docs/plans/2026-04-23-002-feat-admin-r4-hybrid-search-plan.md` —
  full structural reference. R4 went through 8 units; this extension
  is 5 units because R4 is the foundation.
- `apps/admin/CLAUDE.md` "Hybrid search (R4 of admin migration
  playbook)" section — reference for the keyword-first extension's
  CLAUDE.md addition.

**cms source (the work to port — read for behavior, NOT to copy):**

- `apps/cms/src/api/search/services/lexical-sql.ts` — shared constants
  module. Translate to admin's `hybrid-search-sql.ts` extension.
- `apps/cms/src/api/search/services/keyword-weighted-search.ts`,
  `trigram-search.ts`, `exact-title-search.ts` — three retrievers.
  SQL shape ports; column names + join chain re-derive.
- `apps/cms/src/api/search/services/search.ts` — branched orchestrator
  - `applyDilutionCap`. Logic ports verbatim; SQL doesn't.
- `apps/cms/src/api/search/services/debug-allowlist.ts` — origin gate.
  Ports verbatim (no admin-specific divergence).
- `apps/cms/src/api/search/services/search.regression.test.ts`,
  `search.keyword-first.test.ts`, `search.dilution-cap.test.ts`,
  `search.bible-project.test.ts` — test patterns. Port the assertions
  - behaviors; admin's mock harness differs.

### Institutional Learnings

- `docs/solutions/workflow-issues/check-migration-playbook-before-extending-source-side-20260429.md`
  — the workflow miss this plan corrects. Documents why this work
  belongs on admin.
- `docs/solutions/best-practices/challenge-predecessor-plan-framing-and-read-named-memory-pointers-20260429.md`
  — the inherited-assumptions audit pattern. The "Inherited
  Assumptions to Challenge" section above is the discipline.
- `docs/solutions/best-practices/gin-byte-parity-trigram-vs-expression-indexes-20260429.md`
  — distinguishes byte-parity-guarded expression GIN from
  operator-class GIN. Explains why the trigram path needs no shared
  constant.
- `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md`
  — generated-column drift trap. Less relevant on admin (Prisma
  migrations don't use `IF NOT EXISTS`-keyed boot guards), but the
  rule "any change to a generated expression requires an explicit
  drop-and-recreate migration" still applies.
- `docs/solutions/security-issues/origin-header-soft-gate-not-security-boundary-20260429.md`
  — threat model for the debug origin gate.
- `docs/solutions/security-issues/log-injection-sanitizer-user-input-structured-logs-20260429.md`
  — sanitizer for the unknown-mode warn log.
- `docs/solutions/design-patterns/branched-orchestrator-opt-in-mode-pattern-20260429.md`
  — the branched-orchestrator design. Confirms the single-function-
  with-`if`-branch shape over twin functions or strategy-pattern
  abstraction.
- `docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md`
  — the test-first regression snapshot pattern. Adopted as the
  gating test for this PR.
- `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md`
  — re-derive every invariant from cms's port. Already explicit in
  this plan's "Inherited Assumptions" table.
- `docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md`
  — no hardcoded `en` fallback. Locale required at boundary; zero
  results on a locale with no corpus is a legitimate signal.
- `docs/solutions/platform/admin-hybrid-search-r4-pattern.md` — the
  R4 pattern doc. The new keyword-first solution doc is its sibling,
  not a replacement.

### External References

Skipped — Postgres `pg_trgm`, `websearch_to_tsquery`, weighted
tsvector, RRF, and Prisma `$queryRaw` are well-established and
documented in admin's R4 + R5 work. Local patterns are sufficient.

## Key Technical Decisions

- **Extend R4, do not fork.** Single `HybridSearchService` with one
  branch on `mode === "keyword-first"`. Per
  `docs/solutions/design-patterns/branched-orchestrator-opt-in-mode-pattern-20260429.md`.

- **Generated columns + GIN indexes attach to `VideoLocale`, not
  `Video`.** Admin's localized title/description live on
  `VideoLocale` rows. cms's single-row attachment translates to a
  per-locale attachment here.

- **Per-locale partial GIN indexes are NOT needed.** Unlike pgvector
  HNSW (which has the `pgvector-hnsw-index-bypass-with-where-filter`
  planner trap), GIN indexes support lossy WHERE filtering and do not
  need per-locale partials. Confirmed by R4's existing GIN posture
  (one global GIN index, locale filter via `vl.locale = ?`).

- **Migration `0009`, append-only.** Per admin's migration convention
  (collapsed `0001_init`; append from there). The migration runs
  idempotently in dev/preview and once in prod. No on-boot DDL.

- **`searchByKeywordWeighted` SQL filters by locale via `vl.locale =
?`.** Same as R4's `searchVideoKeyword`. The weighted tsvector
  expression is alias-prefixed for the query (`vl.title_tsv`,
  `vl.description_tsv`); the planner strips alias prefixes before
  comparing to the indexed expression, so byte-parity holds with
  the migration's bare-column index expression.

- **`searchByTrigram` uses `videos_locale.title %> ?` with the
  GIN trigram index on `VideoLocale.title gin_trgm_ops`.** Per
  `docs/solutions/best-practices/gin-byte-parity-trigram-vs-expression-indexes-20260429.md`,
  the trigram path uses operator-class indexing — no shared TS
  constant needed; alias differences are irrelevant to index
  selection.

- **`searchByExactTitle` ports the 16-token cap.** `MAX_EXACT_TITLE_TOKENS
= 16` from the cms-side fix. Tokenization (Unicode letter/digit
  split, lowercase, deduplicate) ports verbatim.

- **All keyword-first retrievers use `Prisma.raw(EXPR)` for the
  weighted tsvector fragment.** Per R4's established pattern in
  `searchVideoKeyword`. User input is bound via template-literal
  interpolation (`${trimmed}`); only the unbindable expression
  fragment uses `Prisma.raw`.

- **`searchByExactTitle`'s dynamic ILIKE chain uses positional
  binding.** N tokens → N `vl.title ILIKE ?` clauses joined with
  `AND`. Bindings array is `[locale, ...tokens.map(t => '%${t}%'),
limit]`. Postgres rejects unbound placeholder mismatches at parse
  time — the safe failure mode.

- **`mode` is a nullable String at both REST and GraphQL boundaries.**
  Future modes ship as new values without schema changes. Unknown
  values warn-and-fall-back via `normalizeMode(logger, raw)` — same
  shape as cms.

- **Log-injection sanitizer in `normalizeMode`.** `replace(/[\r\n\t]/g,
" ").slice(0, 64)` before interpolating into the warn line. Per
  `docs/solutions/security-issues/log-injection-sanitizer-user-input-structured-logs-20260429.md`.

- **Origin-gated `debug` payload via
  `isDebugAllowedForOrigin(origin)`.** Fail closed on `undefined` /
  empty origin. Default allowlist: any origin in non-production;
  explicit `SEARCH_DEBUG_ALLOWED_ORIGINS` CSV overrides. Per
  `docs/solutions/security-issues/origin-header-soft-gate-not-security-boundary-20260429.md`.

- **Dilution cap defaults: `top-N=3`, `downweight=0.5×`,
  `SEARCH_DILUTION_CAP_ENABLED` default true on keyword-first.**
  Same starting values as cms. Tunable post-launch.

- **GraphQL retriever-rank labels marked UNSTABLE in schema
  description.** `SearchRetrieverRank.label: String!` carries internal
  retriever names. Renaming a retriever later is a soft contract
  break for any consumer that depends on the literal strings; the
  schema description must explicitly say "UNSTABLE — implementation
  labels, do not branch on them in production code." Per the
  cms-side fix from PR #852.

- **Default-mode regression test is the gate.** Test-first sequencing
  per
  `docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md`.
  Lands as the FIRST commit; held green through every subsequent
  unit. Pairs JSON-equality with `not.toHaveBeenCalled()` behavioral
  assertions for each new retriever.

## Open Questions

### Resolved During Planning

- **Where does this work belong?** Admin, as an R4 extension. Per
  the migration playbook + the workflow-miss compound docs.
- **R-stage or extension?** R4 extension. The playbook says R4 covers
  "the full feat-010 + feat-086 + feat-097 contract" — keyword-first
  is net-new beyond that contract but doesn't warrant a new R-stage.
- **Migration sequence number?** `0009_keyword_first_lexical`
  (verified — `0007_admin_core_sync_coverage` and
  `0008_reference_locale_rows` already exist).
- **Generated-column attachment?** `VideoLocale` (per-locale title +
  description live there).
- **Per-locale partial GIN indexes?** No — GIN doesn't have HNSW's
  WHERE-filter bypass.
- **Trigger byte-parity guard for trigram?** No — operator-class GIN
  doesn't need it.
- **One file or sibling files for the three new retrievers?** Sibling
  module (`hybrid-search-keyword-first-retrievers.ts`) separate from
  R4's `hybrid-search-retrievers.ts`. Keeps the R4 file untouched on
  the hybrid path; mirrors the cms-side per-retriever-file shape.
- **Embedding provider?** Reuse R4's `generateExperienceEmbedding`
  (the historical-name embedder). No change.
- **Search REST contract.** Same shape as R4 — extend with `mode` and
  `debug` query params. 400/429/503 semantics unchanged.

### Deferred to Implementation

- **Final `top-N` window for the dilution-cap trigger.** Plan-default
  3; tune against canary set once R0 backfills admin data.
- **Final dilution-cap downweight constant.** Plan-default 0.5×;
  tune against the same canary set.
- **Whether `Video.deleted_at IS NULL` belongs in every keyword-first
  retriever's WHERE.** R4 retrievers carry it. The keyword-first
  retrievers should mirror — confirm against current `hybrid-search-retrievers.ts`
  shape during implementation.
- **Logger sanitization point.** Admin's logger surface (Pino via
  Yoga? Strapi-style? `console.log` wrapper?) — confirm at
  implementation; apply the strip+truncate sanitizer at the
  `strapi.log.warn`-equivalent call site.
- **GraphQL `SearchResultDebug` type registration.** Add a side-effect
  import in `src/graphql/schema.ts` per admin's "adding a new Pothos
  type requires three steps" rule. Confirm the existing search
  query's type-file imports the new type before `builder.toSchema()`.
- **Whether to register `searchByExactTitle` as a fifth RRF input or
  as a tied 4-list (matching cms).** cms has 4 lists in keyword-first
  (semantic + 3 lexical retrievers). Plan-default: same.
- **Ports of the six cms-side solution docs.** Implementation-time
  decision: append admin paths to the existing docs vs. write a new
  R4-extension-pattern doc + cross-link. Plan-default: a new
  R4-extension pattern doc, with cross-links from the six.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance
> for review, not implementation specification. The implementing
> agent should treat it as context, not code to reproduce._

The orchestrator branches on `mode` once, around the **video** retrieval
block. Embedding, experience retrievals, fusion, dedup, and pagination
are shared.

```
HybridSearchService.search({ query, locale, mode?, debug?, contentTypes?, limit?, offset? })
  │
  ├── normalize mode:  unset|"hybrid" → hybrid
  │                    "keyword-first" → keyword-first
  │                    else → log structured warn (with sanitizer), fallback to hybrid
  │
  ├── embed(query)  // unchanged from R4; failure → keyword-only degradation
  │
  ├── build retrievals[]:
  │     if wantsVideos and mode == hybrid:                ← UNCHANGED FROM R4
  │       L_v_sem  = searchVideoSemantic(...)
  │       L_v_kw   = searchVideoKeyword(...)
  │     if wantsVideos and mode == keyword-first:         ← NEW
  │       L_v_sem  = searchVideoSemantic(...)             // shared with hybrid
  │       L_v_kwW  = searchByKeywordWeighted(...)         // weighted tsv on VideoLocale
  │       L_v_trg  = searchByTrigram(...)                 // VideoLocale.title %> q
  │       L_v_exct = searchByExactTitle(...)              // every token in title
  │     if wantsExperiences:                              ← UNCHANGED in either mode
  │       L_e_sem  = searchExperienceSemantic(...)
  │       L_e_kw   = searchExperienceKeyword(...)
  │
  ├── allSettled, drop empty lists, fuseRankedLists(k=60)
  │
  ├── if mode == keyword-first and SEARCH_DILUTION_CAP_ENABLED
  │      and exact-title list has at least one full-token-match hit:
  │        topN_kw_core_ids = ∪ core_ids of top-N from L_v_kwW, L_v_trg, L_v_exct
  │        for each fused result that contributed only via L_v_sem
  │            and result.videoCoreId ∉ topN_kw_core_ids:
  │              result.score *= 0.5
  │        re-sort
  │
  ├── deduplicateResults(...)  // unchanged 3-layer
  ├── paginate(limit, offset)
  ├── if debug allowed → attach { retrieverRanks, fusedScore, dilutionCapApplied } per result
  └── return { results, hasMore, query, searchMode }
                                          ↑
                            unchanged degradation signal
                            ("hybrid"/"keyword-only")
```

The hybrid branch reads no new columns and gains no new dependencies.
The two paths share `embed()`, `fuseRankedLists()`, `deduplicateResults()`,
and the pagination tail.

### Schema delta (Prisma migration `0009_keyword_first_lexical`)

```sql
-- pseudocode; final SQL lives in
-- apps/admin/prisma/migrations/0009_keyword_first_lexical/migration.sql

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE video_locale
  ADD COLUMN title_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, ''))) STORED;

ALTER TABLE video_locale
  ADD COLUMN description_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(description, ''))) STORED;

CREATE INDEX video_locale_lexical_weighted_idx
  ON video_locale USING gin (
    (setweight(title_tsv, 'A') || setweight(description_tsv, 'B'))
  );

CREATE INDEX video_locale_title_trgm_idx
  ON video_locale USING gin (title gin_trgm_ops);
```

The expression in the weighted GIN index must appear byte-equal in
`hybrid-search-sql.ts` (extending the R4 byte-parity test pattern).

## Implementation Units

> **Sequencing.** Five units, each its own commit. Unit 2 is the
> regression test (test-first); Units 3–5 must keep it green.

### Unit 1: Migration `0009` + lexical SQL constants

**Goal:** Provision the DB infrastructure both modes can sit on. Append
the byte-parity-guarded weighted-tsvector constants to admin's existing
shared SQL module.

**Requirements:** R3, R4, R7

**Dependencies:** None (R4 + R5 already shipped; their constants stay
untouched).

**Files:**

- Create: `apps/admin/prisma/migrations/0009_keyword_first_lexical/migration.sql`
- Modify: `apps/admin/src/services/hybrid-search-sql.ts` — add four new
  constants (`TITLE_TSV_GENERATED_EXPR`, `DESCRIPTION_TSV_GENERATED_EXPR`,
  `WEIGHTED_TSV_INDEX_EXPR`, `WEIGHTED_TSV_QUERY_EXPR`) plus index-name
  constants (`VIDEO_LOCALE_LEXICAL_WEIGHTED_INDEX_NAME`,
  `VIDEO_LOCALE_TITLE_TRGM_INDEX_NAME`).
- Test: `apps/admin/src/services/hybrid-search-sql.test.ts` — extend
  the existing R4 byte-equality test to also assert the new
  `WEIGHTED_TSV_INDEX_EXPR` appears byte-equal in the migration SQL,
  and that the legacy `VIDEO_LOCALE_TSVECTOR_INDEX_EXPR` is untouched.

**Approach:**

- Migration provisions: `pg_trgm` extension (idempotent), two STORED
  generated columns on `video_locale` (`title_tsv`, `description_tsv`),
  weighted GIN index over `(setweight(title_tsv,'A') ||
setweight(description_tsv,'B'))`, GIN trigram index on `videos_locale.title`
  with `gin_trgm_ops`.
- The legacy `video_locale_fulltext_search_idx` from `0006` is left
  untouched — hybrid mode keeps reading it via `searchVideoKeyword`.
- The `*_QUERY_EXPR` constants alias-prefix columns (`vl.title_tsv`,
  `vl.description_tsv`) for use inside `$queryRaw` template literals
  where `video_locale` is joined as `vl`. Postgres planner strips
  alias prefixes before matching the indexed expression — same
  property R4 already relies on.
- No shared constant for the trigram operator (`%>`); per
  `docs/solutions/best-practices/gin-byte-parity-trigram-vs-expression-indexes-20260429.md`,
  operator-class GIN doesn't need byte-parity guards. The retriever
  inlines `vl.title %> ?` directly.

**Patterns to follow:**

- `apps/admin/prisma/migrations/0006_hybrid_search_gin/migration.sql`
  — R4's GIN migration; same shape (raw SQL, no-DSL).
- `apps/admin/src/services/hybrid-search-sql.ts` — R4's existing
  byte-parity constants and the test that locks them in.

**Test scenarios:**

- `hybrid-search-sql.test.ts` reads the migration file and asserts
  the new `WEIGHTED_TSV_INDEX_EXPR` substring is present byte-equal.
- Legacy `VIDEO_LOCALE_TSVECTOR_INDEX_EXPR` is still asserted (no
  regression on R4's invariant).
- Schema-level assertion: the migration SQL contains
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`, two `ADD COLUMN`
  statements with `GENERATED ALWAYS AS` + `STORED`, two `CREATE
INDEX` statements for the new GIN indexes.

**Verification:**

- `pnpm --filter @forge/admin prisma migrate diff` reports no drift
  between the migration and the schema after running the migration
  against a dev DB.
- `EXPLAIN ANALYZE` on a probe query against `video_locale` using
  `WEIGHTED_TSV_QUERY_EXPR @@ websearch_to_tsquery('simple', ?)`
  shows `Bitmap Index Scan on video_locale_lexical_weighted_idx`.
- `EXPLAIN ANALYZE` on `videos_locale.title %> ?` shows `Bitmap
Index Scan on video_locale_title_trgm_idx`.
- Running R4's existing search against the migrated DB returns the
  same response as before — the new columns and indexes are dormant
  on the hybrid path.

---

### Unit 2: `mode` argument plumbing + default-mode regression test (test-first)

**Goal:** Plumb the `mode` argument from REST + GraphQL through
`HybridSearchService.search()`, with hybrid as the default. Lock in
byte-identical default behavior with a snapshot test that runs from
this point through every subsequent unit.

**Requirements:** R1, R2, R6

**Dependencies:** Unit 1 (so the migration is buildable end-to-end).

**Files:**

- Create: `apps/admin/src/services/hybrid-search.regression.test.ts` —
  the snapshot test. Lands FIRST as the gate.
- Modify: `apps/admin/src/services/hybrid-search.service.ts` — extend
  `SearchParams` with `mode?: string | null`. Add `normalizeMode()`
  helper with log-injection sanitizer. In this unit, `mode` is
  computed but doesn't change retrieval — only the warn-fallback for
  unknown values is wired.
- Modify: `apps/admin/src/app/api/search/route.ts` — accept and
  validate `mode` query param. Empty string treated as omitted.
- Modify: `apps/admin/src/graphql/queries/hybrid-search.ts` — add
  `mode: String` arg with description disambiguating from
  `searchMode` response field.
- Test: `apps/admin/src/app/api/search/route.test.ts` — extend with
  `mode` parsing cases.
- Test: `apps/admin/src/graphql/queries/hybrid-search.test.ts` —
  extend with GraphQL `mode` arg cases.

**Execution note:** Test-first. The regression snapshot test is the
**first commit** of this unit and is captured by running it once
against `origin/main` before any other change. Subsequent commits
must keep that snapshot green.

**Approach:**

- Default `"hybrid"` when `mode` is unset, null, or `""`.
- Unknown values: log structured warning (`[search]
event=search_unknown_mode mode=<sanitized> falling_back=hybrid`)
  exactly once per call. Sanitizer: `String(raw).replace(/[\r\n\t]/g,
" ").slice(0, 64)`. Never throw.
- Regression test asserts `JSON.stringify(response)` byte-identity for
  `mode ∈ {undefined, null, "", "hybrid", "garbage"}` against a fixed
  retriever fixture. Behavioral assertion: keyword-first retrievers
  (mocked from Unit 3 onward) NEVER called on the default path.
- GraphQL schema description on `mode`: explicitly disambiguate from
  `searchMode` response field (orthogonal — input selects pipeline,
  output reflects what ran).

**Patterns to follow:**

- `apps/cms/src/api/search/services/search.regression.test.ts` — the
  cms test pattern. Port to admin's mock harness.
- R4's existing `mode`-less request path. The test snapshot is
  effectively R4's response for the fixed query set.
- `apps/admin/src/app/api/search/route.ts` — existing query-param
  parsing pattern (`type` arg).

**Test scenarios:**

- `mode` unset → byte-identical response to R4 for the regression
  query set (5 representative queries + their `mode ∈ {null, "",
hybrid, garbage}` siblings).
- `mode="garbage"` → byte-identical response + exactly one warn log
  with the sanitized structured shape.
- `mode="garbage\r\nevent=injected"` → log contains `mode=garbage
event=injected` (newlines stripped to spaces, no synthetic event
  injection).
- REST `?mode=keyword-first` parses and forwards (returns hybrid
  behavior in this unit; keyword-first wiring lands in Unit 3).
- GraphQL `mode: null` and missing `mode` arg both default to hybrid.
- `searchMode` response field still reports `"hybrid"|"keyword-only"`
  based solely on embedding success/failure (orthogonal to input
  `mode`) — pinned by an explicit cross-check.

**Verification:**

- Regression test passes on this branch.
- Regression test would also pass on `origin/main` if the test file
  alone were copied in — the snapshot is the pre-change baseline.

---

### Unit 3: Three keyword-first retrievers + branched orchestrator

**Goal:** Implement the new lexical retrievers and wire the keyword-first
video-retrieval branch into `HybridSearchService`. Hybrid path remains
untouched.

**Requirements:** R3, R4, R7

**Dependencies:** Unit 1 (DB infra), Unit 2 (`mode` plumbing + regression
test).

**Files:**

- Create:
  `apps/admin/src/services/hybrid-search-keyword-first-retrievers.ts` —
  exports `searchByKeywordWeighted`, `searchByTrigram`,
  `searchByExactTitle` plus shared types (`KeywordWeightedSearchParams`,
  `TrigramSearchParams`, `ExactTitleSearchParams`, the `MAX_EXACT_TITLE_TOKENS`
  constant, `tokenizeForExactTitle` helper).
- Create:
  `apps/admin/src/services/hybrid-search-keyword-first-retrievers.test.ts`.
- Modify: `apps/admin/src/services/hybrid-search.service.ts` — in the
  `wantsVideos && mode === "keyword-first"` branch, push 3 new
  retrievals (semantic stays from the hybrid branch). Empty-list
  filtering before fusion is preserved.
- Test: `apps/admin/src/services/hybrid-search.keyword-first.test.ts` —
  orchestrator-level test for the new branch.

**Approach:**

- All three new retrievers honor the same locale + status filtering as
  R4's `searchVideoKeyword` (DISTINCT ON `v.id`, JOIN to `Video` with
  `deleted_at IS NULL`, WHERE `vl.locale = ? AND vl.status = 'PUBLISHED'`).
- All three honor the orchestrator's `OVERFETCH_FACTOR=3` via the
  `limit` param.
- `searchByKeywordWeighted`:
  - WHERE: `${WEIGHTED_TSV_QUERY_EXPR} @@ websearch_to_tsquery('simple', ${trimmed})`.
  - rank: `ts_rank_cd(${WEIGHTED_TSV_QUERY_EXPR}, websearch_to_tsquery('simple', ${trimmed}))`.
  - `Prisma.raw(WEIGHTED_TSV_QUERY_EXPR)` per R4 pattern.
  - Empty/whitespace input → `[]` short-circuit.
- `searchByTrigram`:
  - WHERE: `vl.title %> ${trimmed}`.
  - rank: `similarity(vl.title, ${trimmed})` DESC.
  - Empty input → `[]`.
- `searchByExactTitle`:
  - Tokenize via `tokenizeForExactTitle(query)` — Unicode letter/digit
    split, lowercase, dedup. **Cap at `MAX_EXACT_TITLE_TOKENS = 16`**
    (DoS guard from cms-side fix).
  - WHERE: dynamic AND-chain of `vl.title ILIKE ?` (one per token);
    `vl.locale = ?`; `vl.status = 'PUBLISHED'`; `v.deleted_at IS NULL`.
  - rank: `LENGTH(vl.title) ASC` (tighter match wins).
  - Bindings array: `[locale, ...tokens.map(t => '%${t}%'), limit]`.
  - 0 tokens → `[]`.
- All three return `RankedItem`-shaped rows directly (no `annotateVideo`
  step — matches R4 retriever convention).
- In the orchestrator's keyword-first branch, push retrievals with
  labels `keyword-weighted-video`, `trigram-video`, `exact-title-video`.
  Existing `Promise.allSettled` + `unwrapOutcome` envelope handles
  per-retriever failures.

**Patterns to follow:**

- `apps/admin/src/services/hybrid-search-retrievers.ts:searchVideoKeyword`
  — locale + status + deleted_at join chain; `Prisma.raw(EXPR)` for
  the tsvector fragment; empty-input short-circuit.
- `apps/cms/src/api/search/services/keyword-weighted-search.ts`,
  `trigram-search.ts`, `exact-title-search.ts` — SQL behavior reference
  (translate columns + locale).
- `apps/admin/src/db/pgvector.ts` — `Prisma.raw` patterns.

**Test scenarios:**

- Per-retriever: each returns expected ordered IDs against a seeded
  fixture for `q="the Bible project"` (orchestrator-level mocking
  matches cms-side test pattern; real-DB test is a deferred follow-up).
- Trigram: `q="bibel project"` (typo) returns Bible Project videos.
- Exact-title: `q="bible"` returns every title containing "bible";
  `q="the bible project"` returns only titles with all three tokens.
- Exact-title: 1000-character pasted query → 16-token cap holds; SQL
  has exactly 16 ILIKE clauses; bindings array length = 18 (1 locale
  - 16 patterns + 1 limit).
- Locale: a Bible Project VideoLocale published only in `es` does not
  appear for `locale="en"`.
- Empty / whitespace-only `q` → all three return `[]` without DB call.
- Orchestrator: in keyword-first mode, fused list draws from 4 ranked-list
  contributions; `searchMode` response field still reflects embedding
  success/failure only.
- Hybrid path: regression snapshot from Unit 2 still passes
  byte-identically; `searchByKeywordWeighted/Trigram/ExactTitle` NOT
  called; `searchVideoKeyword` (R4 legacy) IS called.

**Verification:**

- `EXPLAIN ANALYZE` on each new retriever's SQL shows `Bitmap Index
Scan` on the appropriate index (deferred to real-DB integration).
- All three new retriever modules export the same `(prisma, params) =>
Promise<RankedItem[]>` signature shape.
- Regression snapshot from Unit 2 holds.

---

### Unit 4: Semantic-dilution cap + origin-gated `debug` field

**Goal:** Add the post-fusion semantic-dilution cap (flag-gated) and
expose per-retriever scores via `debug`, origin-gated.

**Requirements:** R5, R6

**Dependencies:** Unit 3.

**Files:**

- Modify: `apps/admin/src/services/hybrid-search.service.ts` — insert
  cap step between `fuseRankedLists` and `deduplicateResults` in the
  keyword-first branch only. Build per-key origin map from labeled
  lists. Thread `debug` through to response mapping.
- Modify: `apps/admin/src/services/hybrid-search-fusion.ts` (if
  needed) — retain per-result list-of-origin trace if not already
  available. Keep changes additive.
- Create: `apps/admin/src/services/hybrid-search-debug-allowlist.ts` —
  port of cms `debug-allowlist.ts`.
- Create: `apps/admin/src/services/hybrid-search-debug-allowlist.test.ts`.
- Modify: `apps/admin/src/graphql/types/hybrid-search.ts` — add
  `SearchResultDebug` + `SearchRetrieverRank` types. Mark labels
  UNSTABLE in description. Side-effect import in
  `apps/admin/src/graphql/schema.ts`.
- Modify: `apps/admin/src/graphql/queries/hybrid-search.ts` — add
  `debug: Boolean` arg; gate via `isDebugAllowedForOrigin` from the
  Yoga context; thread `debug` boolean to service.
- Modify: `apps/admin/src/app/api/search/route.ts` — parse `debug=true`
  query param; gate via `isDebugAllowedForOrigin(headers.origin)`;
  thread to service.
- Modify: `apps/admin/src/graphql/schema.test.ts` — assert no
  `embedding|vector|similarit` field leaks on the new types.
- Create: `apps/admin/src/services/hybrid-search.dilution-cap.test.ts`
  — covers cap on/off and trigger condition.
- Create: `apps/admin/src/services/hybrid-search.debug.test.ts` —
  covers origin-gated debug field.

**Approach:**

- **Cap activation:**
  - Compute `topN_kw_core_ids` = union of `videoCoreId`s from the top-N
    (default 3) results of `keyword-weighted-video`, `trigram-video`,
    and `exact-title-video` lists.
  - Cap _triggers_ iff `exact-title-video` returned at least one
    result whose `videoTitle`, lowercased and whitespace-collapsed,
    contains every query token.
  - When triggered: any fused result whose only contributing list was
    `semantic-video` AND whose `videoCoreId` is null or not in
    `topN_kw_core_ids` gets `score *= 0.5`. Re-sort.
- `SEARCH_DILUTION_CAP_ENABLED` defaults `true` in keyword-first;
  unreached on hybrid. Read once per request at orchestrator entry.
- **`debug` gating:** reuse admin's CORS allowlist source where
  feasible. Default behavior: any origin in non-production; explicit
  `SEARCH_DEBUG_ALLOWED_ORIGINS` CSV overrides. **Fail closed when
  `Origin` is `undefined`** (yoga-cors learning). Origin extraction:
  REST via `request.headers.get("origin")`; GraphQL via
  `koaContext.request?.headers?.origin` (or Yoga's request-context
  equivalent — confirm during implementation).
- `debug` payload shape per result: `{ retrieverRanks: Array<{ label,
rank }>, fusedScore, dilutionCapApplied }`. In hybrid mode, `debug`
  arg can still be passed; the `dilutionCapApplied` flag is always
  `false` (cap unreached).

**Patterns to follow:**

- `apps/cms/src/api/search/services/search.ts:applyDilutionCap` — the
  cap algorithm. Ports verbatim modulo `cuid` ids vs cms's int ids.
- `apps/cms/src/api/search/services/debug-allowlist.ts` — origin gate.
  Ports verbatim.
- `apps/admin/src/graphql/types/experience.ts` — Pothos type
  registration pattern; `@classification public-shape` JSDoc.
- `apps/admin/src/graphql/schema.test.ts` —
  `/embed|vector|similarit/i` guard pattern.

**Test scenarios:**

- Cap enabled + exact-title hit exists: a seeded semantic-only video
  with `videoCoreId` outside the keyword top-N has `score *= 0.5`;
  one whose `videoCoreId` is inside the top-N is not down-weighted;
  one with `videoCoreId === null` is treated as outside (down-weighted).
- Cap enabled + no exact-title hit (e.g., `q="hope when life is
hard"`): no down-weights; result order matches no-cap output ±1.
- `SEARCH_DILUTION_CAP_ENABLED=false`: no down-weights regardless.
- `SEARCH_DILUTION_CAP_ENABLED="0"` (typo'd off-value): cap stays ON
  per cms-side decision; this is documented quirk, not bug.
- `debug=true` from allowed origin: payload present; `dilutionCapApplied`
  is `true` for the correct result(s).
- `debug=true` from disallowed origin: payload stripped.
- `debug=true` from request with `Origin: undefined`: payload stripped
  (fail closed).
- GraphQL: `SearchResultDebug` field absent (not null) in response when
  `debug` arg unset — pin via schema-level test.
- Default-mode regression snapshot still passes.

**Verification:**

- All cap test scenarios pass.
- `debug` payload presence is governed strictly by `(debug=true) AND
(origin in allowlist)`.
- `schema.test.ts` `/embed|vector|similarit/i` guard still passes
  (the new `SearchResultDebug` type has only `retrieverRanks`,
  `fusedScore`, `dilutionCapApplied` — no `embedding|vector|similarity`).

---

### Unit 5: Bible Project headline acceptance test + CLAUDE.md update + solutions doc

**Goal:** Lock in the user-facing acceptance criterion for keyword-first
mode on admin. Document the R4 extension pattern in admin's CLAUDE.md
and as a sibling of the R4 pattern doc in `docs/solutions/`.

**Requirements:** R1–R6

**Dependencies:** Unit 4.

**Files:**

- Create: `apps/admin/src/services/hybrid-search.bible-project.test.ts`
  — orchestrator-level acceptance test with mocked retrievers.
- Modify: `apps/admin/CLAUDE.md` — append a "## Hybrid search keyword-first
  mode (R4 extension)" section after the R4 section. Cross-link to
  the R4 section so future readers see the lineage.
- Create:
  `docs/solutions/platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md`
  — sibling to
  `docs/solutions/platform/admin-hybrid-search-r4-pattern.md`.
- Modify: each of the six cms-side feat-109 solution docs at
  `docs/solutions/{database-issues,best-practices,security-issues,design-patterns,workflow-issues}/`
  to cross-link the new admin paths.

**Approach:**

- Acceptance test:
  - Seed fixtures (orchestrator-level mocks): 5 Bible Project
    `VideoLocale` rows in `en` + 3 unrelated "project" videos + 3
    bible-description-only videos. Same fixture set as cms.
  - Test calls `HybridSearchService.search()` with `q="the Bible
project"`, `locale="en"`, `limit=10`, `mode="keyword-first"`,
    `contentTypes=["video"]`.
  - Assertions: at least 8 of 10 result titles match
    `/bible\s*project/i`; no result whose title lacks both "bible"
    AND "project" ranks above any result whose title contains both;
    top 3 are all Bible Project videos.
  - Same query with `mode` unset must still return the legacy
    R4 diluted set (covered by Unit 2's regression snapshot — assert
    here too as a cross-check).
  - Real-DB integration version is documented as a follow-up gated on
    R0 backfilling admin video data.
- CLAUDE.md section follows the R1/R2/R3/R4/R5 shape: Schema,
  Services, Orchestrator, Endpoints, Operational runbook. Cite
  `hybrid-search-keyword-first-retrievers.ts`, the migration, the
  service modifications, the GraphQL types/queries, and the new
  debug-allowlist module by exact file path.
- Solution doc captures the R4-extension-specific bits: branched
  orchestrator on R4's `HybridSearchService`, dilution cap with
  origin-tracking via labeled lists, debug allowlist as a soft gate
  (not auth — link to the security-issues doc), Prisma migration
  vs cms's bootstrap-on-boot.

**Patterns to follow:**

- `apps/admin/CLAUDE.md` "Hybrid search (R4 of admin migration
  playbook)" section — structure reference for the new section.
- `docs/solutions/platform/admin-hybrid-search-r4-pattern.md` —
  structure reference for the new solutions doc.
- `apps/cms/src/api/search/services/search.bible-project.test.ts` —
  acceptance test pattern.

**Test scenarios:**

- Headline assertion (above) passes.
- Headline assertion fails on R4 main (no keyword-first mode exists)
  — verified by hand at PR-open time.
- Same query with `mode` unset returns R4's hybrid result set.
- `searchMode` response field reports `"hybrid"` when embedding
  succeeded (pinned cross-check).

**Verification:**

- Acceptance test passes on this branch.
- Regression snapshot from Unit 2 passes byte-identically.
- CLAUDE.md renders without broken links; new section appears after
  R4 section, before "Common pitfalls".
- Solution doc filename matches the `admin-*-pattern.md` convention.

## System-Wide Impact

- **Interaction graph:** `mode` and `debug` are strict additive args.
  No callbacks, middleware, or observers change shape. R4 consumers
  that don't pass `mode` see no change. Existing `searchMode` response
  field (degradation signal) preserved verbatim.
- **Error propagation:** Unknown `mode` warns and falls back, never
  errors. Cap and debug failures (if any) are isolated to the
  keyword-first branch and the response-decoration tail; cannot affect
  hybrid responses. New retrievers wrapped by R4's existing
  `Promise.allSettled` / `unwrapOutcome` — single retriever failure
  returns `[]` for that list.
- **State lifecycle risks:** None. New generated columns derive from
  existing canonical fields (`VideoLocale.title`, `VideoLocale.description`).
  `pg_trgm` is idempotent and shared with no other code path. No write
  paths change.
- **API surface parity:** `mode` and `debug` land on both REST
  (`GET /api/search`) and GraphQL (`Query.search`). Both surfaces stay
  in lock-step through `HybridSearchService`.
- **Integration coverage:** Unit 2's regression snapshot is the gate —
  any unit-level pass that breaks it is a bug, not a feature. Unit 5's
  acceptance test exercises the full orchestrator under the new mode.
  Real-DB integration is the explicit follow-up gated on R0.
- **Affected stakeholders:**
  - **Consumers (apps/web, apps/mobile, apps/tv):** No change. Still
    on cms's search until R8.
  - **Operators:** Two new GIN indexes + one new extension + two new
    generated columns on `VideoLocale`. Index sizes documented in
    PR description.
  - **Future R4 work:** R4 + R5 carry on unchanged. The
    keyword-first extension is opt-in.

## Risks & Dependencies

- **GIN byte-parity drift on the weighted expression.** A future edit
  to `WEIGHTED_TSV_INDEX_EXPR` without a coordinated migration update
  silently reverts queries to Seq Scan. Mitigated by Unit 1's
  byte-equality test, mirroring R4's existing pattern.
- **Generated-column expression drift.** Per
  `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md`,
  any change to `TITLE_TSV_GENERATED_EXPR` or `DESCRIPTION_TSV_GENERATED_EXPR`
  requires a coordinated `DROP COLUMN ... CASCADE + ADD COLUMN`
  migration step. Less acute on admin (Prisma migrations don't auto-skip
  via `IF NOT EXISTS`), but the rule still applies. Document inline
  in `hybrid-search-sql.ts`.
- **Snapshot test brittleness.** If R4's response shape changes between
  snapshot capture and PR merge (R5 wouldn't but a future R-stage
  might), the regression test will spuriously fail. Mitigated by
  capturing the snapshot on the branch tip and only against
  deterministic mocked retrievers.
- **`pg_trgm` extension privilege.** Admin's prod DB role may need
  explicit `CREATE EXTENSION` grant. Migration `0006` (R4 GIN) didn't
  need pg_trgm; this is the first one that does. Confirm at
  preview-environment deploy time.
- **Origin gating false positives.** Admin's CORS may differ from cms;
  preview environments may not set `Origin` correctly for legitimate
  agent clients. Documented in
  `docs/solutions/security-issues/origin-header-soft-gate-not-security-boundary-20260429.md`
  — fail-closed is intentional.
- **R0 dependency for prod usefulness.** Admin's `video` /
  `video_locale` tables are 0 rows in prod. The keyword-first port
  ships code that's correct against the schema; meaningful prod data
  awaits R0. Real-DB integration tests are explicitly deferred to R0
  readiness.
- **Index growth.** Two new GIN indexes on `video_locale`. At admin's
  current zero-row prod data the cost is nil; once R0 backfills, the
  indexes grow proportionally to the corpus. Report
  `pg_size_pretty(pg_total_relation_size())` for both new indexes in
  PR description after preview-environment deploy.
- **Naming collision (`mode` input vs `searchMode` output).** Same
  trap as cms-side. GraphQL schema description on `mode` explicitly
  disambiguates; regression test asserts `searchMode` semantics are
  unchanged in either input mode.

## Documentation / Operational Notes

- After Unit 2 lands, `apps/admin/CLAUDE.md`'s R4 section gains a
  cross-reference to the new keyword-first section. After Unit 5
  lands, the new section follows R4's section directly.
- After Unit 5, the six cms-side solution docs from feat-109 get
  admin-side cross-references. The new R4-extension pattern doc is
  a sibling of `admin-hybrid-search-r4-pattern.md`.
- PR description records:
  - Final `SEARCH_DILUTION_CAP_ENABLED` default and downweight
    constant.
  - Final top-N window for the cap trigger.
  - `pg_size_pretty(pg_total_relation_size())` output for both new
    GIN indexes (preview environment, since prod data is empty).
  - `EXPLAIN ANALYZE` output showing `Bitmap Index Scan` on the new
    indexes for representative queries (preview environment).
  - Whether `mode="garbage"` warn-log shape was confirmed sanitized.
  - 24h passive canary diff (admin keyword-first vs cms keyword-first
    once cms keyword-first is consumer-reachable in some surface) —
    deferred until consumer surface lands; not blocking R4-extension
    merge.
- Roadmap: open a new ticket
  `docs/roadmap/content-discovery/feat-NNN-search-keyword-first-mode-admin-port.md`
  pointing to this plan; flip `feat-109-search-keyword-first-mode.md`
  status note to mention the admin port is in flight.

### Out-of-scope follow-ups (PR description should list these)

- **Real-DB integration tests** gated on R0: EXPLAIN-based GIN
  verification + Bible Project headline against seeded admin video
  data + canary diff vs cms keyword-first.
- **`statement_timeout` for SQL retrievers** (pre-existing R4 concern;
  cross-cutting).
- **Extract shared retriever join-chain helper** (R4's keyword
  retriever + the three new retrievers all share locale + status +
  deleted_at filtering).
- **Split `hybrid-search.service.ts`** into orchestrator +
  dilution-cap + debug-trace modules if it grows further.
- **Tolerant parser for `SEARCH_DILUTION_CAP_ENABLED`** (currently
  only literal `"false"` disables).
- **Token-based debug auth** (current Origin gate is a soft feature
  flag, not auth).
- **Apply lexical stack to experiences** (videos-only this round).
- **Roadmap `feat-109` ID collision cleanup** (content-discovery vs
  platform tickets share the ID).
- **R8 cutover deletes cms keyword-first** (separate ticket alongside
  the rest of cms search deprecation).

## Sources & References

- **Origin (playbook):**
  `docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md`
- **Predecessor plans:**
  - `docs/plans/2026-04-23-002-feat-admin-r4-hybrid-search-plan.md`
  - `docs/plans/2026-04-29-001-feat-search-keyword-first-mode-plan.md`
- **The miss this plan corrects:**
  - `docs/solutions/workflow-issues/check-migration-playbook-before-extending-source-side-20260429.md`
  - `docs/solutions/best-practices/challenge-predecessor-plan-framing-and-read-named-memory-pointers-20260429.md`
- **Related PRs:**
  - `JesusFilm/forge#852` (cms-side keyword-first; the work being
    ported)
  - `JesusFilm/forge#837` (admin R4 hybrid search; the foundation
    being extended)
  - `JesusFilm/forge#838` (admin R5 scene recommendations; pattern
    sibling)
- **Admin code (target):**
  - `apps/admin/src/services/hybrid-search.service.ts`
  - `apps/admin/src/services/hybrid-search-retrievers.ts`
  - `apps/admin/src/services/hybrid-search-sql.ts`
  - `apps/admin/src/services/hybrid-search-fusion.ts`
  - `apps/admin/src/services/hybrid-search-health.ts`
  - `apps/admin/src/app/api/search/route.ts`
  - `apps/admin/src/graphql/queries/hybrid-search.ts`
- **cms source (port from):**
  - `apps/cms/src/api/search/services/{lexical-sql,keyword-weighted-search,trigram-search,exact-title-search,debug-allowlist,search}.ts`
  - `apps/cms/src/bootstrap/ensure-search-lexical.ts` (translate to
    Prisma migration)
- **Institutional learnings cited:**
  - `docs/solutions/best-practices/gin-byte-parity-trigram-vs-expression-indexes-20260429.md`
  - `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md`
  - `docs/solutions/security-issues/origin-header-soft-gate-not-security-boundary-20260429.md`
  - `docs/solutions/security-issues/log-injection-sanitizer-user-input-structured-logs-20260429.md`
  - `docs/solutions/design-patterns/branched-orchestrator-opt-in-mode-pattern-20260429.md`
  - `docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md`
  - `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md`
  - `docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md`
  - `docs/solutions/platform/admin-hybrid-search-r4-pattern.md`
- **Origin research (still relevant):**
  `docs/research/semantic-search-report.md` §4 / §6 / §7
