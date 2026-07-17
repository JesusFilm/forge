---
date: 2026-06-15
topic: ai-experience-generation-structural-validity
---

# AI Experience Generation — Structural Validity Guarantee

## Summary

Make AI experience-draft generation structurally bulletproof through layered defense: the model keeps full freedom over which blocks it uses and in what order, but a drifted draft is now repaired-then-revalidated instead of lost, and an off-shape draft is never persisted or shown. The layers are two-phase generation (skeleton → fill), per-phase schema-constrained decoding where the provider honors it, deterministic coercion, and a validate→repair-with-error-feedback loop as the fail-closed boundary gate.

---

## Problem Frame

`apps/admin` generates Experience drafts with AI today (plan → draft → critique → revise via Mastra, then a normalize stage that resolves symbolic refs and re-validates against the canonical block union). The structure is already validated at multiple gates, but the gates fail **destructively**: when the model drifts off-shape, the whole draft fails and the editor has to manually re-run generation. There is no repair loop today — engine retries are disabled, and the critique→revise step only improves wording; it never sees or fixes a schema error.

The most common drifts are also the most recoverable: the model emits storage-shape keys (e.g. a concrete video id) instead of the authoring-shape symbolic ref and is rejected by strict no-extra-keys validation, or it invents a video/section ref that doesn't correspond to a candidate that was actually offered. Each of these throws away an entire generation.

Two structural realities shape the work. First, a single generation mechanism cannot hard-guarantee a valid _assembled_ document: schema-constrained decoding stops bad keys/shapes at the token level but does not enforce document-level rules (scoped nesting, cardinality, ordering, minimum size), and the block schema is a large, recursive, ~17-variant discriminated union — exactly the regime where constrained-decoding backends under-constrain or lose coverage. Second, the model provider stack is mixed and partly unverified: the default path emits free text that is parsed and validated after the fact, and the self-hosted gateway's constrained-decoding support is currently unverified (last smoke run 0/8) with tool-calling broken on it.

---

## Actors

- A1. Admin editor — triggers AI experience generation from the dashboard and receives either a draft or a failure.
- A2. Generation pipeline — the planner/draft/critic/reviser agents that produce the draft's structure and content.
- A3. Validation & repair layer — deterministic coercion, the repair loop, and the boundary validator/normalize stage that enforces structural validity and fail-closed behavior.
- A4. Model provider — gateway / default / fallback providers that may or may not honor schema-constrained decoding.

---

## Key Flows

- F1. Two-phase happy path
  - **Trigger:** Editor requests an AI draft for a topic/locale.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** (1) Skeleton phase emits block types, order, and nesting only. (2) Skeleton is validated against structural rules before any content is generated. (3) Fill phase populates each block's content against that single block's content shape. (4) Boundary validator confirms the assembled document against the canonical persistence union.
  - **Outcome:** A structurally-valid draft is returned to the editor; only the content inside varies between runs.
  - **Covered by:** R1, R2, R3, R4, R10

- F2. Drift → recover → fail-closed
  - **Trigger:** Generated output (skeleton or assembled draft) fails validation.
  - **Actors:** A2, A3, A4
  - **Steps:** (1) Attempt deterministic coercion first; log every mutation. (2) If still invalid, re-prompt the model with the concrete validation errors and the offending output, up to a capped number of attempts. (3) Classify the failure; stop early on structurally-impossible failures. (4) Re-validate against the canonical persistence union.
  - **Outcome:** Most drifts recover into a valid draft; if repair is exhausted, nothing is persisted or shown and the editor gets a classified, actionable failure.
  - **Covered by:** R7, R8, R9, R10, R11, R13

---

## Requirements

**Generation strategy (two-phase)**

- R1. Generation proceeds in two phases: a skeleton phase that emits only block types, order, and nesting; then a fill phase that populates each block's content.
- R2. The skeleton is validated against structural rules (allowed block types, scoped nesting, cardinality, ordering, minimum size) _before_ any content is generated; an invalid skeleton is repaired or regenerated before fill begins.
- R3. Each fill targets a single block's content shape, not the full multi-variant union.

**Decode-time constraint**

- R4. Where the active provider honors schema-constrained decoding, both phases use it so off-shape output is prevented at the source.
- R5. The final guarantee must not depend on constrained decoding being available: when a provider does not honor it (or it is unverified), generation degrades to free output plus the coercion/repair/validation layers with no loss of the final guarantee.
- R6. A provider's constrained decoding is treated as trusted only after it is verified end-to-end (smoke gate green) against the experience schema; an unverified provider is treated as best-effort and leans on the repair/validation layers.

**Repair and boundary gate**

- R7. When output fails validation, the system attempts deterministic coercion first (normalize the discriminator, drop unknown keys / illegal blocks, fill known defaults) before any model round-trip; every coercion is logged because it is lossy.
- R8. If still invalid, the system re-prompts the model with the concrete validation errors plus the offending output, up to a capped number of attempts.
- R9. The repair loop classifies each failure (malformed syntax vs schema violation vs structurally impossible) and does not retry failures that cannot converge; it caps total attempts and total wall-clock.
- R10. The assembled output is always validated against the canonical persistence union (the real domain block schema). Output that is still off-shape after all repair attempts is never persisted or shown — the system fails closed.

**Error surfacing and existing-defect fixes**

- R11. Normalize-stage failures (unresolved video/section refs, invalid-after-lowering) are surfaced as schema/structure errors, not as a generic "unknown" error.
- R12. The minimum-block-count rule is consistent across the generation gate and the persistence gate (they no longer disagree).
- R13. On terminal failure, the editor sees what went wrong and what to do next (retry, adjust prompt); the draft is never silently lost or silently partial.

---

## Acceptance Examples

- AE1. **Covers R2.** Given the skeleton phase proposes a section nested inside a section, when the skeleton is validated, the illegal nesting is caught and repaired/regenerated before any content is generated.
- AE2. **Covers R5, R6.** Given the active provider does not honor constrained decoding, when generation runs, output still passes through coercion + repair + the boundary validator and either a valid draft is produced or it fails closed — the guarantee holds without constrained decoding.
- AE3. **Covers R8, R9.** Given the model emits a storage-shape key instead of an authoring ref, when validation rejects it, the system re-prompts with the specific error and the corrected draft validates; given a structurally-impossible failure, the loop stops early rather than exhausting retries pointlessly.
- AE4. **Covers R10.** Given repair attempts are exhausted and output is still off-shape, when the action completes, nothing is persisted and the editor receives a classified failure — never a partial or invalid draft.
- AE5. **Covers R11.** Given a generated draft references a video candidate that was not offered, when normalize fails to resolve it, the editor sees a schema/reference error, not "unknown."

---

## Success Criteria

- Human outcome: near-zero whole-draft-fails reach the editor; when the AI drifts, the editor gets a usable draft instead of having to re-run by hand. Structure is always valid; only the content inside varies.
- Fail-closed invariant: an off-shape draft can never be persisted or shown — verified by the boundary validator rejecting anything that fails the canonical union after repair.
- Downstream/agent handoff: every generation outcome is a typed, classified result (first-pass valid | recovered-after-repair | classified failure); constrained decoding is trusted only where verified.
- Measurable: track the rate of first-pass-valid vs recovered-after-repair vs terminal-fail; terminal-fails reaching the editor approach zero, and recovered drafts are quality-equivalent to first-pass drafts.

---

## Scope Boundaries

- No external MCP server and no exposing experience components to outside agents — dropped as the correctness mechanism (guarantees individual block shape, not the assembled document; broken on the gateway).
- No fixed-template or pick-from-approved-template generation — free structure is retained by design.
- No change to the editorial/semantic _quality_ of generated content; the existing critique→revise editorial pass stays as-is except where it intersects schema repair.
- No change to the block schema / domain model itself.
- The "video has no playable stream" gap is out — already handled upstream by the recent playable-candidates fix; noted as adjacent, not re-opened.
- Not switching the default provider; constrained decoding is applied to whichever provider is active. Verifying/enabling the gateway is an in-scope gated step, but changing the default is not a goal of this work.

---

## Key Decisions

- Drop MCP / tool-calling-per-block as the correctness mechanism. Rationale: it hard-guarantees each individual block's argument shape but provably does not guarantee a valid _assembled_ document (ordering, scoped nesting, cardinality, document-level no-extra-keys), and tool-calling currently 500s on the self-hosted gateway.
- The true guarantee lives at the boundary validator failing closed, not in trusting the model. Rationale: no single generation mechanism hard-guarantees a valid assembled ~17-variant document, so defense-in-depth plus fail-closed is the only way "never off-shape" is actually true.
- Choose the full layered stack over any single layer. Rationale: each layer covers what the others miss — constrained decoding misses document-level nesting/cardinality, the repair loop catches those, two-phase maximizes first-pass success on this schema shape, and coercion makes repairs cheap.
- Extend the existing generator pipeline rather than rebuild. Rationale: the pipeline, the validation gates, the typed-error classification, and the normalize stage already exist and are reused; two-phase changes the generation strategy but keeps the surrounding infrastructure.

---

## Dependencies / Assumptions

- Built on the existing generation pipeline (plan → draft → critique → revise, the normalize stage, and the typed-error/classification convention).
- Constrained decoding depends on the provider/gateway forwarding and honoring schema constraints. The self-hosted gateway's support is currently unverified (last smoke run 0/8) and tool-calling is broken on it.
- The default provider path emits free text that is parsed and validated after the fact, so the coercion/repair/validation layers must carry the guarantee on that path.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R4, R6][Needs research] Does the self-hosted gateway's backend actually honor schema-constrained decoding for the experience schema, and does the gateway forward the constraint unchanged? Confirm via a smoke gate before trusting it.
- [Affects R1–R3][Technical] Exact skeleton representation and how nesting/cardinality/ordering rules are expressed for pre-fill validation.
- [Affects R8, R9][Technical] Retry cap, wall-clock budget (relative to the existing action time budget), and the error-classification taxonomy.
- [Affects R3][Technical] Whether fill runs blocks in parallel, and how interdependent content (one block's content depending on another) is handled.
