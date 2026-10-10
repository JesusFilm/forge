---
title: "feat: Relevance-matched real-page exemplars for AI experience generation"
type: feat
status: active
date: 2026-06-15
origin: docs/brainstorms/2026-06-15-ai-experience-exemplar-generation-requirements.md
---

# feat: Relevance-matched real-page exemplars for AI experience generation

## Summary

Feed the AI experience drafter a **relevance-matched real published experience**
as a structure-and-voice reference, selected per prompt via pgvector cosine
similarity over `ExperienceLocale.embedding`, with the Easter experience as a
fallback. The exemplar is reduced to block structure + copy (video IDs stripped)
and injected into the Mastra draft workflow's shared prompt builders, so both
the full (`multi-step-draft`) and quick (`quick-draft`) modes produce richer,
more layered pages without cloning the reference's videos.

---

## Problem Frame

Today's AI draft generation produces thin, skeletal pages. The origin doc framed
this as "replace the frozen synthetic few-shot example." **Planning research
corrected that premise:** the live draft path (`multiStepDraftWorkflow` /
`quickDraftWorkflow` → draft/plan Mastra agents) carries **no few-shot example at
all** — only rule text and one-line shape snippets. The `FEW_SHOT_EXAMPLE` /
`buildSystemPrompt` block in `src/services/experience-ai/experience-ai-prompts.ts`
is dead code (no runtime caller). So the work is to **add** a real-page exemplar
to the live prompt, and separately remove the dead synthetic example.

See origin for full product rationale and the live Easter structure that
motivates the feature (`docs/brainstorms/2026-06-15-ai-experience-exemplar-generation-requirements.md`).

---

## Requirements

- R1. Select exemplar(s) from **published** experiences by **relevance** to the
  prompt via embedding similarity over `ExperienceLocale.embedding`. _(origin R1)_
- R2. Prefer the **same locale** as the generation; cross-locale fallback allowed. _(origin R2)_
- R3. A **tunable similarity threshold** gates "good enough"; below it, the
  fallback applies. _(origin R3)_
- R4. When no published page matches well enough, fall back to the **Easter
  experience**. _(origin R4)_
- R5. Remove the dead synthetic few-shot example; the live drafter's exemplar is
  the matched real page or the Easter fallback. _(origin R5)_
- R6. The exemplar conveys **structure** (block kinds, nesting, ordering, rhythm). _(origin R6)_
- R7. The exemplar conveys **copy voice** (real headings/body as tone reference). _(origin R7)_
- R8. The exemplar **must not** expose real video IDs; the model fills videos only
  from prompt candidates (existing `candidateRef`/`videoId` candidate contract). _(origin R8)_
- R9. The model still designs structure freely; existing draft invariants
  (`DraftExperienceSchema`, section refs, strict output) remain enforced. _(origin R9)_
- R10. Applies to **both** generation modes (full `multi-step-draft` and `quick-draft`). _(origin R10)_

**Origin acceptance/success criteria carried forward:** drafts visibly more
layered than the pre-change baseline; no real exemplar video IDs in output; Easter
used on no-match; both modes exercise the exemplar path.

---

## Scope Boundaries

- Not a literal structure-cloning / template mode (origin rejected).
- No editor-curated "is-exemplar" flag or approved pool (origin rejected — pure
  relevance + Easter fallback).
- No changes to block schema, candidate-video selection, or the playable-video
  filter (this branch builds on top of `216a0967`).
- No bulk / multi-locale generation orchestration changes.
- Embedding **generation** stays Mastra-owned; this plan only **reads**
  admin-owned vectors and reuses the existing query-embedding call.

### Deferred to Follow-Up Work

- **Chat-iterate path** (`default-chat-agent` using `DRAFT_EXPERIENCE_PROMPT` with
  live `searchVideos` tooling): the same exemplar could enrich chat-driven drafts,
  but it is a distinct surface (tool round-trips, incremental diffs). Out of this
  plan; revisit once the workflow path is proven.

---

## Context & Research

### Relevant Code and Patterns

- `src/services/experience.search.ts` — `ExperienceSearchService.search()`:
  canonical cosine `<=>` query over `experience_locale.embedding` with
  `SET LOCAL hnsw.ef_search` inside an interactive `$transaction`, locale +
  `status='published'` + `archived_at IS NULL` filters, then Prisma hydration in
  preserved search order. **Selection query (U1) mirrors this shape** but must
  also return `distance` for the threshold.
- `src/services/embeddings.service.ts` — `generateExperienceEmbedding(text)`
  (historical name; takes a plain string) is the reusable query→1536-vector call,
  already reused by hybrid search. `selectProvider()` honors the
  `LOCAL_QUERY_EMBEDDINGS_SOURCE=gateway` local-dev override. `collectBlockText()`
  - `BLOCK_TEXT_IGNORE_KEY` show the field-ignore approach for stripping
    video/url/id fields — U3 reuses the _idea_ but preserves structure.
- `src/mastra/workflows/multi-step-draft-workflow.ts` — defines **both**
  `multiStepDraftWorkflow` and `quickDraftWorkflow`. Shared prompt builders
  (`buildPlanPrompt`, and the drafter prompt builder) assemble agent input around
  the `Available video candidates (titles only): …` line (~L348). **Single
  injection seam for both modes.** `inputSchema` (~L86) is `{ prompt, locale,
candidates }`.
- `src/app/dashboard/experiences/generate-draft-action.ts` — `runGenerateDraftAction`
  loads candidates (`loadExperienceAiVideoCandidates`), then `run.start({ inputData:
{ prompt, locale, candidates } })` under `ACTION_BUDGET_MS` (`withTimeout`).
  Exemplar selection slots in right after candidate loading.
- `src/domain/blocks.ts` — `BlockSchema` discriminated union (`t` discriminator).
  Video-bearing fields: `videoId`, `streamingUrl`, `previewStreamUrl`,
  `imageOverrideUrl`, `*AssetId`. Copy fields: `heading`, `subheading`, `title`,
  `subtitle`, `description`, `contentParagraphs`, `quotes[].{reference,text}`,
  `ctaLabel`, `buttonLabel`, `*Override`. `sectionKey`/`contentId` are layout
  refs (keep as structure, not video).
- `src/mastra/prompts/draft-experience-prompt.ts` / `plan-experience-prompt.ts` —
  the live agent instruction strings.

### Institutional Learnings

- **`docs/solutions/runtime-errors/silent-semantic-search-degradation-missing-openrouter-key-20260415.md`** —
  a failed embedding call must not silently masquerade as "no relevant match."
  Distinguish embedding-error from no-match before deciding the fallback (U2).
- **`docs/solutions/runtime-errors/cms-easter-seed-not-called-2026-03-30.md`** —
  don't assume the Easter record exists; resolve it explicitly and log loudly if
  absent (U2).
- **`docs/solutions/best-practices/openrouter-only-embedding-provider-contract.md`** —
  the query embedding must come from the same provider/model/dims as the stored
  `ExperienceLocale.embedding`, or you match across vector spaces. Reuse
  `generateExperienceEmbedding` verbatim; don't introduce a second provider path.
- **`docs/solutions/database-issues/set-local-requires-transaction-for-pgvector-search.md`**
  - **`.../performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md`** —
    keep `SET LOCAL ef_search` + query in one `$transaction`; verify the planner
    still uses the index after the published/locale WHERE filter (U1).
- **`docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`** —
  wrap the embedding call (and keep the workflow call) under a budget strictly
  below `ACTION_BUDGET_MS` (U2, U5).
- **`docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`** —
  the new threshold / fallback-slug env vars must be `.optional()` with runtime
  defaults so they don't brick deploys (U2).
- **`docs/solutions/best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md`**
  - **`.../openai-strict-anyof-lenient-per-section-parse-20260422.md`** — changing
    the exemplar changes the section mix the model emits; re-exercise
    `DraftExperienceSchema` normalization after the change (U4/U6 verification).

### External References

None — fully patterned in-repo; no external research needed.

---

## Key Technical Decisions

- **Reuse `ExperienceSearchService`'s vector pattern, add a distance-returning
  selection method** rather than a parallel query implementation. Keeps the
  pgvector read path (and its SET-LOCAL-in-transaction + HNSW discipline) in one
  file. The existing `search()` hydrates rows but drops `distance`; the exemplar
  path needs distance for the threshold, so add a focused method.
- **Exemplar = compact structure+copy outline, not raw blocks JSON.** A dedicated
  builder walks `BlockSchema`, keeps block `t` + nesting + copy fields, drops all
  video/asset/url fields, and bounds size (cap blocks/section depth) to protect
  the token budget. This satisfies R6–R8 and avoids the model copying real video
  IDs.
- **Single injection seam for both modes.** Add optional `exemplar` to the
  workflow `inputSchema` and inject it in the shared `buildPlanPrompt` / drafter
  prompt builder with an explicit "borrow rhythm + tone, NOT videos or exact copy"
  preamble. One change covers full + quick (R10).
- **Embedding-failure ≠ no-match.** On query-embedding error, log an observable
  signal and degrade to the Easter fallback (generation still succeeds); never let
  an outage silently look like a relevance miss.
- **Exemplar is an enhancement, not a hard dependency.** If neither a match nor the
  Easter fallback resolves (e.g., a dev DB with no published experiences), proceed
  with **no** exemplar (current behavior) and log loudly. This tempers the
  "fail-loud" Easter learning: a missing Easter page degrades quality, it does not
  break generation.
- **Tunable threshold + fallback slug via `.optional()` env** with safe runtime
  defaults (`EXPERIENCE_EXEMPLAR_MAX_DISTANCE`, `EXPERIENCE_EXEMPLAR_FALLBACK_SLUG`
  defaulting to the Easter slug). No new required env var.

---

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review,
> not implementation specification. The implementing agent should treat it as
> context, not code to reproduce._

```
runGenerateDraftAction (generate-draft-action.ts)
  ├─ loadExperienceAiVideoCandidates(prompt, locale)        [unchanged]
  ├─ selectExperienceExemplar({ prompt, locale, excludeExperienceId })   ── U2
  │     ├─ generateExperienceEmbedding(prompt)   [timeout-wrapped]  (embeddings.service)
  │     ├─ ExperienceSearchService.findExemplar(vector, locale, exclude)  ── U1
  │     │       cosine <=> over published experience_locale.embedding, returns {row, distance}
  │     ├─ distance <= MAX_DISTANCE ?  → matched row
  │     │   else                       → resolve Easter by slug  (assert published+embedded)
  │     └─ embedding error             → log signal, use Easter
  │            (no resolution at all   → null exemplar, log)
  ├─ buildExemplarOutline(exemplarRow)  → structure+copy string, video IDs stripped   ── U3
  └─ run.start({ inputData: { prompt, locale, candidates, exemplar } })   ── U5
         └─ buildPlanPrompt / drafter builder inject exemplar preamble    ── U4
               (covers multiStepDraftWorkflow AND quickDraftWorkflow)
```

---

## Implementation Units

### U1. Exemplar selection query (vector read with distance)

**Goal:** Find the nearest published `ExperienceLocale` to a query vector,
returning the hydrated row plus cosine `distance`, scoped by locale and excluding
the experience being edited.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**

- Modify: `apps/admin/src/services/experience.search.ts` (add `findExemplar` /
  `findExemplarCandidates` method)
- Test: `apps/admin/src/services/experience.search.test.ts` (create or extend)

**Approach:**

- Mirror `search()`'s `$transaction` + `SET LOCAL hnsw.ef_search` + cosine `<=>`
  shape, but `SELECT … embedding <=> $vec AS distance` and return `{ id, distance }`
  ordered ascending, `LIMIT` small (1–3).
- Filters: `embedding IS NOT NULL`, locale match (with optional cross-locale
  relax), `status='published'`, `archived_at IS NULL`, and exclude
  `experience_id = $excludeExperienceId` so a page can't be its own exemplar.
  Consider excluding template/homepage locales.
- Hydrate the winning id(s) via Prisma selecting `blocks, title, metaDescription,
locale, slug` (no `embedding`).

**Patterns to follow:** `ExperienceSearchService.search()` (same file);
`toPgVector` from `src/db/pgvector.ts`.

**Test scenarios:**

- Happy path: given a seeded vector close to one published locale, returns that
  locale with the smallest distance first.
- Edge: locale filter excludes other-locale rows when same-locale relax is off;
  includes them when relaxed.
- Edge: `excludeExperienceId` omits the edited experience's own locale.
- Edge: only `status='published'`, non-archived, non-null-embedding rows returned.
- Integration: distance is the real cosine value (monotonic with similarity), not
  a placeholder — assert ordering against two seeded vectors of known closeness.

**Verification:** Method returns ordered `{row, distance}`; a live/seeded query
ranks the closest published locale first and respects all filters.

### U2. Exemplar selection orchestration (embed + threshold + Easter fallback)

**Goal:** Turn a prompt + locale into a chosen exemplar row (or null), applying
the threshold, the Easter fallback, and embedding-failure handling.

**Requirements:** R1, R3, R4

**Dependencies:** U1

**Files:**

- Create: `apps/admin/src/services/experience-ai/experience-ai-exemplar.service.ts`
- Modify: `apps/admin/src/config/env.ts` (add `EXPERIENCE_EXEMPLAR_MAX_DISTANCE`,
  `EXPERIENCE_EXEMPLAR_FALLBACK_SLUG` — both `.optional()` with runtime defaults)
- Test: `apps/admin/src/services/experience-ai/experience-ai-exemplar.service.test.ts`

**Approach:**

- `selectExperienceExemplar({ prisma, experienceSearch, prompt, locale,
excludeExperienceId })`:
  1. `generateExperienceEmbedding(prompt)` wrapped in a `Promise.race` timeout
     budget below `ACTION_BUDGET_MS`.
  2. `findExemplar` (U1). If top distance `<= MAX_DISTANCE` → return matched row +
     provenance `{ source: "matched", distance }`.
  3. Else resolve Easter by `EXPERIENCE_EXEMPLAR_FALLBACK_SLUG` in the requested
     locale (then any locale); assert published + non-null embedding; return
     `{ source: "fallback" }`.
  4. On embedding error: log `event=experience_exemplar.embedding_failure …`
     (plain-string key=value per the Railway logsV2 learning) and use the Easter
     fallback.
  5. If nothing resolves: return `null` and log
     `event=experience_exemplar.none reason=…`.
- Pure selection only — no outline building here (that's U3).

**Execution note:** Test-first — the branch matrix (matched / below-threshold /
embedding-error / Easter-missing) is the core risk surface.

**Patterns to follow:** outbound-timeout discipline
(`outbound-timeout-shorter-than-caller-budget-20260506.md`); plain-string logging
(admin search `event=query_embedding_failure` convention); `.optional()` env vars.

**Test scenarios:**

- Happy path: distance under threshold → returns matched row, `source="matched"`.
- Edge: distance over threshold → returns Easter, `source="fallback"`.
- Error path: embedding call rejects → logs failure signal AND returns Easter
  (not null), proving error ≠ no-match.
- Error path: embedding call times out (exceeds budget) → same as reject.
- Edge: Easter slug resolves no published+embedded locale → returns `null` + logs
  `none`; does not throw.
- Edge: threshold env unset → uses documented default distance.

**Verification:** Each branch returns the documented provenance and emits the
right observable log; generation never throws because an exemplar was unavailable.

### U3. Exemplar outline builder (structure + copy, video IDs stripped)

**Goal:** Reduce a chosen `ExperienceLocale` (blocks + title + metaDescription) to
a compact, bounded structure-and-voice string with all video/asset/url fields
removed.

**Requirements:** R6, R7, R8

**Dependencies:** None (consumes a row shape; usable independently of U1/U2)

**Files:**

- Create: `apps/admin/src/services/experience-ai/experience-ai-exemplar-outline.ts`
- Test: `apps/admin/src/services/experience-ai/experience-ai-exemplar-outline.test.ts`

**Approach:**

- `buildExemplarOutline({ title, metaDescription, blocks })` → string.
- Parse `blocks` with `z.array(BlockSchema).safeParse`; on failure, walk leniently
  (mirror `collectBlockText`'s defensive walk).
- Emit each block's `t` + nesting (section/container children) + copy fields
  (`heading`, `subheading`, `title`, `subtitle`, `description`,
  `contentParagraphs`, `quotes[].{reference,text}`, `ctaLabel`, `buttonLabel`,
  `*Override`). Keep `sectionKey`/`contentId` as structural anchors.
- **Strip** `videoId`, `streamingUrl`, `previewStreamUrl`, `imageOverrideUrl`,
  `imageUrl`, `*AssetId`, and any `*Url`/`*Link`/`*Id` per the
  `BLOCK_TEXT_IGNORE_KEY` field set.
- Bound output: cap total blocks (e.g. first N sections) and array lengths so a
  13-section Easter page stays within a sane token budget; note truncation in the
  string.

**Patterns to follow:** `collectBlockText` / `BLOCK_TEXT_IGNORE_KEY` in
`embeddings.service.ts`; `BlockSchema` field inventory in `src/domain/blocks.ts`.

**Test scenarios:**

- Happy path: a multi-section fixture yields an outline containing block kinds +
  copy in document order.
- Critical (R8): output contains **no** `videoId` / streaming / asset / url value
  from the fixture — assert the known fixture video IDs are absent from the string.
- Edge: nested section/container children are represented with their nesting.
- Edge: oversized input (15+ sections) is truncated to the cap with a truncation
  marker.
- Edge: malformed/partial `blocks` JSON still produces a best-effort outline
  without throwing.

**Verification:** Outline preserves structure + copy, provably excludes every
video/asset/url token, and stays within the size cap.

### U4. Inject exemplar into the draft workflow prompts (both modes)

**Goal:** Thread an optional `exemplar` through the workflow input and into the
shared planner/drafter prompt builders with a clear "reference only" framing.

**Requirements:** R6, R7, R9, R10

**Dependencies:** U3 (defines the string shape injected)

**Files:**

- Modify: `apps/admin/src/mastra/workflows/multi-step-draft-workflow.ts`
  (`inputSchema` + `buildPlanPrompt` + drafter prompt builder; both
  `multiStepDraftWorkflow` and `quickDraftWorkflow` consume these)
- Modify (optional): `apps/admin/src/mastra/prompts/draft-experience-prompt.ts` /
  `plan-experience-prompt.ts` if a static preamble constant reads better than an
  inline string
- Test: `apps/admin/src/mastra/workflows/multi-step-draft-workflow.test.ts`

**Approach:**

- Add `exemplar: z.string().optional()` to `inputSchema`.
- In the shared prompt builders, when `exemplar` is present, prepend a labeled
  section: _"Structure & voice reference (borrow rhythm and tone; do NOT reuse its
  videos, and write your own copy): <exemplar>"_ — kept distinct from the
  authoritative editor prompt and the candidate list.
- No change to `DraftExperienceSchema` or output contract (R9).

**Patterns to follow:** existing `candidateHint` assembly in `buildPlanPrompt`
(~L348); the prompt's existing "editor prompt is authoritative" framing.

**Test scenarios:**

- Happy path: with `exemplar` set, both plan and draft prompts contain the
  reference section and the editor prompt remains marked authoritative.
- Edge: `exemplar` omitted → prompts are byte-identical to current behavior
  (regression guard for the default path).
- Integration: `quick-draft` and `multi-step-draft` both include the exemplar
  (proves the shared-builder seam covers both modes).

**Verification:** Both workflows surface the exemplar when provided and are
unchanged when it is absent; output schema unaffected.

### U5. Wire exemplar selection into the draft action

**Goal:** In `runGenerateDraftAction`, after candidate loading, select + build the
exemplar and pass it into the workflow `inputData`, within the action's time budget.

**Requirements:** R1, R10

**Dependencies:** U2, U3, U4

**Files:**

- Modify: `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts`
- Test: `apps/admin/src/app/dashboard/experiences/generate-draft-action.test.ts`

**Approach:**

- After `loadExperienceAiVideoCandidates`, call `selectExperienceExemplar` (U2),
  then `buildExemplarOutline` (U3) when a row is returned; pass `exemplar` into
  `run.start({ inputData })`.
- Exemplar selection failure must **not** fail generation — wrap so a thrown
  selector error degrades to `exemplar: undefined` with an observable log (mirrors
  the candidate-loader try/catch but is non-fatal: candidates are required,
  exemplar is not).
- Keep the whole path inside `ACTION_BUDGET_MS`; the embedding timeout (U2) is
  budgeted below it.
- Pass `excludeExperienceId` from the action input so the edited experience isn't
  its own exemplar.

**Patterns to follow:** existing candidate-load + `withTimeout(run.start(...))`
structure in the same file.

**Test scenarios:**

- Happy path: selector returns a matched row → `inputData.exemplar` is the built
  outline.
- Edge: selector returns null → `inputData.exemplar` is undefined; generation
  proceeds normally.
- Error path: selector throws → caught, logged, `exemplar` undefined, generation
  still succeeds (NO_CANDIDATES / draft path unaffected).
- Edge: exemplar selection latency is bounded by the action budget (no unbounded
  await).

**Verification:** Draft generation runs end-to-end with a matched exemplar, a
fallback exemplar, and no exemplar; failures in selection never block a draft.

### U6. Remove the dead synthetic few-shot example

**Goal:** Delete the unused `FEW_SHOT_EXAMPLE` / `FEW_SHOT_SECTION` /
`buildSystemPrompt` synthetic exemplar so the only exemplar source is the live
real-page path.

**Requirements:** R5

**Dependencies:** None (independent cleanup; land after U5 proves the live path
works)

**Files:**

- Modify: `apps/admin/src/services/experience-ai/experience-ai-prompts.ts`
- Modify (if referenced only in comments): `apps/admin/src/services/experience-ai/experience-ai-chat-prompts.ts`
- Test: existing `experience-ai-prompts` tests (update/remove assertions tied to
  the deleted exports)

**Approach:**

- Confirm zero runtime callers (`buildSystemPrompt` here is distinct from the
  unrelated `search-trace-query-classifier.ts` one). Remove the exports and any
  now-dead helpers; fix the doc comment in `experience-ai-chat-prompts.ts`.

**Execution note:** Characterization-light — verify "no live caller" via grep
before deleting; rely on typecheck + test to catch stragglers.

**Test scenarios:**

- `Test expectation: none` for behavior — this removes dead code. Verification is
  green typecheck + existing suite after deletion (and removal of tests that only
  asserted the synthetic example's shape).

**Verification:** `pnpm --filter @forge/admin typecheck` and `test` pass with the
exports removed; no remaining import references.

---

## System-Wide Impact

- **Interaction graph:** New read path: action → `selectExperienceExemplar` →
  `generateExperienceEmbedding` (embedding provider) + `ExperienceSearchService`
  (Postgres/pgvector) → Mastra workflow input. No new write paths; embeddings are
  read-only here.
- **Error propagation:** Exemplar selection is non-fatal — embedding errors,
  timeouts, missing Easter, and selector exceptions all degrade gracefully
  (matched → fallback → none) and never surface as draft-generation failures.
- **State lifecycle risks:** None — no persistence introduced. Vectors are read,
  never written.
- **API surface parity:** The chat-iterate path (`default-chat-agent`) shares
  `DRAFT_EXPERIENCE_PROMPT` but is deliberately **not** changed here (deferred).
  Note the asymmetry so reviewers don't read it as an omission.
- **Integration coverage:** A real/seeded-DB exercise of U1 (distance ordering +
  filters) and an end-to-end action test (U5) covering matched/fallback/none are
  the cross-layer proofs mocks alone won't establish.
- **Unchanged invariants:** `DraftExperienceSchema` output contract, candidate
  `videoId` resolution in `experience-ai-normalize.ts`, the playable-video
  candidate filter (`216a0967`), and the GraphQL no-embedding-leak guard all stay
  intact.

---

## Risks & Dependencies

| Risk                                                                                  | Mitigation                                                                                                      |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Embedding outage silently always uses Easter, masking a provider problem              | Distinct observable log for embedding-failure vs no-match (U2); operators can grep the signal.                  |
| HNSW index bypassed by the published/locale WHERE filter → slow scan                  | Verify query plan after adding filters; reuse the proven `search()` filter shape (U1).                          |
| Query embedding from a different provider/space than stored vectors → garbage matches | Reuse `generateExperienceEmbedding` verbatim; no second provider path (U2).                                     |
| Exemplar leaks real video IDs into drafts                                             | U3 strips all video/asset/url fields; a dedicated test asserts the fixture's IDs are absent.                    |
| New env var bricks Railway deploy                                                     | Both new env vars `.optional()` with runtime defaults (U2).                                                     |
| Easter page absent in a target DB (e.g., local dev)                                   | Graceful degrade to no exemplar + loud log; generation still works.                                             |
| Branch depends on unmerged `216a0967`                                                 | Tracked: this branch is based on `fix/ai-video-candidates-playability`; rebase onto `main` once that PR merges. |

---

## Open Questions

### Resolved During Planning

- _Where does the live few-shot live?_ → It doesn't; the live drafter has no
  few-shot. We add an exemplar to the Mastra prompt and delete the dead synthetic
  code (reframes origin R5).
- _Reuse existing search or new query?_ → Add a distance-returning method to
  `ExperienceSearchService` (reuses the pgvector read discipline).
- _Both modes?_ → Yes; both workflows share prompt builders, so one seam covers
  full + quick.
- _Fail-loud vs degrade when Easter missing?_ → Degrade to no exemplar + loud log;
  exemplar is an enhancement, not a hard dependency.

### Deferred to Implementation

- Exact default `EXPERIENCE_EXEMPLAR_MAX_DISTANCE` value — tune against seeded
  data during implementation; ship a conservative default and document it.
- Number of exemplars surfaced (1 vs 2–3) — start with 1; widen only if quality
  testing shows benefit and the token budget allows.
- Whether to exclude template/homepage locales from exemplar candidates — decide
  against real seed data in U1.
- Exact size cap / truncation strategy in U3 — set against the live Easter page's
  serialized size and the agent token budget.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-06-15-ai-experience-exemplar-generation-requirements.md`
- Live exemplar reference (production): Easter experience `cmpdhy1pa0000ca05mtvcuicw`
- Vector read pattern: `apps/admin/src/services/experience.search.ts`
- Query embedding: `apps/admin/src/services/embeddings.service.ts`
- Draft workflows: `apps/admin/src/mastra/workflows/multi-step-draft-workflow.ts`
- Draft action: `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts`
- Block schema: `apps/admin/src/domain/blocks.ts`
- Dead synthetic example: `apps/admin/src/services/experience-ai/experience-ai-prompts.ts`
