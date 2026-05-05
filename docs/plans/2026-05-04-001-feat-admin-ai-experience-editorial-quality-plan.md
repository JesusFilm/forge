---
title: "feat: Admin AI Experience editorial quality + compliance pass"
type: feat
status: active
date: 2026-05-04
origin: docs/brainstorms/2026-05-04-admin-ai-experience-editorial-quality-requirements.md
---

# Admin AI Experience — Editorial Quality + Compliance Pass

## Overview

`feat-107` shipped the Admin AI Experience drafting pipeline end to end:
prompt → server action → catalog candidates → LLM → normalizer →
`BlocksSchema`-valid draft in editor state. The pipeline is correct,
but two gaps now block it from feeling like a v1 worth handing to
operators:

1. **Visual quality** — Generated drafts, when previewed via the
   dashboard's Preview button (which opens the public watch page in
   `apps/web`), read as much flatter than the curated Easter
   (`feat-029`) and Christmas (`feat-034`) experiences. The schema
   already supports every block kind the editor exposes, so the gap
   is editorial composition, not capability.

2. **Rule compliance** — The plan defines R1–R9 invariants the
   generator must hold every time. Several are unit-covered, but
   there is no end-to-end guardrail against silent regressions in
   ephemeral state (R5), the empty-canvas-only contract (R4), the
   provider posture (R7), or the locale-matched dub contract that
   the 1-May fix introduced.

Both gaps share a root cause: the system prompt in
`apps/admin/src/services/experience-ai/experience-ai.service.ts:339`
is a single thin paragraph with no structural template, no editorial
bias, no minimum block diversity, and no in-prompt restatement of
the invariants. Schema, normalizer, and action layers were built
carefully; the prompt is doing almost none of the heavy lifting.

This plan closes both gaps in one PR via three coupled levers:

- **Lever A (Editorial system prompt)** — restructure the prompt
  with an editorial template, locale-aware copy guidance, and a
  small structurally-rich few-shot example modelled on the Christmas
  seed (shape only, theme-agnostic). Add a soft floor on block
  diversity at both Zod and provider-JSON-schema boundaries so they
  stay aligned.
- **Lever B (Normalizer presentation defaults)** — fill safe defaults
  on optional fields the model omits, derived from candidate metadata
  where appropriate, never overriding explicit model choices.
- **Lever C (Compliance invariant tests + rule witness log)** — add
  an end-to-end action test asserting catalog-only refs, locale-matched
  dubs, no Prisma writes, and `BlocksSchema` parse; add an
  empty-canvas guard test on the editor; emit a structured
  rule-witness log per generation so Railway has a greppable trail.

Origin requirements: see
`docs/brainstorms/2026-05-04-admin-ai-experience-editorial-quality-requirements.md`.

## Problem Statement / Motivation

The first operator preview of an AI-drafted experience looks unfinished
next to anything the team has hand-built. Operators quickly conclude
that AI drafting is "for skeletons only," which undercuts the whole
premise of `feat-107`. At the same time, the only thing keeping the
generator inside its R1–R9 contract today is unit-level coverage on
the normalizer, the schemas, and the candidate retrieval layer —
nothing exercises the end-to-end action under realistic conditions.
A regression in the action layer (e.g., an inadvertent Prisma write,
a UI guard removed during refactoring, a reordered provider stack
that activates Codex in production) would land silently.

## Proposed Solution

Three levers, one PR. The prompt change is the headline visual win;
the normalizer change is the safety net for fields the model still
forgets; the compliance work pins the invariants for everything the
team will land after this.

### Lever A — Editorial system prompt + aligned schema floor

Replace the thin prompt in
`apps/admin/src/services/experience-ai/experience-ai.service.ts` with
a builder that emits:

- A short editorial brief: tone, voice, and length expectations
  appropriate to the requested experience locale.
- A structural template:
  - Open with a `videoHero`-shaped block.
  - Follow with 2–4 `section`-level blocks, each preferably wrapping
    a `navigationCarousel`, `mediaCollection`, `videoCarousel`, or
    a `container` with mixed slot content.
  - Close with a `quizButton` or `cta` if the prompt invites
    reflection or response.
- A single truncated few-shot example modelled on the Christmas seed
  shape (videoHero + 1 section with navigationCarousel + 1 section
  with mediaCollection), explicitly labelled "shape, not theme".
- An explicit list of invariants the model must respect:
  - only the provided candidate refs may appear in `candidateRef`
  - section refs (`s01`, `s02`, …) only target `section` blocks the
    draft itself emits
  - copy must be in the requested locale
  - schema-strict JSON; no markdown fences

Bump the **soft floor** on block diversity at both ends so the Zod
and provider JSON schema stay aligned (per the LLM structured-output
learning at
`docs/solutions/best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md`):

- `DraftExperienceSchema.blocks` → `.min(2)` (was `.min(1)`)
- Provider JSON schema `blocks.minItems` → `2`

The floor stays at 2 (not 3+) so well-prompted simple drafts stay
valid; the visual lift comes from the structural template, not from
forcing length.

Resolved deferred question (origin): the few-shot is the smallest
slice of the Christmas seed that demonstrates the layered shape
without adding theme-specific copy. The "shape only" caveat keeps
unrelated prompts from inheriting Christmas tone.

### Lever B — Normalizer presentation defaults

Extend `apps/admin/src/services/experience-ai/experience-ai-normalize.ts`
to fill safe defaults on optional fields. Strict rule: **fill, never
override**. If the model emitted `false` explicitly, that stands; only
truly omitted fields receive defaults. This means the draft schemas
stay free of Zod `.default(...)` so the normalizer can distinguish
"explicit false" from "undefined".

Concrete defaults:

- `videoHero.clipStartSeconds` defaults to `0` and
  `clipEndSeconds` defaults to `8` when both are omitted (gives the
  hero a usable trimmed window without committing to specific
  candidate runtime).
- `container.slots[].spans` defaults to a balanced layout based on
  slot count: 1 slot → no spans needed; 2 slots → `{ md: 6, md: 6 }`;
  3 slots → `{ md: 4, md: 4, md: 4 }`; 4 slots → `{ md: 3, … }`.
- `section.dynamicBackgroundImage` is set to `true` only when the
  section's first video-bearing nested block resolves to a candidate
  whose `previewImageUrl` is non-null, AND the model did not emit
  the field. If `previewImageUrl` is missing, leave it false.
- `section.backgroundOpacity` defaults to a single project-wide
  constant (e.g., `0.65`) when `dynamicBackgroundImage` ends up true
  and the field is absent. No data-derived choice — overlays are a
  brand decision.

Add unit tests covering each default rule plus a "model emitted
explicit false" case to confirm overrides do not happen.

Resolved deferred question (origin): defaults that depend on
candidate metadata (`dynamicBackgroundImage`, the chosen image
asset) are derived; opacity, hero clip windows, and slot spans are
constants in the normalizer so brand/style changes are a single-line
edit later.

### Lever C — Compliance invariant tests + rule witness log

#### C.1 Action-level integration test

Extend
`apps/admin/src/app/dashboard/experiences/generate-draft-action.test.ts`
with a happy-path test using a stub provider that returns a hand-
written draft fixture mirroring the Lever A shape. Assertions:

- Every `videoId` referenced in the normalized output appears in the
  candidate set returned by `loadVideoCandidates` for the test's
  prompt + locale (R6: catalog-only).
- For every block that persists a `streamingUrl`, the URL equals one
  of the candidate's `previewStreamUrl` values, which by construction
  came from a `VideoDub` whose language matches the requested locale
  (R6: locale-matched dubs — see solution doc
  `docs/solutions/integration-issues/admin-ai-experience-preview-videodub-language-selection-20260501.md`).
- Spies on every Prisma write entry point that the action could
  conceivably touch — `experienceLocale.update`, `experience.update`,
  `contentRevision.create`, `contentRevision.update`,
  `experienceLocale.upsert` — show zero invocations after the action
  resolves with `{ ok: true, draft }` (R5: ephemeral).
- `BlocksSchema.safeParse(result.draft.blocks).success` is `true`
  (R3 / R9).

Resolved deferred question (origin): the stub provider is a
hand-written fixture for legibility and runtime cost. Recorded
provider responses are unnecessary at this layer — provider-specific
behavior is already covered in the service-level tests.

#### C.2 Server-side empty-canvas guard

Today the empty-canvas guard lives only on the client
(`experience-editor.tsx` hides the AI entry point when
`parsedBlocks.length > 0`). A malicious or out-of-date client could
call the action with a non-empty locale. Add a server-side check at
the top of `runGenerateDraftAction` (in
`apps/admin/src/app/dashboard/experiences/generate-draft-action.ts`):
read the locale's persisted blocks, and if the saved canonical is
non-empty AND no DRAFT revision is present, return a typed
`{ ok: false, code: "CANVAS_NOT_EMPTY", message: "..." }`. Cover with
a unit test in `generate-draft-action.test.ts`.

Note: a DRAFT revision with non-empty content also blocks the action.
Implementation must compare the operator's working state, not just
the canonical row.

#### C.3 UI-level empty-canvas guard test

Extend
`apps/admin/src/app/dashboard/experiences/experience-editor.test.tsx`
with a case that renders the editor with a non-empty `parsedBlocks`
prop and asserts the AI entry point is not present. This is a
regression guard against UI refactors that accidentally remove the
visual hide rule.

#### C.4 Rule-witness log

Mirror the existing structured log shape used by admin workflows
(see `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts:364`).
After a successful generation in
`generateExperienceAiDraft`, emit:

```ts
console.log(
  JSON.stringify({
    service: "experience-ai",
    event: "draft_generated",
    experienceId,
    locale,
    providerKind, // "openrouter" | "openai" | "codex"
    candidateCount,
    blockCount,
    rulesSatisfied: {
      catalogOnly: true,
      localeMatchedDubs: true,
      blocksSchemaParsed: true,
      ephemeralAction: true,
    },
    durationMs,
  }),
)
```

Constraints: the log MUST NOT include the operator's prompt text or
candidate metadata (titles, descriptions, URLs). The point is a
greppable invariant trail in Railway, not a content trace.

Resolved deferred question (origin): the log shape mirrors the
admin workflow convention exactly so existing log tooling and
parsing rules continue to work.

#### C.5 Provider posture clarification (R7)

The current `pickProvider()` falls through to a `codex` CLI
invocation when neither `OPENROUTER_API_KEY` nor `OPENAI_API_KEY` is
set. R7 specified "OpenRouter first, OpenAI fallback, no new SDK
requirement" — Codex was not part of that posture. The pragmatic
resolution: keep Codex as an explicit local-development fallback,
gated by env. Add `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK` (default
`false` in production env validation) and short-circuit
`pickProvider` to return `null` (which surfaces as `NOT_CONFIGURED`)
when neither API key is set and the gate is off. Cover with a unit
test in `experience-ai.service.test.ts`.

This avoids a deployment-time surprise where an env misconfiguration
on Railway silently spawns a CLI process at request time.

## Technical Considerations

- **Prompt size.** The few-shot example must stay small (well under
  1 KB serialized) so token cost per generation does not balloon.
  Truncate aggressively: omit nested ctas and meta fields not needed
  to communicate shape.
- **Schema alignment.** Both Zod (`DraftExperienceSchema.blocks`)
  and the JSON schema sent to OpenRouter / OpenAI must update
  together. The learning at
  `docs/solutions/best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md`
  is explicit: misaligned bounds produce intermittent
  `SCHEMA_MISMATCH` under load. The plan keeps both at
  `minItems: 2` / `.min(2)`.
- **`fill, never override` requires schema honesty.** Existing draft
  schemas use `.default(...)` on a few fields. Where Lever B needs
  to distinguish "omitted" from "explicit false," remove those
  `.default(...)` calls and let the normalizer be the single point
  of default-fill. Cover the change with tests so it cannot drift.
- **Locale-matched dub contract is load-bearing.** The service code
  at `experience-ai.service.ts:593` already filters dubs to the
  requested locale. Lever C.1 proves that contract holds end to end
  when the action returns a draft. Do not weaken it.
- **Codex fallback is deliberate dev convenience.** Removing it
  entirely would break local development for anyone without an
  OpenRouter or OpenAI key. The env gate keeps the feature available
  but defaults safe for prod.

## System-Wide Impact

- **Interaction graph.** `runGenerateDraftAction` calls
  `generateExperienceAiDraft` (service) → `loadVideoCandidates` →
  `pickProvider` → provider HTTP/CLI → `parseProviderDraftContent`
  → `DraftExperienceSchema.safeParse` → `normalizeExperienceDraft` →
  `BlocksSchema.safeParse`. No callbacks, no middleware, no observers
  in this chain — failure modes are all visible at the action's
  return value. The new server-side empty-canvas guard sits at the
  top of this chain and queries `experienceLocale.findUnique` plus a
  DRAFT-revision lookup before the rest of the pipeline runs.
- **Error propagation.** Existing
  `ExperienceAiGenerationError` codes (`NOT_CONFIGURED`,
  `UPSTREAM_ERROR`, `SCHEMA_MISMATCH`, etc.) cover provider failure.
  Add `CANVAS_NOT_EMPTY` as a new typed code at the action layer
  (not the service) since the guard is action-level. Map it to a
  user-facing message in the existing `USER_MESSAGES` record.
- **State lifecycle risks.** The action remains read-only by
  design. Lever C.1 makes that an enforced invariant rather than a
  convention. No new persistence is introduced by this plan.
- **API surface parity.** The action is the only entry point for AI
  drafting. No GraphQL mutation, no REST endpoint, no alternative
  workflow exposes this surface, so the empty-canvas guard does not
  need to be replicated.
- **Integration test scenarios.**
  1. Empty canvas, valid candidates → success, all invariants log
     true.
  2. Non-empty canvas → action returns
     `{ ok: false, code: "CANVAS_NOT_EMPTY" }` without invoking the
     provider.
  3. Provider returns a draft that references a `candidateRef` not
     in the candidate set → normalizer rejects with typed error,
     action returns a mapped failure code, no Prisma write.
  4. Provider returns a `streamingUrl` not present in any candidate
     → C.1 catches it (synthetic test only — production path can
     never produce this since the model never sees raw stream
     URLs).
  5. Empty-canvas guard race: locale was empty when UI rendered but
     a concurrent edit added a block before action ran → guard
     reads fresh state and returns `CANVAS_NOT_EMPTY` rather than
     overwriting.

## Acceptance Criteria

- [ ] System prompt builder includes structural template, locale
      guidance, and a single shape-only few-shot example.
- [ ] Both `DraftExperienceSchema.blocks.min(2)` and the provider
      JSON schema's `minItems: 2` are set; no other bounds drift.
- [ ] Normalizer fills hero clip seconds, container slot spans,
      section background opacity, and section dynamic background
      image when the model omitted them; never overrides explicit
      model choices.
- [ ] Action returns `{ ok: false, code: "CANVAS_NOT_EMPTY" }` for
      non-empty locales and never invokes the provider in that case.
- [ ] Action-level integration test asserts catalog-only refs,
      locale-matched stream URLs, zero Prisma writes, and
      `BlocksSchema.safeParse` success.
- [ ] UI test asserts the AI entry point is hidden when
      `parsedBlocks.length > 0`.
- [ ] Successful generations emit a single
      `service: "experience-ai", event: "draft_generated"` JSON log
      line with no operator prompt or candidate metadata.
- [ ] `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK` env (default false) gates
      Codex CLI fallback; tests cover both gate states.
- [ ] All existing tests still pass.
- [ ] `pnpm --filter @forge/admin lint` passes.
- [ ] `pnpm --filter @forge/admin typecheck` passes.
- [ ] `pnpm --filter @forge/admin test` passes.
- [ ] Manual browser pass: three reference prompts ("Easter for
      teens", "Christmas family devotional", "What is forgiveness?")
      produce drafts that, on visual review of the published preview,
      include a hero, ≥2 sections, ≥1 cross-block carousel, and
      locale-matched copy.

## Success Metrics

- Visual: blind comparison of generated previews against curated
  Easter / Christmas pages across the three reference prompts —
  drafts read as comparably editorial (hero present, layered
  sections, ≥1 cross-block carousel).
- Compliance: action-level integration test is a CI gate; the rule
  witness log is greppable in Railway with the expected shape.
- Operational: zero new
  `experience-ai.service` warnings or unhandled errors during the
  three-prompt smoke test in browser.

## Implementation Units

- [x] **Unit 1: Editorial system prompt + schema floor**

  **Goal:** Replace the thin prompt with a structured editorial
  brief, structural template, locale guidance, and a shape-only
  few-shot example. Align Zod and provider JSON schema floors at 2
  blocks.

  **Requirements:** R1, R2, R3, R4 (origin doc)

  **Files:**
  - Modify
    `apps/admin/src/services/experience-ai/experience-ai.service.ts`
    (`buildExperienceAiMessages`, `buildCodexPrompt`,
    `buildDraftExperienceJsonSchema`).
  - Create
    `apps/admin/src/services/experience-ai/experience-ai-prompts.ts`
    (extract template, locale guidance, few-shot constant; pure
    string builder, no IO).
  - Modify
    `apps/admin/src/services/experience-ai/experience-ai.schemas.ts`
    (`DraftExperienceSchema.blocks.min(2)`).
  - Modify
    `apps/admin/src/services/experience-ai/experience-ai.service.test.ts`
    (assert prompt content includes structural directives + few-shot
    ref; update fixtures for `min(2)`).
  - Reference (read only): `apps/cms/src/bootstrap/seed-christmas.ts`
    for shape inspiration.

  **Approach:**
  - Move all string-building logic into the new
    `experience-ai-prompts.ts` module with named exports per piece
    (`SYSTEM_BRIEF`, `STRUCTURAL_TEMPLATE`, `FEW_SHOT_EXAMPLE`,
    `localeCopyGuidance(locale)`).
  - The few-shot is a frozen constant — write it by hand mirroring
    the Christmas seed's first videoHero + first section
    (navigationCarousel) + a second mediaCollection-bearing
    section. No theme-specific copy.
  - JSON schema builder bumps `minItems` to 2 in lockstep.

  **Test scenarios:**
  - Generated prompt for `locale: "en"` contains the structural
    template and the few-shot label "shape only".
  - Generated prompt for `locale: "es"` contains Spanish-specific
    copy guidance.
  - `DraftExperienceSchema` rejects a 1-block draft.
  - JSON schema includes `blocks.minItems: 2`.

  **Verification:**
  - `pnpm --filter @forge/admin test -- experience-ai.service`

  **Execution note:** Test-first. Write the prompt-content
  assertions before extracting the builder.

- [x] **Unit 2: Normalizer presentation defaults**

  **Goal:** Fill safe presentation defaults on optional fields the
  model omits; never override explicit model choices.

  **Requirements:** R5, R6 (origin doc)

  **Files:**
  - Modify
    `apps/admin/src/services/experience-ai/experience-ai-normalize.ts`
    (videoHero, container, section default-fill).
  - Modify
    `apps/admin/src/services/experience-ai/experience-ai-normalize.test.ts`
    (new cases per default rule + "explicit false survives").
  - Modify
    `apps/admin/src/services/experience-ai/experience-ai.schemas.ts`
    only if Zod `.default(...)` calls need to be removed to preserve
    the omitted-vs-false distinction.

  **Approach:**
  - For each block kind that gains a default, branch on
    `block.field === undefined` rather than `block.field ?? fallback`
    so explicit `false` stays `false`.
  - Hero clip windows: constants in a `HERO_DEFAULTS` record at the
    top of the file. Slot spans: lookup table by slot count.
    Section dynamic-bg: derive from candidate `previewImageUrl` of
    the section's first video-bearing nested block; opacity is the
    paired constant.

  **Patterns to follow:** existing `gridSpan: slot.gridSpan ?? 6`
  in `experience-ai-normalize.ts:400` (already in the right shape;
  extend the same defensive pattern).

  **Test scenarios:**
  - Hero with no clip seconds → normalized has 0 / 8.
  - Hero with `clipStartSeconds: 5` → normalized has 5, default
    end.
  - Section with video-bearing slot whose candidate has
    `previewImageUrl` → `dynamicBackgroundImage: true`,
    `backgroundOpacity: 0.65`.
  - Section with `dynamicBackgroundImage: false` explicit → stays
    false even when candidate image is present.
  - Container with 3 slots, no spans → spans default to balanced
    layout.
  - Container with 2 slots, one slot specifies spans, other does
    not → only the omitted slot fills.

  **Verification:**
  - `pnpm --filter @forge/admin test -- experience-ai-normalize`

  **Execution note:** Test-first per case to lock down the
  fill-never-override rule.

- [x] **Unit 3: Compliance invariant tests + rule-witness log + provider gate**

  **Goal:** Pin R1–R9 invariants with end-to-end tests, emit a
  structured rule-witness log per generation, and gate the Codex
  CLI fallback behind an explicit env flag.

  **Requirements:** R7, R8, R9 (origin doc) + parent feat-107 R4,
  R5, R6

  **Files:**
  - Modify
    `apps/admin/src/services/experience-ai/experience-ai.service.ts`
    (emit rule-witness log on success; gate codex fallback via
    new env).
  - Modify `apps/admin/src/config/env.ts`
    (`EXPERIENCE_AI_ALLOW_CODEX_FALLBACK: z.coerce.boolean().default(false)`).
  - Modify `apps/admin/.env.example` (document the new env).
  - Modify
    `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts`
    (server-side empty-canvas guard with `CANVAS_NOT_EMPTY` typed
    code).
  - Modify
    `apps/admin/src/app/dashboard/experiences/generate-draft-action.test.ts`
    (action-level integration test per C.1; non-empty-canvas guard
    case per C.2).
  - Modify
    `apps/admin/src/app/dashboard/experiences/experience-editor.test.tsx`
    (UI guard test per C.3).
  - Modify
    `apps/admin/src/services/experience-ai/experience-ai.service.test.ts`
    (codex gate test).

  **Approach:**
  - The integration test stubs the provider via a `vi.spyOn`
    against `experienceAiService.createStructuredDraft` (already
    re-exported for testing per `experience-ai.service.ts:872`)
    and feeds a hand-written fixture mirroring Lever A's shape.
  - Prisma write spies cover every method that could fire during
    the action: `experienceLocale.update`, `experienceLocale.upsert`,
    `experience.update`, `contentRevision.create`,
    `contentRevision.update`. Use a single shared mock factory.
  - Empty-canvas guard reads the locale's canonical blocks AND any
    DRAFT revision in a single Prisma call; non-empty in either
    is a guard hit. Returns
    `{ ok: false, code: "CANVAS_NOT_EMPTY", message: USER_MESSAGES.CANVAS_NOT_EMPTY }`
    without invoking the AI service.
  - Rule-witness log shape exactly mirrors
    `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts:364`
    (see C.4 for the field list). Emitted from
    `generateExperienceAiDraft` only on the success path.
  - Codex gate: `pickProvider` returns `null` (→ `NOT_CONFIGURED`)
    when neither API key is set and
    `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK !== true`.

  **Test scenarios:**
  - Happy path: action returns `{ ok: true, draft }`, every
    `videoId` and `streamingUrl` traces to the candidate set,
    Prisma write spies show zero calls, `BlocksSchema.safeParse`
    succeeds.
  - Non-empty canonical → guard returns `CANVAS_NOT_EMPTY`,
    provider stub never invoked.
  - DRAFT revision with non-empty content while canonical empty →
    guard still triggers.
  - UI test: editor with non-empty `parsedBlocks` does not render
    the AI entry point.
  - Codex gate off + no API key → `pickProvider` returns null,
    service returns `NOT_CONFIGURED`.
  - Codex gate on + no API key → `pickProvider` returns codex
    descriptor.
  - Rule-witness log: capture stdout in test harness, assert one
    `event: "draft_generated"` line per success, no
    `prompt` / `query` / candidate-metadata field present.

  **Verification:**
  - `pnpm --filter @forge/admin test -- generate-draft-action experience-editor experience-ai`

  **Execution note:** Test-first for guard and log; the env gate
  can land alongside its test in a single commit since it is a
  pure config change.

- [x] **Unit 4: Final validation + browser pass**

  **Goal:** Confirm the three-prompt browser smoke test produces
  visibly editorial drafts and that all CI gates remain green.

  **Requirements:** R1, R7, R8 (origin doc) + acceptance criteria

  **Files:**
  - No source changes unless validation surfaces a defect.

  **Approach:**
  - `pnpm --filter @forge/admin lint` + `typecheck` + `test`.
  - Local `pnpm --filter @forge/admin dev` (port 3003) with
    `OPENROUTER_API_KEY` set; create three empty experiences;
    generate against each prompt; click Preview; visually compare
    to Easter and Christmas published pages.
  - Capture before/after screenshots of one representative
    generated preview for the PR description.

  **Verification:**
  - All three prompts produce drafts with hero + ≥2 sections + ≥1
    cross-block carousel.
  - Rule-witness log lines visible in the dev server output for
    each successful generation.
  - No new console warnings or errors.

## Dependencies & Risks

**Dependencies:**

- Existing locale-matched dub logic in
  `experience-ai.service.ts:593` stays intact; the integration test
  in C.1 is the long-term guardrail.
- Catalog candidate retrieval continues to return ≥4 candidates for
  typical prompts; structural template asks for hero + sections,
  which needs at least one video per section in the demo set.
- Provider stack continues to support strict JSON schema responses
  (OpenRouter `response_format`, OpenAI `response_format`).

**Risks:**

- **Few-shot leakage.** A Christmas-shaped few-shot, even with the
  "shape only" caveat, may bleed into unrelated prompts. Mitigation:
  keep the few-shot small, use neutral copy in the example, and
  watch for tone drift in the three-prompt smoke test. If drift
  appears, swap the few-shot for an even more abstract structural
  skeleton.
- **Prompt token cost.** Adding ~1 KB of structural guidance + a
  few-shot raises per-call token cost on a public provider.
  Mitigation: the lift is bounded; admin AI generation is operator-
  triggered, not anonymous. Cost stays trivial relative to embed
  pipelines.
- **Schema floor regressions.** Bumping `min` from 1 to 2 risks
  `SCHEMA_MISMATCH` for prompts the model can only satisfy with one
  block. Mitigation: 2 is a soft floor; the structural template
  steers the model well above it. Watch the rule-witness log in
  the smoke test for a blockCount of 1 — none expected.
- **Empty-canvas guard race.** Concurrent edits between UI render
  and action submission could race. Mitigation: the server-side
  guard reads fresh Prisma state each call, so the worst case is a
  late `CANVAS_NOT_EMPTY` rather than an overwrite.
- **Codex gate breaking dev workflows.** Default `false` means
  developers without API keys lose AI generation locally.
  Mitigation: `.env.example` documents the gate; team lead
  communicates the change in the PR.
- **Rule-witness log noise.** Every successful generation emits one
  line. Mitigation: one line is the same cadence as the workflow
  logs already in production; no further sampling needed at v1.

## Sources & References

### Origin

- **Origin document:**
  [`docs/brainstorms/2026-05-04-admin-ai-experience-editorial-quality-requirements.md`](../brainstorms/2026-05-04-admin-ai-experience-editorial-quality-requirements.md)
  — key decisions carried forward: bundle three levers in one PR;
  treat the system prompt as the primary visual lever; test
  compliance at the action boundary; keep `BlocksSchema` unchanged.

### Internal references

- Parent feature plan:
  [`docs/plans/2026-04-23-002-feat-admin-ai-experience-drafting-plan.md`](2026-04-23-002-feat-admin-ai-experience-drafting-plan.md)
  — defines R1–R9 invariants this plan pins.
- Roadmap ticket:
  [`docs/roadmap/platform/feat-107-admin-ai-experience-drafting.md`](../roadmap/platform/feat-107-admin-ai-experience-drafting.md).
- Locale-match fix:
  [`docs/solutions/integration-issues/admin-ai-experience-preview-videodub-language-selection-20260501.md`](../solutions/integration-issues/admin-ai-experience-preview-videodub-language-selection-20260501.md).
- Structured-output pattern:
  [`docs/solutions/best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md`](../solutions/best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md)
  — schema-alignment rule (Zod ↔ provider JSON schema bounds) is
  load-bearing here.
- Editorial reference (shape, not theme):
  `apps/cms/src/bootstrap/seed-christmas.ts`,
  `apps/cms/src/bootstrap/seed-easter.ts`.
- Existing log convention:
  `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts:364`.
- Current AI service:
  `apps/admin/src/services/experience-ai/experience-ai.service.ts`.
- Current normalizer:
  `apps/admin/src/services/experience-ai/experience-ai-normalize.ts`.
- Current draft schemas:
  `apps/admin/src/services/experience-ai/experience-ai.schemas.ts`.
- Current action:
  `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts`.
- Editor empty-canvas UI:
  `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`.
- Admin app conventions: `apps/admin/CLAUDE.md`.

### Related work

- Related roadmap features: `feat-103` (editor refinement, parent
  dependency), `feat-101` (block editor parity), `feat-029`
  (Easter), `feat-034` (Christmas).
