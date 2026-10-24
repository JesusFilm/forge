---
date: 2026-05-19
topic: mastra-workflow-draft-generation
---

# Mastra Workflow for "Create Full Experience Draft"

## Summary

Wire the existing `multi-step-draft-workflow` (plan → draft → critique → revise) into the dashboard "create full experience draft" path. Each of the four steps is backed by a real Mastra agent — existing specialized agents where they fit, new step-specific prompts where they do not — replacing the current single-agent generator. Chat-turn is unaffected and continues using the default-chat agent.

---

## Problem Frame

The convergence work (`2026-05-18-mastra-orchestrator-chat-convergence-requirements.md`) collapsed admin's experience-AI chat to a single Mastra+OpenRouter channel, but the four-step workflow scaffolded in `apps/admin/src/mastra/workflows/multi-step-draft-workflow.ts` ships with placeholder step bodies and is not invoked anywhere. The "create full experience draft" dashboard action (`generate-draft-action.ts` → `experience-ai.service.ts`) still routes through a single LLM call: one prompt in, one envelope out.

Today the single-agent path works, but every future tuning move — better planning, explicit critique, cost rebalancing per stage, swapping models per step, adding tool calls scoped to one stage — requires either editing one giant prompt or refactoring the call site. The workflow primitive exists specifically to give that tuning a known place to live. Until it is wired into a real entry point with real step bodies, it stays scaffolding that no one runs.

---

## Requirements

**Workflow shape**

- R1. The dashboard "create full experience draft" path invokes `multiStepDraftWorkflow` end-to-end. All four steps (`plan`, `draft`, `critique`, `revise`) execute sequentially on every invocation.
- R2. Each workflow step is backed by a real Mastra agent call (or an equivalent in-Mastra LLM invocation). No step retains placeholder string bodies after this work ships.
- R3. The `draft` step reuses the existing `draft-experience` specialized agent. The `plan`, `critique`, and `revise` steps each have a dedicated prompt — reusing an existing agent with a step-specific prompt is acceptable; introducing a new registered agent is acceptable when the prompt warrants its own surface.
- R4. The final returned envelope conforms to the same `ChatMutationEnvelopeSchema` that `generate-draft-action.ts` consumes today. The workflow's user-visible output shape does not change.

**Trigger and invocation**

- R5. The dashboard "create full experience draft" button is the only trigger that runs the workflow in v1.
- R6. Chat-turn (`streamChatTurn`) continues to use the default-chat agent directly. The workflow is not invoked from chat-turn.
- R7. The workflow runs only when the experience locale's canonical surface and any DRAFT revision are empty (preserving today's empty-canvas precondition in `generate-draft-action.ts`).

**Failure and budget**

- R8. Workflow invocation is wrapped in `AbortSignal.timeout()` at a wall-clock cap large enough for four sequential model calls. Exceeding the cap aborts the workflow and surfaces a typed error to the dashboard action; no partial draft is returned.
- R9. Mid-flow failure in any step (model error, validation error, OpenRouter rate-limit exhausting the ladder) aborts the workflow and surfaces a typed error. No partial draft is returned. No fallback to the single-agent path.
- R10. The per-draft token budget grows from the current single-call ceiling to approximately 4× to accommodate four sequential calls. The exact per-step split is a planning-time decision.

**Quality bar**

- R11. End-to-end workflow output is at least as good as today's single-agent default-chat draft on a representative sample. Better is the goal; parity is the floor. "Quality" is measured by editor judgment during planning's smoke test against a fixed set of prompts — not a formal metric.

**Memory**

- R12. The workflow runs as one logical generation per editor click. No Mastra memory writes occur between steps; each workflow run is independent and does not contribute conversational history.

---

## Acceptance Examples

- AE1. **Covers R1, R5.** Given an editor on the experience editor with an empty canvas, when they click "create full experience draft", then `multiStepDraftWorkflow` executes all four steps and the final revised envelope is applied to the locale's DRAFT revision.
- AE2. **Covers R6.** Given an editor in the chat panel sends a message asking for a full draft of an experience, when the chat-turn runs, then the default-chat agent (not the workflow) produces the response — the workflow is not invoked from chat-turn even when the user prompt resembles a full-draft request.
- AE3. **Covers R7.** Given an experience locale already has a non-empty canonical surface or a non-empty DRAFT revision, when the editor clicks "create full experience draft", then the action returns the existing `CANVAS_NOT_EMPTY` error and the workflow does not run.
- AE4. **Covers R8, R9.** Given the workflow is mid-flight at step 3 (critique) and the model call exceeds the wall-clock cap, when the timeout fires, then the dashboard action receives a typed error, no DRAFT revision is created, and no partial envelope is persisted.
- AE5. **Covers R12.** Given an editor runs the workflow on experience X and then opens the chat panel on the same experience, when they look at chat history, then the workflow's intermediate plan / draft / critique / revise outputs do not appear in the conversation log.

---

## Success Criteria

- An editor clicking "create full experience draft" on an empty experience locale gets a final envelope produced by the four-step workflow, indistinguishable in shape from today's single-agent output and at least as useful in content.
- A developer editing prompts in `multi-step-draft-workflow.ts` can change one step's prompt without touching the other three, and the change ships behind the same dashboard button without UI or route changes.
- `grep -rn "multiStepDraftWorkflow" apps/admin/src` shows the workflow imported and invoked at the draft-generation entry point, not only registered in the Mastra singleton.
- A smoke run on a representative prompt set returns drafts the team judges at least as good as today's default-chat output on the same prompts, with all four workflow steps observably executing in logs.

---

## Scope Boundaries

- Chat-turn routing through the workflow — out of scope. Chat-turn keeps the default-chat agent.
- Per-step streaming to the UI (Approach B from brainstorm) — deferred. Editor sees one spinner with optional step labels; intermediate step outputs are workflow-internal in v1.
- Editor-facing plan approval or mid-flow steering — deferred. The workflow runs straight through; no "approve plan before drafting" gate.
- Workflow-as-tool invoked by the default-chat agent (Approach C from brainstorm) — deferred. The dashboard button calls the workflow directly; the LLM does not decide when to run it.
- Non-empty-canvas drafting — out of scope. The empty-canvas precondition stays.
- New workflows for other capabilities (rewrite full experience, expand section, port locale) — out of scope. v1 wires exactly one workflow.
- Per-step budget metering, observability dashboards, or cost telemetry beyond the existing `budgets.ts` ceilings — out of scope. Total token budget grows ~4× and is enforced at the workflow boundary, not per step.

---

## Key Decisions

- **All four steps from day 1, not a smaller starting shape.** The user wants the full plan → draft → critique → revise loop wired now so each step is a known iteration surface. A 1- or 2-step starter would defer the same wiring work without delivering the critique loop the workflow exists for.
- **Route-invoked, not agent-invoked.** The dashboard button calls the workflow directly. Letting the default-chat agent tool-call the workflow (Approach C) would gain a uniform chat surface but trade deterministic dispatch for LLM judgment, and the empty-canvas precondition becomes harder to enforce. Today's button is the only trigger; one entry point keeps the failure surface tight.
- **Single-spinner UX, not per-step streaming.** Approach A is shipped in v1; Approach B (stream each step's output to the chat panel) is a clear follow-up once intermediate step outputs prove useful. Doing both on day 1 doubles UI scope without proven value.
- **Workflow output matches today's envelope shape.** No change to `ChatMutationEnvelopeSchema` or to how `generate-draft-action.ts` consumes the result. The workflow is a drop-in replacement for the single LLM call inside the action.
- **No memory writes per step.** The workflow is one logical generation per click. Threading individual steps as chat turns would leak workflow internals into editor-visible memory and complicate downstream chat-turn behavior.
- **Quality bar is editor judgment, not a metric.** Adoption is scaffolding-driven; the user explicitly stated there is no measured quality regression in current drafts. A formal eval harness is a separate brainstorm.

---

## Dependencies / Assumptions

- The four `createStep(...)` definitions in `multi-step-draft-workflow.ts` and the `multiStepDraftWorkflow.then(...).then(...)` chain stay structurally as-is; only the `execute` bodies and per-step prompts change.
- Mastra's agent surface (`getMastra().getAgentById(...)`) can be called from inside a `createStep` `execute` body without re-creating the singleton per invocation. Verify in planning — if `execute` cannot reach the Mastra singleton cleanly, the per-step calls instantiate via the same factory the registered agents use.
- The existing `draft-experience` specialized agent's prompt is suitable as-is for the `draft` step, or warrants a minor adjustment to accept a planner-produced outline as input. The size of that adjustment is a planning question.
- OpenRouter free-model latency and rate limits comfortably accommodate four sequential model calls per dashboard click. The wall-clock cap in R8 must be set with real timing observed in planning's smoke test — assuming today's per-call latency, the cap is "several × current single-call cap", but the exact value is set when planning runs the first real four-step trace.
- Token budget for the four-call workflow (R10) does not push admin past OpenRouter free-tier daily limits at expected usage. Daily editor draft-creation volume is small enough that 4× per draft is comfortably within budget; verify in planning if usage projections change.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2, R3][Technical] Per-step agent / prompt design: do `plan`, `critique`, and `revise` each get a newly registered Mastra agent, or are they Mastra LLM calls with step-specific system prompts reusing one or two existing agents? The decision affects test surface, registry size in `mastra/index.ts`, and where prompts live (`mastra/prompts/` vs inline in the workflow module).
- [Affects R3][Technical] Does the `draft-experience` agent's existing prompt accept a separately-produced plan as input, or does it need an adjustment to incorporate the planner's outline? Influences how step 1's output is threaded into step 2.
- [Affects R8][Technical] What wall-clock cap is correct for four sequential OpenRouter free-model calls? Sample real timings during planning's smoke test and pick a cap with headroom.
- [Affects R10][Technical] How is the ~4× token budget split across the four steps? Plan and critique are likely shorter than draft and revise; per-step ceilings in `budgets.ts` may need adjustment.
- [Affects R9][Technical] Per-step retry policy: if step 2 hits a transient OpenRouter rate-limit, does the workflow retry that step before failing? Mastra's workflow primitive supports retries; the question is whether they are turned on in v1.
- [Affects R1, R11][Verification] What is the representative prompt sample used for the quality-bar smoke test, and who runs it? Selecting prompts and reviewer is a planning-phase task.
