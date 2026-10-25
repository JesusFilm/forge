---
date: 2026-05-11
topic: admin-ai-chat-quality-first-generation
status: ready-for-planning
owner: ekkasit
predecessor: docs/brainstorms/2026-05-08-admin-experience-ai-chat-panel-requirements.md
roadmap: docs/roadmap/platform/feat-162-admin-ai-chat-quality-first-generation.md
---

# Admin AI Chat — Quality-First Generation

## Summary

Extend the existing Admin Experience AI Chat with a quality-first full-create mode: when an editor starts from an empty canvas, AI Chat should first guide them through an adaptive brainstorm, confirm an editorial brief, and only then generate a draft Experience through a free OpenRouter-backed provider path.

---

## Problem Frame

The existing AI Chat requirements establish a persistent conversational panel that can create, refine, and mutate an Experience. That is enough to make generation possible, but not enough to make generated Christian content feel ready for real editorial use.

The gap is not that generation is broken. The gap is quality: a short prompt can produce a draft that looks like AI output rather than a grounded, editorially useful Experience. For Christian content, "usable" means more than fluent copy. The result must be guided by a clear audience and outcome, shaped into a coherent page journey, natural in the target language, faithful to Scripture, ecumenically appropriate, and reviewable by an editor before it becomes public-facing content.

The attached content creator agent kit provides the domain logic for this quality bar: Scripture-first research, ecumenical guardrails, Thai and English editorial guidance, page structure patterns, theology review, final editing, and reference tracking. This brainstorm captures how that kit should shape the Admin AI Chat experience without turning every small refinement turn into a slow research workflow.

---

## Actors

- A1. Editor: Uses the Admin Experience editor and AI Chat to create or refine an Experience.
- A2. AI Chat assistant: Guides the editor, asks clarifying questions, drafts content, and reports reviewable references.
- A3. Reviewer: Checks generated content quality, Scripture grounding, and references before publication. This may be the same human as A1.

---

## Key Flows

- F1. Full-create from an empty canvas
  - **Trigger:** The editor asks AI Chat to create, generate, build, or start an Experience while the canvas has no blocks.
  - **Actors:** A1, A2
  - **Steps:** AI Chat identifies that this is a full-create request, enters adaptive brainstorm mode, asks only the questions needed to complete the editorial brief, summarizes the brief, and waits for explicit editor confirmation before drafting.
  - **Outcome:** The editor sees a confirmed creative direction before any draft content is generated or applied.
  - **Covered by:** R1, R2, R3, R4

- F2. Draft generation after brief confirmation
  - **Trigger:** The editor confirms the summarized editorial brief and asks AI Chat to generate the draft.
  - **Actors:** A1, A2
  - **Steps:** AI Chat uses the content creator kit logic to generate page content, returns an editable draft preview for the Experience canvas, and keeps research notes and a reference ledger available for review.
  - **Outcome:** The editor can apply usable page content to the canvas while keeping review evidence separate from public page content.
  - **Covered by:** R5, R6, R7, R8

- F3. Fast refinement on an existing canvas
  - **Trigger:** The editor asks AI Chat to adjust an Experience that already has content.
  - **Actors:** A1, A2
  - **Steps:** AI Chat treats the turn as an edit/refinement unless the editor explicitly requests a full re-brief or regeneration flow.
  - **Outcome:** Everyday edits remain fast and conversational rather than forcing the heavy quality workflow on every turn.
  - **Covered by:** R9, R10

---

## Requirements

**Full-create gating**

- R1. When the active Experience canvas is empty and the editor asks AI Chat to create, generate, build, start, compose, or design an Experience, AI Chat must enter guided brainstorm mode instead of immediately generating a full draft.
- R2. Guided brainstorm mode must be adaptive: AI Chat asks follow-up questions only until it has enough information to form an editorial brief, rather than forcing a fixed long questionnaire.
- R3. AI Chat must ask one clear question at a time during guided brainstorm mode so the editor can answer naturally without being overwhelmed.
- R4. AI Chat must summarize the proposed editorial brief and wait for explicit editor confirmation before starting draft generation from zero.

**Editorial brief**

- R5. The minimum confirmed brief for full-create generation must cover topic or passage, language, audience, desired outcome, tone, page type, Scripture emphasis, and CTA or next step.
- R6. If the editor already provides one or more brief fields in the opening prompt, AI Chat should preserve those answers and ask only for the missing or ambiguous fields.
- R7. If the editor cannot answer a field with certainty, AI Chat may record a reasonable assumption in the brief, but the assumption must be visible in the confirmation summary before generation.

**Quality-first content generation**

- R8. Full-create generation must use the content creator kit as domain guidance for Scripture-first content, ecumenical Christian boundaries, Thai and English editorial style, page journey structure, theology review, reference tracking, and final polish.
- R9. Full-create output applied to the canvas should be limited to public page content: title, metadata, blocks, and optional image direction or image selection. Research notes and the reference ledger must remain available for admin/editor review, not inserted into the public page by default.
- R10. The generated Experience must feel like a coherent editorial journey, not a pile of independent blocks. The draft should have a clear opening, teaching or media modules, Scripture grounding, and an appropriate next step.
- R11. Generated Thai and English copy must be natural in the target language, avoiding translationese and generic AI phrasing where the kit provides stronger voice guidance.
- R12. Generated Christian teaching must stay within ecumenical, Scripture-faithful boundaries and avoid unsupported or denominationally narrow claims unless the editor explicitly scopes such a perspective.

**Provider and model behavior**

- R13. New full-create generation must use OpenRouter free-tier models instead of Codex as the generation provider.
- R14. The provider strategy for v1 must use a pinned free-model list first, with `openrouter/free` as fallback when the pinned free models are unavailable, rate-limited, or fail validation.
- R15. The exact pinned free model names are not a product decision and should be chosen during planning/implementation based on current OpenRouter availability and quality tests.
- R16. If all free provider attempts fail, AI Chat must fail visibly and preserve the confirmed brief so the editor can retry without restarting the brainstorm.

**Hybrid chat behavior**

- R17. Existing edit/refine turns on a populated canvas must remain lightweight and fast by default. AI Chat should not run the full brainstorm/research/review workflow for every small copy or block adjustment.
- R18. Editors must be able to intentionally ask for a re-brief, a full regeneration, or a deeper quality pass when they want the heavier workflow on an existing canvas.
- R19. The existing AI Chat authority rules remain in force: chat-generated mutations may update the editable content surface, but slug changes remain forbidden and cross-locale changes require explicit confirmation.

---

## Acceptance Examples

- AE1. **Covers R1, R4, R5.** Given an empty Experience canvas, when the editor types "Create a Thai page about Matthew 11:28-30 for young adults," AI Chat asks for the missing brief fields instead of generating blocks immediately, then summarizes the brief and waits for confirmation.
- AE2. **Covers R6.** Given the editor's opening prompt already includes language, audience, passage, and desired outcome, when guided brainstorm mode starts, AI Chat asks only about the missing tone, page type, Scripture emphasis, or CTA rather than repeating known answers.
- AE3. **Covers R7.** Given the editor is unsure about the CTA, when AI Chat proposes "next step: invite readers to pray and continue with a short Bible study" as an assumption, that assumption appears in the brief summary before generation.
- AE4. **Covers R8, R9, R10.** Given a confirmed brief, when the editor asks AI Chat to generate the draft, the returned preview contains public page content for the canvas and keeps the reference ledger in the admin review/chat context rather than adding a public "References" section.
- AE5. **Covers R13, R14, R16.** Given the first pinned OpenRouter free model is rate-limited, when generation starts, AI Chat tries the next pinned free model or `openrouter/free`; if all fail, it shows a retryable failure and keeps the confirmed brief.
- AE6. **Covers R17, R18.** Given a populated canvas, when the editor asks "make the hero warmer," AI Chat performs a focused edit; when the editor asks "re-brief this page from scratch," AI Chat may enter the heavier guided workflow.

---

## Success Criteria

- Editors starting from zero feel guided toward a clear content idea before any blocks are generated.
- Generated drafts are more usable for real editorial review: grounded, coherent, natural in the target language, and shaped like an Experience page.
- Reviewers can inspect research notes and a reference ledger without exposing those notes on the public Experience page.
- The implementation plan can separate full-create quality workflow from lightweight refinement, preventing the feature from becoming slow for ordinary edits.
- Provider planning has a clear constraint: OpenRouter free-tier first, with pinned free models preferred before fallback routing.

---

## Scope Boundaries

- Paid OpenRouter models, OpenAI models, or Codex as the primary generation provider for this v1 full-create path.
- A new standalone product or workflow outside the existing Admin AI Chat surface.
- Public reference or citation UI on the generated Experience page.
- Heavy Scripture/research/theology workflow on every minor edit/refine turn.
- Auto-generating a full draft from an empty canvas without a confirmed brief.
- Voice input, multi-user collaborative brainstorming, or public-facing AI generation.
- A universal LLM steering system shared across every AI workflow. This feature can inform that future platform work, but it should not wait for it.

---

## Key Decisions

- Guided brainstorm before zero-state generation: A short prompt is not enough to consistently produce usable Christian editorial content. The brief-confirmation step creates a deliberate quality gate.
- Hybrid workflow over one universal workflow: Full-create needs more care; small refinements need speed. Treating both as the same workflow would make everyday editing feel heavy.
- Public content and review evidence stay separate: The canvas receives the Experience content, while research notes and references remain in admin/editor context for review.
- Use the content creator kit as domain guidance, not as a separate product: The kit should strengthen AI Chat's generation behavior without replacing the existing editor flow.
- OpenRouter free-tier is the v1 provider constraint: Cost is part of the product shape for this iteration, so the requirements accept free-model variability and require graceful fallback/failure behavior.

---

## Dependencies / Assumptions

- The existing Admin AI Chat panel, thread persistence, mutation preview/apply behavior, undo, slug guard, and cross-locale confirmation remain the foundation for this work.
- The content creator agent kit is the source of domain rules for Scripture-first workflow, ecumenical theology, multilingual editorial style, page structure, review, and references.
- OpenRouter free model availability can change, so planning must choose and validate the pinned free model list close to implementation time.
- Full-create draft quality may be limited by free-model capability; validation, retry, and editor review remain necessary.

---

## Outstanding Questions

### Resolve Before Planning

- None. The product scope is ready for planning.

### Deferred to Planning

- [Affects R8][Technical] Where should research notes and the reference ledger live in the existing chat/admin review surface so they are durable, inspectable, and not public by default?
- [Affects R13, R14][Needs research] Which currently available OpenRouter `:free` model IDs should be pinned first for Thai/English Christian content quality?
- [Affects R14, R16][Technical] What validation gates should decide whether a free-model response is acceptable, retried with another model, or surfaced as a failure?
- [Affects R17, R18][Technical] What classifier or routing rule distinguishes zero-state full-create, populated-canvas refinement, and explicit re-brief requests?
