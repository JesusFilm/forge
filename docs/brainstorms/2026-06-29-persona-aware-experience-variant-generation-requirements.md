---
date: 2026-06-29
topic: persona-aware-experience-variant-generation
---

# Persona-Aware Experience Variant Generation

## Summary

A persona-aware experience-variant generator: an editor picks a topic and a set of curated audience personas, and Mastra produces several well-composed, persona-tailored watch pages — same grounded facts, different framing, scripture, and questions — each scored for audience-fit and carrying a plain "how this lands" note. Personas live as a richer Mastra-owned library. v1 ships manual share-by-link; automatic audience-routing is designed-for but deferred.

---

## Problem Frame

JesusFilm editors today either hand-author an experience block by block, or use the existing video-anchored draft generator, which produces a single, generic page. But the same gospel topic lands very differently for a grieving skeptic, a new believer, a family with children, or a seasoned Christian. There is currently no way to tailor a page to who it's for — and no structured notion of "audience" anywhere in the system (verified: no persona/audience data model exists in schema or production today). An editor who wants to reach a specific audience must rewrite by hand and guess at how the message will land. The cost is generic content that under-serves the very people the ministry is trying to reach, plus editor time spent manually re-framing one topic for different readers.

---

## Shape at a glance

```mermaid
flowchart LR
  subgraph Mastra["Mastra — AI engine"]
    L[Persona library]
    G[Variant generation\nmulti-persona + critique]
    C[Persona-fit critique\n+ audience-fit risk labels]
  end
  subgraph Admin["Admin — caller + workbench"]
    T[Trigger: topic + personas]
    R[Review / edit / publish]
  end
  subgraph Web["Web — storefront"]
    P[Render variant pages]
    A[(later) Auto-route by signal]
  end
  T --> G --> C --> R
  L --> G
  R --> P
  P -. v1: share-by-link .-> Editor((Editor distributes link))
  P -. later .-> A
```

> _Directional shape for review, not implementation specification._

---

## Actors

- A1. **Content editor** (admin): picks a topic + a set of personas, reviews/edits the generated variants, publishes the ones they want, distributes links.
- A2. **Mastra generation engine**: owns the persona library, variant generation, and the persona-fit critique.
- A3. **Ministry / content lead**: defines and owns the persona roster (each audience's tone, needs, scripture posture, etc.).
- A4. **Watch-site visitor** (the "audience"): the seeker / grieving / new-believer person who lands on a variant page. Non-interactive in v1 — they receive a shared link; signal-based routing is a later phase.

---

## Key Flows

- F1. **Generate persona variants**
  - **Trigger:** editor picks a topic and selects a set of personas in admin.
  - **Actors:** A1, A2.
  - **Steps:** editor supplies topic + persona set → admin calls Mastra → Mastra generates one tailored experience per persona (shared grounding, divergent framing) → runs the persona-fit critique → returns the variants plus per-variant "how this lands" notes and audience-fit risk flags → admin validates the blocks and stages the variants.
  - **Outcome:** a grouped set of draft persona-variant pages, each with audience-fit notes, ready for editor review.
  - **Covered by:** R1, R2, R3, R5, R6, R11.

- F2. **Review, publish, and share**
  - **Trigger:** editor reviews the generated variants.
  - **Actors:** A1.
  - **Steps:** editor reads each variant + its audience-fit note → edits if needed → publishes the ones they want → each variant gets its own URL → editor shares the right link to the right channel.
  - **Outcome:** published persona pages, each with a shareable URL, grouped under one topic.
  - **Covered by:** R4, R7, R8, R12.

- F3. **Maintain the persona library**
  - **Trigger:** ministry lead defines or updates the audience roster.
  - **Actors:** A3, A2.
  - **Steps:** ministry lead provides persona definitions (tone, needs, scripture posture, emotional goal, faith-stage, cultural context) → stored in the Mastra-owned library → available to the generator and future features.
  - **Outcome:** a curated, reusable persona library.
  - **Covered by:** R9, R10.

---

## Requirements

**Persona library (Mastra-owned)**

- R1. The system maintains a curated library of audience personas, owned by Mastra, reusable by the generator and future features.
- R9. Each persona definition carries: name, tone, audience needs, scripture posture, emotional goal, faith-stage, and cultural context.
- R10. The persona roster's content is ministry-sourced; the system treats the roster as data (editable without a code change) and ships a starter roster as a placeholder.

**Variant generation (Mastra)**

- R2. Given a topic and a selected set of personas, the generator produces one tailored experience per persona.
- R3. All variants for a topic share the same grounded facts but diverge in framing, scripture selection, and the questions they answer.
- R5. Generation builds on the existing quality pipeline (multi-direction exploration → synthesis → adversarial critique), with the critique judging persona-fit, not only schema validity.
- R6. The persona-fit critique surfaces named audience-fit risk labels (e.g. "too direct," "may confuse a non-believer," "emotionally off," "culturally off").
- R11. Generated variants pass the same block-schema validation gate as the existing generator before persistence.

**Admin (caller + editor UX + persistence)**

- R4. Editors select a topic + personas, review the generated variants, edit them, and publish from admin.
- R7. Each published variant is its own experience page with its own URL (share-by-link distribution in v1).
- R8. Each variant carries an editor-facing "how this lands for audience X" note.
- R12. Variants are grouped under one logical topic so they are managed together and a later phase can route among them.

**Division of labor**

- R13. Mastra owns the persona library, variant generation, and persona-fit critique; admin is a thin caller (trigger, editor UX, validate/store/publish, permissions); web owns rendering and, in a later phase, auto-routing. Mastra never owns experience data.

---

## Acceptance Examples

- AE1. **Covers R2, R3.** Given the topic "Easter" and personas {grieving, new believer, family}, when the editor generates, then three separate draft pages are produced that share the core Easter facts but differ in tone, scripture emphasis, and questions asked.
- AE2. **Covers R6, R8.** Given a generated variant whose copy reads as confrontational for a grieving visitor, when generation completes, then that variant is flagged with an audience-fit risk ("too direct for a grieving reader") and carries a "how this lands" note.
- AE3. **Covers R7, R12.** Given three published persona variants for one topic, when the editor publishes them, then each has its own URL and all three are grouped under the same logical topic.
- AE4. **Covers R11.** Given a generated variant containing an invalid block, when admin attempts to persist it, then persistence is rejected by the same schema-validation gate the existing generator uses.

---

## Success Criteria

- An editor can produce several genuinely audience-tailored, well-composed pages for one topic in a single pass — visibly better-fit than one generic page — and can see how each will land before publishing.
- The persona library is reusable: the same definitions drive this generator and are available to future features without being copied into admin.
- A downstream implementer can build v1 (persona library + single-topic variant generation + manual links) without inventing product behavior; the ministry-provided persona roster is the only external input required.

---

## Scope Boundaries

### Deferred for later

- Automatic audience-routing: the watch site selecting the right variant by signal (referrer, quiz answer, geo) or A/B. v1 ships manual share-by-link; the persona/variant model is shaped so routing is a clean follow-up, not a rebuild.
- Visitor-signal capture and per-variant performance analytics.
- Editor-side "User Mind Reader" chat upgrades (smarter clarification, next-step suggestions) — the existing AI chat already covers editor intent.
- Persona × locale/translation interaction (how personas combine with the per-locale experience model).

### Outside this product's identity

- A personal communication assistant (email/recipe/thesis review, "write to my supervisor / donor / friend," generic personal cross-cultural etiquette). "Audience" here means the ministry's audience — the watch-site visitor — never the editor's personal correspondents.
- Adopting the source idea's full ten-layer generic content-pipeline architecture; the relevant ideas map onto the existing Mastra → admin → web split.
- Real-time per-visitor personalization or live audience detection.

---

## Key Decisions

- **Build on the existing quality pipeline, not a parallel system.** The multi-direction loop becomes multi-persona; the critique becomes persona-fit. Reuses proven machinery and avoids a second generation path.
- **The persona library lives in Mastra, not admin.** It's shared AI infrastructure the generator and future features draw on, and keeps admin a thin caller per the consolidation contract. This is the concrete answer to "how does admin benefit from Mastra."
- **Variants are separate pages grouped under one topic** — not one adaptive page, and not N unrelated pages. Supports manual links now and auto-routing later.
- **Division of labor follows the established consolidation.** Mastra = AI engine; admin = data + UX + permissions; web = rendering + routing. Mastra must not own experience data — moving it there would undo the consolidation (this is the answer to "can it all be in Mastra?": the thinking can, the data/editor/storefront stay put).
- **Fold in three enrichments from the "audience mind reader" exploration** — audience-fit risk labels, the "how this lands" note, and richer persona definitions — and reject the personal-assistant framing. Keep the useful, drop the identity-blurring.

---

## Dependencies / Assumptions

- **Ministry-provided persona roster** (tone, needs, scripture posture, emotional goal, faith-stage, cultural context per audience). A starter roster (seeker/skeptic, grieving, new believer, family/kids, seasoned believer) is an assumption pending ministry confirmation.
- Reuses the existing generation grounding (topic / video candidates) and the shared block-schema validation.
- v1 stays inside Mastra + admin; no public watch-site (`apps/web`) changes until the routing phase.
- Production deploy is a human gate (loop in Tataihono); this is a product-level, multi-app feature, not a same-day build.
- No persona/audience data model exists today — verified against the schema and the live database — so this is net-new.

---

## Outstanding Questions

### Resolve Before Planning

- [Affects R1, R10][User / ministry decision] What is the initial persona roster, and who owns it? The starter set is an assumption; the ministry must confirm the real audiences and their definitions before a build delivers value.

### Deferred to Planning

- [Affects R2, R5][Technical] Generation topology: one Mastra call returns all N variants vs. N independent generations.
- [Affects R12][Technical] How variants are grouped/related so they're managed together and routable later.
- [Affects R3][Needs research] How "shared grounding, divergent framing" is enforced so variants stay factually consistent across audiences.
- [Affects R6, R8][Technical] Where the "how this lands" note and audience-fit risk labels are stored and surfaced to the editor.
- [Affects "Deferred for later"][Needs research] Persona × locale interaction once routing ships.
