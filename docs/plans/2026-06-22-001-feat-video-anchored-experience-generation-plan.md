---
title: "feat: Video-Anchored Experience Generation (context pack + grounded section generator)"
type: feat
status: active
date: 2026-06-22
origin: docs/brainstorms/2026-06-22-video-anchored-experience-generation-requirements.md
deepened: 2026-06-22
regrounded: 2026-06-22 # rewritten against the post-#1330 consolidated architecture (apps/mastra + @forge/experience-schema)
---

# feat: Video-Anchored Experience Generation

## Summary

Add a video-anchored path to AI experience generation: a reusable **video context pack**
(admin) assembles a video's real curated data (study questions, Bible citations, optional
scene/transcript, media); a single-pass **section generator** (mastra) composes ONE
schema-valid grounded section — FAQ from study questions, scripture _references_ from
citations (no LLM-authored verse text), description anchored to pack context; admin
re-validates, allowlist-filters against the pack, normalizes, and stages it for review.
Verse text is resolved at web render from the pipeline already in production on the watch
surface. The work is now **cross-service** because of the in-flight admin→mastra
consolidation (#1330): the LLM contract lives in `@forge/experience-schema`, the generator in
`apps/mastra`, persistence/UI/DB in `apps/admin`, joined by a bearer-gated HTTP route.

> **Re-grounded 2026-06-22.** This plan was first written against a branch 96 commits behind
> `main`. PR #1330 ("consolidate admin draft/chat generation into the standalone service")
> moved the draft schema to `@forge/experience-schema` and is migrating generation
> `apps/admin/src/mastra` → `apps/mastra`. The unit breakdown below (N0–N10) targets the
> consolidated architecture and supersedes the earlier U1–U7 breakdown.

---

## Problem Frame

Generation is theme-prompt-driven and the model authors FAQ, scripture, and descriptions from
scratch (hallucination + relevance risk; verse `text` is free-generated and published to a
ministry audience). Meanwhile `apps/admin` holds rich per-video curated data — verified
populated: **44,506 study questions, 1,268 citations, 649 videos with both** — that generation
never consumes. Anchoring on a chosen video and composing from its real data turns the model
from _author_ into _composer_. See origin for the full frame:
`docs/brainstorms/2026-06-22-video-anchored-experience-generation-requirements.md`.

**Consolidated architecture (post-#1330) — where things live now:**

| Concern                                                            | Home                       | Key files                                                                                                                                                     |
| ------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM draft **contract** (Zod) + parity test                         | `@forge/experience-schema` | `packages/experience-schema/src/experience-ai.schemas.ts`, `index.ts`, `index.test.ts`                                                                        |
| **Generator** (agents, workflows, prompts, budgets, bearer routes) | `apps/mastra`              | `apps/mastra/src/mastra/{agents/specialized-agents.ts,workflows/experience-draft-route.ts,prompts/,budgets.ts,index.ts}`                                      |
| Orchestration, **persistence**, DB reads, normalize, **UI**        | `apps/admin`               | `experience-ai.service.ts`, `experience-ai-normalize.ts`, `domain/blocks.ts`, `mastra-experience-draft-client.ts`, `generate-draft-action.ts`, the chat panel |
| Public **SDL** + typed client                                      | `packages/admin-graphql`   | `apps/admin/schema.graphql`, `packages/admin-graphql/src/admin-graphql-env.d.ts`                                                                              |
| Render-time verse text                                             | `apps/web`                 | `components/sections/BibleQuotesCarousel.tsx`, `lib/youversion-passage.ts`                                                                                    |

Admin invokes mastra over a bearer-gated HTTP route (`/forge-experience-draft`,
`mastra-experience-draft-client.ts`, flag `EXPERIENCE_AI_REMOTE_DRAFT`, `MASTRA_DRAFT_TIMEOUT_MS`
strictly > mastra's internal `TIME_BUDGET_MS`). Admin re-validates the returned `DraftExperience`
against the shared schema, then runs the canonical persistence layer (normalize + `BlocksSchema`).

**Data readiness (verified local, 2026-06-22):** 1,104 videos · 44,506 study questions · 1,268
citations · **649 videos with both** · 0 scene/transcript rows in some envs (→ optional).

---

## Requirements

- R1–R11 carried from origin (context pack, graceful degradation, locale-awareness, reusable
  service, schema-valid grounded section, FAQ from study questions, scripture from real
  citations with NO LLM verse text, model-composes-not-authors, normalize+stage, provenance,
  editor anchor-picker). R12 (retrofit existing pipeline) deferred.
- **Verse text (resolved):** reference-first — the model emits a citation reference + structured
  identity (`osisId`/chapter/verse), never verse text; `apps/web` resolves text at render via
  the existing YouVersion+jsdelivr pipeline.

**Origin actors:** A1 editor, A2 context pack, A3 section generator, A4 existing pipeline, A5
normalize+staged-review. **Flows:** F1 anchor→section, F2 graceful degradation, F3 retrofit
(deferred). **Acceptance examples:** AE1 (R5,R6), AE2 (R7), AE3 (R2,R8), AE4 (R6), AE5 (R10).

---

## Scope Boundaries

- Not replacing the theme-prompt pipeline; adds an anchored entry point.
- Not building scene/transcript backfill; the pack degrades without them.
- Not the whole-page-from-one-anchor assembler (origin Shape B).
- Not building generation eval/telemetry (separate thread).
- **Not expanding the admin in-process generation surface** — the section path is built
  **remote-first** (mastra) so #1330's U10 cutover (which deletes admin's in-process
  agents/workflows) doesn't have to delete new code too.

### Deferred to Follow-Up Work

- **R12 retrofit** — feeding context packs into the existing theme-prompt pipeline.
- **Video-detail-page entry point** — a "Generate from this video" action on
  `apps/admin/src/app/dashboard/videos/video-detail-page.tsx` (v1 ships the editor anchor-picker).
- **Vendored offline verse-text corpus** behind the same render seam (broader offline coverage).
- **Generation outcome telemetry** (recommended companion).

---

## Key Technical Decisions

_(Open decisions from re-grounding, resolved with the recommended defaults.)_

- **Build the generator remote-first in `apps/mastra`.** The admin in-process copies are slated
  for deletion at #1330's U10 cutover; building there would be thrown away and never reached
  once `EXPERIENCE_AI_REMOTE_*` is on. No admin in-process fallback for the section path.
- **Section-unit Zod schema lives in `@forge/experience-schema`.** So admin re-validates the
  wire response with the same schema the generator produced, and the parity test
  (`index.test.ts`) covers it — preserving the no-drift invariant #1330 established.
- **Sibling bearer-gated route `/forge-experience-section`**, not a `mode` on
  `/forge-experience-draft`. The draft route runs multi-step _workflows_ via `getWorkflowById`;
  the section path is a single `agent.generate`. A sibling route is cleaner than an
  agent-vs-workflow branch (costs a second registration + client + env + keyring entry).
- **Allowlist runs admin-side, post-response.** The pack (citations + study questions) is
  admin-owned; keeping mastra stateless and filtering after the response avoids shipping/duplicating
  trust. Mastra may emit off-pack content; admin drops it (so the generator allowlist test lives
  admin-side). Grounding (study questions + citations) is **shipped in the request body** (simpler
  for a single buffered call than an `/api/internal/agent-tools/*` callback round-trip).
- **Dedicated flag `EXPERIENCE_AI_REMOTE_SECTION`** (not reusing `EXPERIENCE_AI_REMOTE_DRAFT`) —
  decoupled blast radius; `.optional()` env per the opt-in-env learning.
- **Reference-first scripture, STRUCTURED.** The bible-quote schema gains `text` optional + the
  structured citation fields (`osisId`, `chapterStart/End`, `verseStart/End`) so the watch
  resolver is reused verbatim and the allowlist matches stable identity, not a fuzzy label. This
  schema change spans **three homes in lockstep**: `@forge/experience-schema` (draft),
  `apps/admin/domain/blocks.ts` (canonical), and the SDL/Pothos `BibleQuoteItem` → web fragment.
- **FAQ answers are model-authored prose, NOT allowlisted** — flagged `needs_verification` in the
  review ledger for editorial check. R8 holds for references, not free-prose answers.
- **Quiz omitted unless a configured `nextstep.is` URL exists** — never fabricated.
- **Append, not replace.** `StagedDraftPreview` gains a `mode: "replace" | "append"`
  discriminator; append computes `next.blocks = [...current, ...section]` and does NOT clobber
  the experience's `title`/`metaDescription`.
- **Separate web flag `forge.experience.youVersionBibleQuotes`** (default off), not the watch flag.

---

## Open Questions

### Resolved During Planning / Re-grounding

- Entry point → editor anchor-picker (video-detail-page deferred).
- Section architecture → single-pass agent in mastra.
- Verse text → reference-first + render-time resolution (YouVersion BSB / jsdelivr).
- All seven re-grounding open decisions → resolved above (Key Technical Decisions).

### Deferred to Implementation

- Exact section-unit Zod block subset/order — settle against `DraftBlockSchema` in N0.
- Per-locale YouVersion version-id validation beyond BSB — verify at N10 rollout.
- Study-question selection count / rephrase-vs-verbatim — tune in N5 against real data.

---

## High-Level Technical Design

> _Directional guidance for review, not implementation specification._

```
Editor picks anchor video (locale)  ── apps/admin
   │  runGenerateSectionAction
   │   ├─ ABAC (canEditExperienceLocale) + anchor playability pre-check → ANCHOR_NOT_FOUND
   │   ├─ loadVideoContextPack(prisma, {videoId, locale})  [N4]
   │   │     study questions + citations(+structured ids, ref label [N3]) + opt scene/transcript + media + provenance
   │   └─ NO_GROUNDING guard; build anchor VideoCandidate(v01) from pack.video
   │
   ▼  POST /forge-experience-section  (bearer; AbortSignal.timeout > mastra budget)  [N7]
        { locale, anchorCandidate, grounding:{studyQuestions[], citations[]} }
                         │  ── apps/mastra
                         ▼  buildVideoSectionAgent.generate(structuredOutput: SectionUnitSchema, toolChoice:none)  [N5,N6]
        { ok:true, draft } | { ok:false, reason, retryable }
   │  ── apps/admin (N7 client)
   ▼  re-validate against SectionUnitSchema (@forge/experience-schema [N0])
   ▼  ALLOWLIST: scripture tuple ∈ pack.citations ; FAQ ∈ pack.studyQuestions ; drop off-pack + log  [N7]
   ▼  wrap in synthetic DraftExperience envelope (placeholder title/meta)  [N8]
   ▼  normalizeExperienceDraft(envelope, [anchorCandidate])  [N1 makes text-less quote valid]
   ▼  setStagedDraft({blocks, review(needs_verification answers), mode:"append"})  [N9]
   ▼  editor reviews → Apply: next.blocks=[...current,...section] (title/meta untouched; reversible)
   │
   ▼  apps/web renders; BibleQuotesCarouselServer resolves verse TEXT from structured ids  [N10]
        via YouVersion(BSB)+jsdelivr; reference-only on miss; flag forge.experience.youVersionBibleQuotes
```

---

## Implementation Units

> Dependency order: **N0→N1→N2** (schema lockstep) ; **N3→N4** (pack) ; **N0→N5→N6** (mastra
> generator+route) ; **N4→N7→N8→N9** (admin caller→action→UI) ; **N2→N10** (web). N3 has no deps.

### N0. Extend `@forge/experience-schema` (draft contract + section-unit schema + parity test)

**Goal:** Reference-first bible-quote (text optional + structured citation fields) and a new
single-section draft schema, single-sourced for generator + re-validator.

**Requirements:** R5, R7, R8 · **Dependencies:** none · **App:** `@forge/experience-schema`

**Files:**

- Modify: `packages/experience-schema/src/experience-ai.schemas.ts` — `DraftBibleQuoteItemSchema`:
  `text` → optional; add optional `osisId`, `chapterStart`, `chapterEnd`, `verseStart`,
  `verseEnd`. Add `DraftVideoSectionSchema` (videoHero/video + text + relatedQuestions +
  bibleQuotesCarousel + optional quizButton).
- Modify: `packages/experience-schema/src/index.ts` (re-export new symbols).
- Modify: `packages/experience-schema/src/index.test.ts` (parity test asserts the new public
  surface) + `experience-ai.schemas.test.ts`.

**Approach:** Keep `reference` required. The section schema is a constrained subset of
`DraftBlockSchema` reused by the mastra generator (`structuredOutput`) and admin re-validation.

**Execution note:** Extend the parity test in the SAME commit — it imports only `./index`, so a
new symbol not re-exported (or a drifted shape) must fail it.

**Test scenarios:**

- Happy: `DraftBibleQuoteItemSchema` accepts reference + structured ids, no `text`.
- Happy: `DraftVideoSectionSchema` validates a minimal grounded section.
- Edge: a quote with `text` present still validates (backward compatible).
- Parity: `index.test.ts` asserts the new exported symbols/shape.

**Verification:** Package builds; parity test green; both consumers can import the section schema.

### N1. Canonical persistence schema (admin `blocks.ts`)

**Goal:** Mirror N0 in the canonical schema so text-less, structured quotes pass `BlocksSchema`.

**Requirements:** R7 · **Dependencies:** N0 · **App:** `apps/admin`

**Files:** Modify `apps/admin/src/domain/blocks.ts` (`BibleQuoteItemSchema`: `text` optional +
structured fields), `apps/admin/src/domain/blocks.test.ts`,
`apps/admin/src/services/experience-ai/experience-ai-normalize.ts` (+ `.test.ts`) — confirm
`compactRecord` drops absent `text` and the structured fields pass through.

**Execution note:** Ship in the **same commit** as N0 — otherwise a text-less quote fails
`BlocksSchema.safeParse` → `INVALID_BLOCKS`.

**Test scenarios:** canonical accepts reference+ids without text; `text` present still valid;
normalize round-trips a text-less quote through `BlocksSchema.safeParse`.

### N2. SDL + admin-graphql regen + web fragment

**Goal:** Expose the structured citation fields to web via the typed client.

**Requirements:** R7 · **Dependencies:** N1 · **App:** `apps/admin` + `packages/admin-graphql`

**Files:** `apps/admin/src/graphql/types/experience.ts` (Pothos `BibleQuoteItem` fields), regen
`apps/admin/schema.graphql` (`pnpm --filter @forge/admin schema:print`) +
`packages/admin-graphql/src/admin-graphql-env.d.ts` (`pnpm --filter @forge/admin-graphql generate`),
update the apps/web bible-quote fragment.

**Test scenarios:** `Test expectation: none` for the codegen artifacts (mechanical); the CI drift
jobs (`admin-schema-drift`, `admin-graphql-generate`) are the gate. Add a web fragment type check.

### N3. Citation → localized reference label helper (admin)

**Goal:** Compose "John 20:19-29" from a citation + `BibleBook.name[locale]`; no verse text.

**Requirements:** R7 · **Dependencies:** none · **App:** `apps/admin`

**Files:** Create `apps/admin/src/services/experience-ai/citation-reference.ts` (+ `.test.ts`);
lift the name-map/locale-fallback logic from
`apps/admin/src/services/experience-ai/agent-tools.service.ts` (the bible reads now live here,
NOT the relocated mastra tool).

**Test scenarios:** single verse, verse range, chapter-only, cross-chapter range, locale
fallback; never emits text.

### N4. Video context pack service (admin Prisma reads)

**Goal:** Assemble per-video grounding with graceful degradation + provenance.

**Requirements:** R1, R2, R3, R4 · **Dependencies:** N3 · **App:** `apps/admin`

**Files:** Create `apps/admin/src/services/experience-ai/video-context-pack.service.ts`
(+ `.test.ts`); Modify `apps/admin/src/services/experience-ai/experience-ai.service.ts` (export
`PLAYABLE_CANDIDATE_VIDEO_WHERE`); reuse `videoStudyQuestionsFilter`
(`apps/admin/src/graphql/types/video.ts`).

**Approach:** `loadVideoContextPack(prisma, { videoId, locale })` → `{ video (mirrors
VideoCandidate fields), studyQuestions[], citations[](reference label via N3 + structured ids),
scene?, transcript?, provenance }`. Mirror `experience-ai.service.ts` (DI'd Prisma, batched
hydration, try/catch→`console.warn("[experience-ai] …")`→provenance false). Each source optional.

**Test scenarios:** full pack (all provenance true); no scene/transcript (AE3); no study
questions → `[]` (AE4); locale fallback recorded; source throw → degrades, no throw; non-playable
excluded (playability gate).

### N5. Mastra section generator agent + prompt

**Goal:** Single-pass agent that composes one grounded section from shipped grounding.

**Requirements:** R5, R6, R7, R8 · **Dependencies:** N0 · **App:** `apps/mastra`

**Files:** `apps/mastra/src/mastra/agents/specialized-agents.ts` (`buildVideoSectionAgent`,
`SpecializedAgentId`), `apps/mastra/src/mastra/prompts/generate-video-section-prompt.ts` +
`prompts/index.ts` + `prompts/prompts.test.ts`, `apps/mastra/src/mastra/budgets.ts`
(`TOKEN_CAPS.generateVideoSection`), `apps/mastra/src/mastra/index.ts` (register agent).

**Approach:** Memory-less agent (workflow-agent pattern). Prompt renders the shipped grounding:
study questions = FAQ question source (verbatim/lightly rephrased); citations = the only allowed
references, copied **verbatim** (incl. structured ids) from the grounding; scene/transcript/title
= description context; **forbid emitting verse text**; FAQ `answer` is composed prose.
`agent.generate(structuredOutput: DraftVideoSectionSchema, toolChoice:"none")` gated by the
structured-output gate. Quiz only from a configured `nextstep.is` URL.

**Test scenarios:** composes FAQ from study questions + scripture refs (no text); omits FAQ when
none; omits quiz when no URL; prompt asserts "no verse text" + "copy references verbatim".

### N6. Mastra section route (bearer-gated)

**Goal:** A buffered `/forge-experience-section` route running the N5 agent.

**Requirements:** R5, R9 · **Dependencies:** N5 · **App:** `apps/mastra`

**Files:** Create `apps/mastra/src/mastra/workflows/experience-section-route.ts`
(`ExperienceSectionRequestSchema`, `handleExperienceSectionRouteRequest`), register
`registerApiRoute('/forge-experience-section')` in `apps/mastra/src/mastra/index.ts`; reuse
`apps/mastra/src/server/service-bearer.ts` (`isValidServiceBearer`).

**Approach:** Mirror `experience-draft-route.ts`: strict Zod request `{ locale, anchorCandidate,
grounding }`; run agent under `AbortSignal.timeout(TIME_BUDGET_MS.section)` with best-effort
cancel; return `{ ok:true, draft } | { ok:false, reason, retryable }`.

**Execution note:** Deploy the receiver route **before** the caller env flag (keyring-first), or
the first call 401s.

**Test scenarios:** valid request → draft; invalid bearer → 401; malformed body → 400; agent
timeout → `{ ok:false, retryable }`; dispatch-level test for the route handler.

### N7. Admin section client + post-response allowlist filter

**Goal:** Call mastra, re-validate, and drop off-pack content admin-side.

**Requirements:** R7, R8 · **Dependencies:** N4 (and N0 for the schema) · **App:** `apps/admin`

**Files:** Create `apps/admin/src/services/experience-ai/mastra-experience-section-client.ts`
(mirror `mastra-experience-draft-client.ts`), `apps/admin/src/services/experience-ai/section-generator.ts`
(+ `.test.ts`), Modify `apps/admin/src/config/env.ts` (`EXPERIENCE_AI_REMOTE_SECTION`,
`MASTRA_SECTION_TIMEOUT_MS`).

**Approach:** Client: `config_missing` short-circuit, Bearer, `AbortSignal.timeout` strictly >
mastra's budget, re-validate the returned section against `DraftVideoSectionSchema` (N0).
Allowlist (post-response): drop any `bibleQuotesCarousel` quote whose `(osisId, chapterStart,
chapterEnd, verseStart, verseEnd)` tuple isn't in `pack.citations`; drop any FAQ whose question
doesn't map to `pack.studyQuestions`; omit emptied blocks; log
`[experience-ai] event=section_generation.filtered count=<n> reason=…`. Tag FAQ answers
`needs_verification`.

**Test scenarios:** off-pack scripture tuple dropped + logged; off-pack FAQ dropped; config
missing → typed short-circuit; timeout ordering (client > route); answer tagged needs_verification.

### N8. Section server action

**Goal:** Orchestrate ABAC → pack → remote call → re-validate/allowlist → normalize → stageable result.

**Requirements:** R9, R10, R11 · **Dependencies:** N7 · **App:** `apps/admin`

**Files:** Create `apps/admin/src/app/dashboard/experiences/generate-section-action.ts`
(+ `.test.ts`); pattern from `generate-draft-action.ts`.

**Approach:** ABAC `canEditExperienceLocale`; anchor playability pre-check FIRST →
`ANCHOR_NOT_FOUND` (distinct from `NO_GROUNDING`); load pack (N4); `NO_GROUNDING` if no study
questions and no citations; build anchor `VideoCandidate` (`v01`) from `pack.video`; call N7
(flag `EXPERIENCE_AI_REMOTE_SECTION`); wrap section blocks in a synthetic `DraftExperience`
envelope with placeholder `title`/`metaDescription` (anchor title) to satisfy
`normalizeExperienceDraft`, dropped on append; normalize with `[anchorCandidate]`; build
`QualityDraftReview` + `referenceLedger` (scripture=`scripture`, anchor=`video_candidate`,
answers=`needs_verification`); skip `CANVAS_NOT_EMPTY` (append). Plain-string logging.

**Test scenarios:** valid anchor → `{ok:true,draft,review}` (AE1); `ANCHOR_NOT_FOUND`;
`NO_GROUNDING`; append onto non-empty canvas; dispatch-level test; ledger flags answers (AE5).

### N9. Staged-review path + anchor-video picker

**Goal:** Editor picks an anchor and reviews/edits/undoes the generated section with provenance.

**Requirements:** R10, R11 · **Dependencies:** N8 · **App:** `apps/admin`

**Files:** Modify `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
(`generateSectionAction` prop + picker; route into `setStagedDraft({…,review,mode:"append"})`),
`experience-editor-with-chat.tsx`, `[id]/page.tsx` (`"use server"` thunk → N8),
`experience-chat-panel.test.tsx`.

**Approach:** Reuse `videoLibrary` + `loadVideosByIdsAction` for the picker. **Append is net-new:**
add the `mode` discriminator to `StagedDraftPreview`; in append mode `handleApplyStagedDraft`
computes `next.blocks = [...current.blocks, ...sectionBlocks]` and must NOT overwrite
`title`/`metaDescription`; `beforeBlocks` reversibility stashes the pre-append canvas. Verify
`QualityReviewCard` renders the `needs_verification` ledger.

**Test scenarios:** picker+generate populates staged (mode append); Apply preserves existing
blocks + title/meta and is undoable; `QualityReviewCard` flags answers (AE5); action failure
surfaces typed message, no mutation.

### N10. Web render-time verse-text resolution

**Goal:** Resolve real verse text at render from the existing pipeline; never the model.

**Requirements:** R7 · **Dependencies:** N2 · **App:** `apps/web`

**Files:** Create `apps/web/src/components/sections/BibleQuotesCarouselServer.tsx` (RSC wrapper);
Modify `BibleQuotesCarousel.tsx` (`"use client"`, accept passages as prop), `sections/index.tsx`
(dispatch to wrapper); reuse `lib/youversion-passage.ts` (`server-only`),
`lib/youversion-reference.ts` (`toYouVersionReference`), `watch/BibleQuotesSection.tsx`
(`LOCALE_TO_BIBLE_VERSION_MAP`, attribution/copyright fail-closed); `BibleQuotesCarousel.test.tsx`.

**Approach:** Server wrapper resolves text keyed on N2's structured fields (reuses the watch
resolver directly — no string parsing), passes as prop to the client carousel. App key stays
server-only. Reference-only on miss; copyright fail-closed. **Separate** LaunchDarkly flag
`forge.experience.youVersionBibleQuotes` (default off).

**Test scenarios:** structured-fields quote → real text + attribution; miss/timeout →
reference-only; legacy quote with `text` still renders; missing copyright → fail-closed; flag off
→ jsdelivr/reference-only path only.

---

## System-Wide Impact

- **Three-home schema lockstep:** `DraftBibleQuoteItemSchema` (`@forge/experience-schema`),
  `BibleQuoteItemSchema` (`apps/admin/domain/blocks.ts`), and the SDL/Pothos `BibleQuoteItem` →
  web fragment must change together (N0+N1+N2 same change-set). A relaxation in one but not the
  others = `INVALID_BLOCKS` at normalize or CI codegen-drift failure.
- **Cross-service contract:** a NEW bearer route + client + env flag + keyring entry; the
  client's `AbortSignal.timeout` must be strictly greater than the route's internal budget
  (outbound-timeout-shorter-than-caller-budget), and the route deploys before the flag.
- **Parity test:** editing the shared draft contract requires extending
  `packages/experience-schema/src/index.test.ts` in the same commit.
- **Append semantics:** the section path appends; the full-page path replaces; the `mode` flag
  keeps them from colliding and append never clobbers title/meta.
- **Unchanged invariants:** normalize resolution contract, staged-review reversibility, the
  playability gate, and `BlocksSchema` as the persistence boundary are reused; the bible-quote
  item is the deliberate schema change (text optional + structured fields).

---

## Risks & Dependencies

| Risk                                                               | Mitigation                                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Editing the moved draft schema drifts generator vs re-validator    | Extend the parity test (`index.test.ts`) in the same commit (N0)                 |
| Schema change spans 3 homes → `INVALID_BLOCKS` / codegen drift     | Ship N0+N1+N2 together; CI drift jobs gate N2                                    |
| Building in stale `apps/admin/src/mastra` (deleted at U10 cutover) | Build generator remote-first in `apps/mastra` (N5/N6)                            |
| Off-pack scripture or FAQ reaches publish                          | Admin-side post-response allowlist by structural identity (N7)                   |
| FAQ answers model-authored (R8 gap for answers)                    | Flag `needs_verification` in the review ledger (N7/N9); honestly not allowlisted |
| Client timeout ≤ route budget → retry storm                        | Client `AbortSignal.timeout` strictly > mastra `TIME_BUDGET_MS.section` (N7/N6)  |
| New bearer route 401s on first call                                | Deploy route before the caller flag (keyring-first, N6)                          |
| `BibleQuotesCarousel` is `"use client"` vs `server-only` resolver  | RSC server wrapper passes passages as prop (N10)                                 |
| Quiz with no real nextstep URL                                     | Quiz omitted unless configured (N5)                                              |
| Scene/transcript absent in env                                     | Pack degrades gracefully (N4)                                                    |

---

## Documentation / Operational Notes

- New env: `EXPERIENCE_AI_REMOTE_SECTION` (flag), `MASTRA_SECTION_TIMEOUT_MS` (admin),
  `TIME_BUDGET_MS.section` (mastra) — all `.optional()`/defaulted. New `/forge-experience-section`
  reuses `MASTRA_SERVICE_API_KEY`; deploy receiver-first.
- New LaunchDarkly flag `forge.experience.youVersionBibleQuotes` (default off).
- Update `apps/admin/CLAUDE.md` + `apps/mastra/CLAUDE.md` once landed; coordinate with the #1330
  consolidation plan (`docs/plans/2026-06-19-001-feat-mastra-admin-to-standalone-consolidation-plan.md`).
- Confirm prod coverage of `VideoStudyQuestion` + `BibleCitation` for anchor videos.

---

## Sources & References

- **Origin:** `docs/brainstorms/2026-06-22-video-anchored-experience-generation-requirements.md`
- Consolidation context: `docs/plans/2026-06-19-001-feat-mastra-admin-to-standalone-consolidation-plan.md`, PR #1330
- Key code: `packages/experience-schema/src/experience-ai.schemas.ts`,
  `apps/mastra/src/mastra/workflows/experience-draft-route.ts`,
  `apps/admin/src/services/mastra-experience-draft-client.ts`,
  `apps/admin/src/services/experience-ai/experience-ai-normalize.ts`,
  `apps/admin/src/domain/blocks.ts`, `apps/web/src/lib/youversion-passage.ts`
- Companion thread (not in scope): generation eval/telemetry; the 2026-06-15 structural-validity hardening.
