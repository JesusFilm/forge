---
date: 2026-05-04
updated: 2026-05-05
topic: admin-ai-experience-editorial-quality
---

# Admin AI Experience — Editorial Quality & Compliance Pass

## Problem Frame

`feat-107` (Admin AI Experience Drafting) shipped the end-to-end generation
flow: prompt → server action → catalog candidates → LLM → normalizer →
`BlocksSchema`-valid draft in editor state. The pipeline works, but two
gaps undercut the operator experience:

1. **Editorial quality is weak.** When an operator hits the Preview button
   on the dashboard (which opens the published `/<slug>/<locale>` page in
   `apps/web`), the rendered AI draft looks markedly less editorial than
   the curated Easter (`feat-029`) and Christmas (`feat-034`) experiences.
   The schema supports every block kind the editor exposes, yet generated
   pages tend toward flat sequences of `text` + `videoBlock` rather than
   the layered `videoHero` → themed `section` → nested
   `navigationCarousel` / `mediaCollection` / `bibleQuotesCarousel`
   composition that gives Easter and Christmas their feel.

2. **Rule compliance is unverified.** The plan (R1–R9 in
   `docs/plans/2026-04-23-002-feat-admin-ai-experience-drafting-plan.md`)
   defines safety and product invariants the generator must hold every
   time. Several of those invariants have unit-level coverage but no
   end-to-end guard, so silent regressions are possible — especially
   around ephemeral state (R5), empty-canvas-only (R4), and the
   provider posture (R7/R8).

Both gaps share a root cause: the prompt builder in
`apps/admin/src/services/experience-ai/experience-ai-prompts.ts` is the
primary place where editorial judgment is expressed, but it does not yet
carry the full "guided spiritual journey" discipline from the Christian
Experience agent brief. Every other lever (schema, normalizer, action)
was built carefully; the prompt needs to do more product-quality work
before introducing extra agents or a durable async pipeline.

The Christian Experience agent brief in
`apps/seed-studio/christian_experience_ai_agents.md` is useful as product
direction, but the full multi-agent workflow is too large for this pass.
Eight LLM calls, intermediate persisted state, progress UI, retry/resume,
and per-agent error handling would move the work into a new async
generation architecture. This brainstorm therefore adopts the best parts
immediately as prompt discipline, then defers richer input controls to a
second phase and durable background generation to future roadmap work.

## Requirements

### Editorial composition (visual quality)

- **R1.** Every successful generation must produce a draft that includes,
  at minimum, one `videoHero`-shaped opener, two or more `section`-level
  blocks, and at least one nested cross-block construct (a
  `navigationCarousel`, `mediaCollection`, or `videoCarousel`). A flat
  list of `text` + `videoBlock` only is a quality regression.
- **R2.** The system prompt must carry an explicit structural template
  for what a "good first draft" looks like, including ordering hints
  (hero opens, themed sections in the middle, a closer block such as
  `quizButton` or `cta`).
- **R3.** The system prompt must include at least one few-shot reference
  draft modelled on the editorial shape of the Easter / Christmas
  experiences (using the model-facing draft AST, not raw `BlocksSchema`).
- **R4.** Locale-aware copy guidance must be present in the system
  prompt: tone, voice, and length expectations appropriate to the
  requested experience locale. Copy length should not be uniform across
  block kinds (heroes get short headings; sections can carry richer
  prose).

### Presentation defaults (visual quality)

- **R5.** The normalizer must fill safe presentation defaults when the
  model omits optional fields that materially affect the rendered look:
  - `section.backgroundOpacity` when `dynamicBackgroundImage` is true
  - `videoHero.clipStartSeconds` / `clipEndSeconds` derived from a
    sensible default trim window
  - container slot `spans` for multi-slot layouts
  - `section.dynamicBackgroundImage` enabled when the section's first
    video-bearing slot has a `previewImageUrl`
- **R6.** Defaults must be data-derived where possible (e.g., use the
  candidate's actual `previewImageUrl` rather than a hardcoded asset)
  and must never inject fields the saved `BlocksSchema` rejects.

### Rule compliance verification (audit + regression guard)

- **R7.** Add an integration-level test that runs the full
  `generateDraftAction` path with a stubbed provider and asserts:
  - every `videoId` in the normalized output appears in the candidate
    set returned by `loadVideoCandidates` for that prompt + locale
    (plan R6: catalog-only)
  - every persisted streaming reference resolves through a `VideoDub`
    whose `language.bcp47 / iso3 / slug` matches the requested locale
    (plan R6: locale-matched dubs — see solution doc
    `docs/solutions/integration-issues/admin-ai-experience-preview-videodub-language-selection-20260501.md`)
  - the action does not call any service that writes to Prisma during
    generation (plan R5: ephemeral)
  - the normalized output passes `BlocksSchema.parse` (plan R3 / R9)
- **R8.** Add a UI-level test that confirms the empty-canvas guard:
  the AI entry point is hidden or disabled when the locale already has
  blocks (plan R4).
- **R9.** Server-side, every successful generation must emit a single
  structured "rule witness" log line listing which invariants the
  service explicitly satisfied (provider used, candidate count, locale
  match status, normalize success, schema parse success). The log
  format must be greppable in Railway and must not include user prompt
  text or candidate metadata that would amount to PII / catalog leak.

### Phase A — prompt-only journey discipline

- **R10.** Phase A must improve generation quality without changing the
  authoring UI, request shape, database model, provider call count, or
  background execution model.
- **R11.** The system prompt must require the model to frame the draft as
  a guided spiritual journey before composing blocks. The default journey
  should move through a coherent arc such as struggle → biblical truth →
  story/video connection → reflection → response, while still adapting to
  the operator's prompt.
- **R12.** Every section in the generated draft must have a clear purpose
  in the journey. A section that only repeats the theme or holds a
  keyword-matched video without advancing the experience is a quality
  regression.
- **R13.** Video selection guidance must prioritize story fit above raw
  keyword overlap. Candidate videos should be chosen because they support
  the section purpose, fit the audience's emotional state, and move the
  draft forward.
- **R14.** Pastoral guardrails must be explicit in the prompt: avoid
  prosperity-gospel language, shallow clichés, invented Bible quotations,
  and scripture references unless the model is confident about the
  chapter and verse.
- **R15.** The draft must close with one clear invitation to respond, not
  a stack of competing CTAs. Valid invitations include pray, reflect,
  watch, read more, contact, or join, selected according to the prompt.

### Phase B — structured generation intent

- **R16.** Phase B may add structured input fields to the existing
  Generate with AI surface so an operator can steer audience,
  emotion/problem, purpose, tone, preferred CTA, and target language
  without writing all of that into one free-text prompt.
- **R17.** Structured fields must compile into a server-owned generation
  brief consumed by the prompt builder. Empty fields should be omitted,
  not filled with generic defaults that make the output feel less
  intentional.
- **R18.** The original free-text prompt remains the primary input.
  Structured fields refine the prompt; they do not replace it or create a
  multi-step wizard.
- **R19.** Phase B must keep generation as one provider call unless a
  separate background-job phase has already landed. Review Agent,
  critique/regenerate loops, and visible per-agent progress are out of
  scope for Phase B.

## Success Criteria

- Phase A produces visibly more journey-shaped drafts from the same
  single prompt flow, without increasing provider latency/cost beyond the
  existing one-call path.
- A blind test of three operator prompts ("Easter for teens",
  "Christmas family devotional", "What is forgiveness?") returns drafts
  that, on visual review against the existing Easter / Christmas pages,
  read as comparably editorial: hero present, multiple themed sections,
  at least one cross-block carousel, locale-matched copy.
- For the same blind prompts, video placement reads as story-driven:
  videos support the purpose of their sections rather than appearing as a
  topical search-result list.
- Phase B lets operators steer audience, emotional problem, tone, purpose,
  CTA, and language more reliably than the textarea-only flow while still
  returning an editable admin draft through the existing editor.
- The compliance test in R7 runs in CI and is a hard gate on the next
  PR that touches the AI generation path.
- The empty-canvas guard test in R8 prevents regressions where the AI
  entry point appears on a non-empty draft.
- The rule witness log in R9 is visible in Railway logs and can be
  filtered by experience id and locale.

## Scope Boundaries

- No changes to the canonical saved `BlocksSchema` in
  `apps/admin/src/domain/blocks.ts`.
- No new embedding or semantic-ranking pipeline for candidate
  retrieval. Lexical / topical ranking from the current admin video
  catalog stays.
- No AI behavior on a non-empty canvas. Merge / append / rewrite are
  v2 work.
- No slug or path mutation by AI.
- No client-side provider calls. Provider remains server-only.
- No Seed Studio runtime cross-import.
- No general-purpose chat UX in admin. This is still one-shot
  generation, not conversational editing.
- No new image asset upload or generation. Default presentation fields
  reuse existing catalog imagery only.
- Phase A does not add structured input fields, another provider call,
  review/regenerate loops, background jobs, progress tracking, or
  persisted intermediate agent state.
- Phase B does not add Review Agent, multi-agent orchestration,
  progress UI, retry/resume semantics, auto-save, or auto-publish.
- Durable async generation is a future phase because it requires a
  persisted job/proposal model and list-level progress, especially if
  generation grows beyond one provider call.

## Key Decisions

- **Do not fold the full Christian multi-agent workflow into the current
  quality pass.** The agent brief is strategically right, but the full
  version changes runtime architecture. The immediate adoption path is to
  encode its core product discipline into the existing Admin AI prompt,
  then evaluate whether richer input controls or async orchestration are
  justified.
- **Keep normalizer defaults and compliance tests as the broader
  editorial-quality backlog, not prerequisites for Phase A.** They remain
  valid requirements for making the generator production-harder, but the
  Christian journey improvement can land as a smaller prompt-only slice
  first.
- **Treat the system prompt as the primary visual lever.** The schema
  already supports every block kind. The bottleneck is editorial
  bias, which is best expressed in the prompt, not in tighter Zod
  constraints.
- **Treat the normalizer as the secondary visual lever, with a strict
  "fill, never override" rule.** Defaults only land on optional fields
  the model omitted; the model's explicit choices stay authoritative.
- **Compliance tests at the action boundary, not the service
  boundary.** R7's invariants describe end-to-end behavior; testing
  them at the service level alone misses the action layer's
  responsibility for never writing to Prisma during generation.
- **Phase A is prompt-only.** The fastest low-risk improvement is to
  encode the "spiritual journey, section purpose, pastoral guardrails,
  story-fit video selection, single CTA" discipline into the existing
  prompt builder. This should improve output quality without changing
  product flow, latency, persistence, or data contracts.
- **Phase B is structured intent capture, not multi-agent generation.**
  Audience, emotion/problem, purpose, tone, CTA, and target language are
  useful operator controls, but they change the authoring UX and action
  input shape. They belong in a follow-up PR after prompt-only quality is
  proven.
- **Review Agent waits for durable async generation.** A second LLM call
  can add 15–25 seconds and introduces retry/failure behavior. If review,
  critique/regenerate, or full multi-agent orchestration is added, it
  should ride on a background job/progress model rather than blocking the
  editor page.

## Dependencies / Assumptions

- The existing locale-aware dub matching in `experience-ai.service.ts`
  (per the 1-May solution doc) is in place and stays in place.
- Catalog candidate retrieval continues to return at least 4–6
  candidates for typical prompts, which is the floor needed to
  populate one `videoHero` plus a handful of section-level video
  references.
- The empty-canvas guard logic in `experience-editor.tsx` continues
  to be the single source of truth for hiding the AI entry point.
- No provider account / billing changes are required; this work fits
  within current OpenRouter / OpenAI usage.
- Phase A assumes the existing prompt builder can be extended without
  widening the action payload.
- Phase B assumes the editor's Generate with AI surface has enough room
  for compact optional controls without turning into a wizard.

## Outstanding Questions

### Resolve Before Planning

_(none — the brainstorm settled scope, levers, and boundaries.)_

### Deferred to Planning

- [Affects R3][Technical] What is the smallest few-shot example that
  carries the editorial shape without bloating the prompt context?
  Probably a truncated AST mirroring the Christmas seed's first
  `videoHero` + first `section` only.
- [Affects R5][Technical] Which presentation defaults are best
  expressed as constants in the normalizer vs derived from candidate
  metadata? The normalizer's existing test surface should make this
  evident during planning.
- [Affects R7][Needs research] What is the cheapest stub provider
  shape for the integration test — a hand-written fixture, or a
  recorded real-provider response? Either works; planning should pick
  based on test runtime cost.
- [Affects R9][Technical] What is the canonical log shape elsewhere
  in admin (e.g., the embedding-backfill workflow) so the rule
  witness log matches existing Railway log conventions?
- [Affects R16-R18][Design] What is the smallest structured input UI
  that improves operator control without making Generate with AI feel
  like a form-heavy CMS workflow?
- [Affects R19][Technical] If a later phase adds Review Agent or
  multi-agent orchestration, should completed output land as an AI
  proposal requiring explicit apply, or as a draft revision in the
  editor?

## Next Steps

→ `/ce:plan` for structured implementation planning
