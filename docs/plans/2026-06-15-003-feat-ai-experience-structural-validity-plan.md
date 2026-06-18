---
title: "feat: AI Experience Generation — Structural Validity Guarantee (layered stack)"
type: feat
status: active
date: 2026-06-15
origin: docs/brainstorms/2026-06-15-ai-experience-generation-structural-validity-requirements.md
---

# feat: AI Experience Generation — Structural Validity Guarantee (layered stack)

## Summary

Make AI experience-draft generation never produce an off-shape result by layering defense onto the existing generator: deterministic coercion, two-phase generation (skeleton → fill), per-phase schema-constrained decoding where a provider is verified to honor it, and a validate→repair-with-error-feedback loop that always fails closed against `BlocksSchema`. The model keeps full freedom over which blocks and ordering it uses; only the content varies. Plus two defect fixes that make the existing gates honest.

---

## Problem Frame

The generator already validates structure at multiple gates (`DraftExperienceSchema` in the workflow, then `normalizeExperienceDraft` → `BlocksSchema` in the action), but the gates fail **destructively**: any drift fails the whole draft and the editor must manually re-run. There is no repair loop today (`retryConfig: { attempts: 0 }`; the critique→revise step only improves wording, never repairs schema errors). The most common drifts are also the most recoverable — the model emits a storage key instead of an authoring ref (rejected by `.strict()`), or invents a video/section ref that no candidate matches. See origin for full pain narrative and the failure-mode catalog.

---

## Requirements

- R1. Generation proceeds in two phases: a skeleton phase emitting only block types/order/nesting, then a fill phase populating each block's content.
- R2. The skeleton is validated against structural rules (allowed types, scoped nesting, cardinality, ordering, minimum size) BEFORE any content is generated; an invalid skeleton is repaired/regenerated before fill.
- R3. Each fill targets a single block's content shape, not the full ~17-variant union.
- R4. Where the active provider is verified to honor schema-constrained decoding, both phases use it so off-shape output is prevented at the source.
- R5. The final guarantee must NOT depend on constrained decoding: an unverified/non-honoring provider degrades to free output + coercion/repair/validation with no loss of the final guarantee.
- R6. A provider's constrained decoding is trusted only after a green smoke gate against the experience schema; otherwise it is best-effort.
- R7. On validation failure, deterministic coercion is tried first (normalize discriminator, drop unknown keys / illegal blocks, fill known defaults), before any model round-trip; every coercion is logged (lossy).
- R8. If still invalid, the model is re-prompted with the concrete validation errors + offending output, up to a capped number of attempts.
- R9. The repair loop classifies failures (malformed-syntax vs schema-violation vs structurally-impossible), does not retry non-converging failures, and caps attempts + wall-clock.
- R10. The assembled output is always re-validated against `BlocksSchema`; output still off-shape after repair is never persisted or shown — the system fails closed.
- R11. Normalize-stage failures surface as schema/structure errors, not a generic `UNKNOWN`.
- R12. The generation minimum-block-count rule is single-sourced into one constant AND enforced at the post-normalize generation path (which today enforces no minimum at all), so the generation contract is explicit rather than silently permissive at the boundary.
- R13. On terminal failure the editor sees a classified, actionable message; the draft is never silently lost or partial.

**Origin actors:** A1 (admin editor), A2 (generation pipeline), A3 (validation & repair layer), A4 (model provider)
**Origin flows:** F1 (two-phase happy path), F2 (drift → recover → fail-closed)
**Origin acceptance examples:** AE1 (covers R2), AE2 (covers R5/R6), AE3 (covers R8/R9), AE4 (covers R10), AE5 (covers R11)

---

## Scope Boundaries

- No external MCP surface; no exposing experience components to outside agents.
- No fixed-template or pick-from-template generation — free structure retained.
- No change to the persistent `BlocksSchema` block-type set / domain model; the minimum-count fix single-sources the generation rule, not a global persistence constraint (which would reject legitimate manual 1-block experiences). New internal validation schemas (skeleton, per-block fill) are generation-only scaffolding — not persisted, versioned, or exposed as domain contracts.
- No editorial/quality change to generated content; the critique→revise editorial pass stays.
- No default-provider switch. Verifying/enabling the gateway's constrained decoding is in-scope (gated), but flipping the default is not.
- Do NOT add a GraphQL query/mutation surface for generation — keep it as a Next.js server action invoked only from `generate-draft-action.ts` (verified today: no `triggerGenerateDraft`/`DraftExperience` in `apps/admin/src/graphql` or `schema.graphql`, so no codegen step applies).

### Deferred to Follow-Up Work

- Parallel fill fan-out (`pLimit` + `Promise.allSettled`): only if a later measurement shows the per-block provider call is the wall-time bottleneck. Default is sequential fill (see Key Technical Decisions). Separate PR.
- A reusable `docs/solutions/architecture-patterns/` doc for the "constrained-decode → coerce → validate → repair" layered guarantee, via `ce:compound` after this lands.

---

## Context & Research

### Relevant Code and Patterns

All paths under the worktree root `/workspace/.claude/worktrees/feat+ai-experience-structural-validity/`, repo-relative below. **Mastra is embedded in `apps/admin/src/mastra/`, not the standalone `apps/mastra` app.**

- `apps/admin/src/mastra/workflows/multi-step-draft-workflow.ts` — the generator. `WorkflowStepError` (L54), `structuredDraftOutputEnabled()` (L168), `STRUCTURED_DRAFT_OPTS` (L174), `callAgent()` (L179), `liftToDraftExperienceShape()` (L232), `parseDraftEnvelope()` (L284), `resolveDraft()` (L394), step executors `executePlan/Draft/Critique/Revise` (L415–473), `createStep` wrappers (L485–515), `multiStepDraftWorkflow` chain (L521), `MULTI_STEP_DRAFT_MAX_STEPS=4` (L547), `quickDraftWorkflow` (L569), `QUICK_DRAFT_MAX_STEPS=2` (L588). Step executors are extracted as pure functions driven by a synthetic `MastraSurface` — the testing convention to mirror.
- `apps/admin/src/services/experience-ai/experience-ai.schemas.ts` — `DraftExperienceSchema` (L369, `blocks.min(2)` at L373), the Draft scope unions (L322–367), ref regexes `/^s\d{2}$/` (L3) and `/^v\d{2}$/` (L10), `VideoCandidate` (L393), `buildDraftExperienceJsonSchema()` (L404).
- `apps/admin/src/services/experience-ai/experience-ai-normalize.ts` — `ExperienceAiNormalizationError` (L66, codes `UNKNOWN_VIDEO_REF|UNKNOWN_SECTION_REF|DUPLICATE_SECTION_REF|INVALID_BLOCKS`), `resolveSectionKey()` (L156), `resolveVideoCandidate()` (L171), `normalizeDraftBlock()` (L196), `normalizeExperienceDraft()` (L507) with `BlocksSchema.safeParse()` at L526.
- `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts` — `GenerateDraftActionErrorCode` (L47), `USER_MESSAGES` (L96), `classifyWorkflowError()` (L167), `withTimeout()` (L188), `runGenerateDraftAction()` (L207) with `normalizeExperienceDraft` call at L322 and the catch ladder at L419–442 (the `ExperienceAiNormalizationError`-falls-to-`UNKNOWN` defect).
- `apps/admin/src/domain/blocks.ts` — `BlockSchema` (L525, 17 types), `BlocksSchema` (L551, no `.min()`), scoped unions `SectionContentBlockSchema` (L477), `ContainerContentBlockSchema` (L434).
- `apps/admin/src/mastra/agents/specialized-agents.ts` — agent factories + `SpecializedAgentId` union (L118), `resolveAgentModel()` (L74, 3-tier gateway→Gemini→OpenRouter gate). `apps/admin/src/mastra/index.ts` — `buildMastraInstance()` workflow/agent registry. `apps/admin/src/mastra/budgets.ts` — `TOKEN_CAPS`. `apps/admin/src/mastra/prompts/` — prompt sources.
- `apps/admin/src/config/env.ts` — `createEnv` `server` + `runtimeEnv` blocks; `emptyToUndefined` (L7); AI-gateway flag block (L272–299); flag convention `z.enum(["true","false"]).optional().default("false")`.
- `apps/admin/src/scripts/smoke-mastra-draft-workflow.ts` — `pnpm --filter @forge/admin smoke:draft-workflow`; real-LLM run over 8 prompts asserting `DraftExperienceSchema`.

### Institutional Learnings

- `docs/solutions/best-practices/openai-strict-anyof-lenient-per-section-parse-20260422.md` — provider `strict:true`+`anyOf` is weaker than assumed (drops required branch fields; `finish_reason: stop` masks truncation). **Therefore:** fill phase uses a flat single-object schema with an enumerated `type` discriminator + optional branch fields (not `anyOf`); guard `finish_reason === "length"` → fail closed (truncation is `UPSTREAM_ERROR`, not repairable); repair feeds the validation error back into the prompt, never blind re-roll.
- `docs/solutions/best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md` — canonical dual-schema + closed typed-error-union + raw-error logging. **Therefore:** reserve `UNKNOWN` strictly for genuinely-unrecognized throws (always `console.error`); single-source the min-count so the two gates can't drift.
- `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md` — never classify by error-message regex; branch on `instanceof TypedError && error.code`; exhaustive `switch` + `never` fallthrough so a new code fails to compile until handled.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — every typed branch needs a test where ONLY it matches; throw the REAL typed error class; the repair test must fail-then-pass (mock that passes attempt 1 proves nothing).
- `docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md` — its own "When NOT to apply" note: `experienceEmbeddingBackfill` stays sequential because the corpus is small and the provider rate limit (not wall time) is the bottleneck. **Therefore:** fill is sequential by default (block counts are small, gateway rate-limit bound); parallelism deferred.
- `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md` — new opt-in flags must be `.optional()`/`.default()`, never bare-required (bricks Railway deploy before provisioning).
- `docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md` — in admin's request path (server action) log with plain-string `[label] event=name key=value`, NOT `JSON.stringify`.
- `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md` — each provider/repair call needs a per-call timeout strictly under the outer ceiling; budget skeleton + fill + (repair × maxAttempts) under the action/workflow ceiling.

### External References

External research from the brainstorm (origin doc) stands: no single mechanism hard-guarantees a valid assembled ~17-variant document; constrained decoding (vLLM guided_json) gives a hard structural guarantee only for the schema subset the pinned backend covers and misses document-level nesting/cardinality (JSONSchemaBench Jan-2025 coverage cliffs); tool-calling-per-block guarantees individual calls, not the assembled document — the layered fail-closed validator is what makes "never off-shape" true.

---

## Key Technical Decisions

- **Repair loop sits at the outer boundary, decoupled from two-phase.** The fail-closed guarantee (U5) wraps generation and re-validates against `BlocksSchema`; it works whether generation is single-draft (today) or two-phase (U3). This lets the guarantee land before/independent of the larger two-phase rebuild, and keeps `BlocksSchema` as the single source of truth for "valid."
- **Repair re-prompts a single agent, not a workflow re-run.** The repair step calls `getMastra().getAgentById(...).generate(...)` directly with the serialized errors + offending output (~15–30s), NOT `run.start(...)` (a full workflow re-run is ~50–90s and 1 + 2×~70s overruns the 180s `ACTION_BUDGET_MS`/`TIME_BUDGET_MS.multiStepWorkflow` ceiling). Each repair call gets a per-call timeout ≤ 30s so `initial-run + maxAttempts × 30s` stays under the action ceiling.
- **Fill schema is flat, not `anyOf`.** Per the strict-anyOf learning, each fill targets one block variant as a flat object with an enumerated `type` + optional branch fields — the regime constrained decoders honor most reliably and the easiest to coerce.
- **Sequential fill, not parallel.** Block counts per experience are small and the gateway rate limit (not wall time) is the bottleneck; sequential fill also lets each fill see prior filled blocks for coherence. Only the no-`Promise.all` rule applies. Parallelism deferred to follow-up pending measurement.
- **Min-count single-sourcing, not a global `BlocksSchema.min(2)`.** Today there is exactly ONE minimum — `DraftExperienceSchema.blocks.min(2)` (`experience-ai.schemas.ts:373`); the post-normalize path validates against `BlocksSchema` which has NO `.min()` (`blocks.ts:551`), so the boundary is silently permissive rather than "disagreeing." Introduce one `GENERATION_MIN_BLOCKS` constant, replace the literal `.min(2)`, and **add** a generation-path minimum-block assertion after the `BlocksSchema.safeParse` in `normalizeExperienceDraft` (gated to the generation caller, NOT by tightening `BlocksSchema` — which governs ALL persistence including legitimate manual 1-block experiences). Document the intentional asymmetry at both sites. Resolves R12 without risking manual content.
- **Typed error codes + exhaustive `switch`/`never`; never regex on message.** Normalize/coercion/repair failures carry literal-union codes; the action classifies via `instanceof` + `code`. `UNKNOWN` is reserved for genuinely-unrecognized throws and always logged.
- **Constrained decoding gated behind a verified flag.** A new `.optional()` enum-of-strings flag (`z.enum(["true","false"]).optional().default("false")`) in the AI-gateway env block marks a provider's constrained decoding as trusted; it is only flipped after the U6 smoke gate is green. Default mode (Gemini, free-text) relies entirely on coercion+repair+validator.
- **Budgeted nested timeouts.** skeleton + fill + (repair × maxAttempts) must sum under the existing `withTimeout` action ceiling / `TIME_BUDGET_MS`; each provider call gets a per-call timeout strictly smaller than the remaining budget.

---

## Open Questions

### Resolved During Planning

- Skeleton representation: an ordered list of `{ type, sectionRef?, children? }` validated against the scoped-nesting/cardinality/ordering rules derived from the existing Draft scope unions, before any fill.
- Fill schema: flat single-block object with enumerated `type` discriminator (one schema per variant), not `anyOf`.
- Retry cap/budget: small `maxRepairAttempts` (default 2) via `.optional()` env flag; total budget under the action ceiling, per-call timeout < remaining.
- Error taxonomy + normalize-code mapping: `malformed_syntax` | `schema_violation` (repair-eligible) | `structurally_impossible` — with `UNKNOWN_VIDEO_REF`/`UNKNOWN_SECTION_REF`/`DUPLICATE_SECTION_REF` and `finishReason === "length"` mapping to `structurally_impossible` (fail closed). Full mapping in U5 Approach.
- Parallel vs sequential fill: sequential (decision above).
- Gateway smoke gate: yes — U6 extends the smoke harness to assert post-normalize `BlocksSchema` validity and gates the constrained-decoding-trusted flag.

### Deferred to Implementation

- Exact helper/agent/prompt names and the precise prompt copy for the skeleton, fill, and repair agents.
- Whether the repair re-prompt reuses the existing reviser agent or a dedicated repair agent (decide once the failing Zod-error serialization shape is in hand). Either way it is invoked via `getMastra().getAgentById(...).generate(...)`, not a workflow re-run (resolved in Key Technical Decisions).
- (Resolved in U4: `finishReason` is confirmed exposed on Mastra's `FullOutput`; guard strictly on `=== "length"`. No longer an open question.)

---

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```
runGenerateDraftAction (server action)
  └─ load candidates (PLAYABLE_CANDIDATE_VIDEO_WHERE)
  └─ REPAIR BOUNDARY LOOP  (U5, fail-closed, maxRepairAttempts)         ┐
       ├─ workflow: plan → SKELETON → validate-skeleton → FILL(seq)     │ each phase:
       │            → critique → revise        (U3)                     │  coerce (U2)
       │     [per-phase constrained decoding if provider trusted (U4)]  │  → validate
       ├─ normalizeExperienceDraft → BlocksSchema.safeParse  (boundary) │  → on fail, classify (U1)
       └─ if classified schema_violation & attempts left:               │
              re-prompt repair agent with concrete errors + bad output  ┘
  └─ success: persist draft     |     exhausted: fail closed, classified editor message (U1/U13)
```

---

## Implementation Units

### U1. Make the existing gates honest — single-sourced min-count + typed normalize-error classification

**Goal:** Fix the two defects so the boundary contract is truthful before new layers build on it: normalize failures stop collapsing to `UNKNOWN`, and the min-block-count rule is single-sourced.

**Requirements:** R11, R12, R13

**Dependencies:** None

**Files:**

- Modify: `apps/admin/src/services/experience-ai/experience-ai.schemas.ts` — add `export const GENERATION_MIN_BLOCKS = 2`; replace the literal `.min(2)` at L373 with `.min(GENERATION_MIN_BLOCKS)`
- Modify: `apps/admin/src/services/experience-ai/experience-ai-normalize.ts` — **add** a generation-path minimum-block assertion after `BlocksSchema.safeParse` (L526), throwing a typed error when below `GENERATION_MIN_BLOCKS`; inline-comment the intentional `BlocksSchema`-stays-permissive asymmetry (this check does not exist today)
- Modify: `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts` — add `GenerateDraftActionErrorCode` variants for structure/reference failures + `USER_MESSAGES`; add `classifyNormalizationError` branching on `ExperienceAiNormalizationError.code`; add a catch before the generic `UNKNOWN` catch (L441); exhaustive `switch` + `never`
- Modify: `apps/admin/src/domain/blocks.ts` — inline comment at `BlocksSchema` (L551) documenting why no global `.min()`
- Test: `apps/admin/src/app/dashboard/experiences/generate-draft-action.test.ts`, `apps/admin/src/services/experience-ai/experience-ai-normalize.test.ts`

**Approach:**

- One `GENERATION_MIN_BLOCKS` constant referenced by the draft schema gate and the new post-normalize generation check; `BlocksSchema` left permissive (manual experiences may legitimately have one block).
- `classifyNormalizationError(err)` maps each `ExperienceAiNormalizationError.code` to a structure/reference error code via `instanceof` + `code` (never message regex); reserve `UNKNOWN` for genuinely-unrecognized throws and `console.error` them (plain-string format).

**Patterns to follow:** `classifyWorkflowError` (L167) discriminator-driven mapping; `experience-ai-chat-error-codes.ts` literal-union convention.

**Test scenarios:**

- Covers AE5. Error path: `normalizeExperienceDraft` throws `UNKNOWN_VIDEO_REF` → action returns a structure/reference error code (NOT `UNKNOWN`), with the matching `USER_MESSAGES` copy.
- Error path: one fixture per normalization `code` where only that branch matches (throw the REAL `ExperienceAiNormalizationError`, not `new Error("...")`).
- Error path: a genuinely-unrecognized throw still maps to `UNKNOWN` and is logged.
- Edge case: a generated draft with fewer than `GENERATION_MIN_BLOCKS` blocks is rejected at the generation gate; a manual 1-block payload still passes `BlocksSchema` (asymmetry preserved).

**Verification:** Action never surfaces `UNKNOWN` for a known normalization failure; the min-count constant has a single definition referenced by both gates; tests fail if any typed branch is deleted.

---

### U2. Deterministic coercion helper (shared, lossy, logged)

**Goal:** A pure pre-validation fixer that resolves the cheapest, intent-preserving drifts without a model round-trip, reducing how often the repair loop fires.

**Requirements:** R7

**Dependencies:** None

**Files:**

- Create: `apps/admin/src/services/experience-ai/coerce-draft.ts` + `coerce-draft.test.ts`
- Modify: `apps/admin/src/mastra/workflows/multi-step-draft-workflow.ts` (call coercion inside `liftToDraftExperienceShape`/`resolveDraft` before `DraftExperienceSchema` validation)

**Approach:**

- Normalize discriminator casing; strip unknown keys; drop blocks whose `t` is not a known variant or that violate a scoped-nesting rule; fill known defaults (mirror `HERO_DEFAULTS`/`SLOT_SPAN_DEFAULTS`). Every mutation logged in plain-string `[experience-ai] event=coercion_applied kind=... ` format. Lossy — coercion is a first cheap step, never the correctness mechanism.

**Patterns to follow:** `liftToDraftExperienceShape` (L232), `extract-json-object.ts`, the plain-string logging examples in `generate-draft-action.ts` (L348).

**Test scenarios:**

- Happy path: discriminator case mismatch (`"Section"` → `"section"`) coerced; output validates.
- Edge case: unknown top-level key stripped; known block preserved.
- Edge case: a block with an unknown `t` is dropped and logged; remaining blocks intact.
- Edge case: already-valid input is returned unchanged (idempotent) with no coercion logs.
- Note: coercion has no exclusive origin AE — it is a precondition of the F2 repair flow (AE3/AE4), exercised end-to-end in U5's fail-then-pass scenario.

**Verification:** Coercion turns near-miss inputs valid without a model call; each mutation emits a plain-string log line; no JSON-stringified logs in the server-action path.

---

### U3. Two-phase generation (skeleton → validate → sequential fill)

**Goal:** Replace the single draft step with a skeleton step (block types/order/nesting only), a pre-fill structural validator, and a sequential fill step against per-block flat schemas — converting the fragile big-union generation into a tiny structural schema + small reliable fills.

**Requirements:** R1, R2, R3

**Dependencies:** None (lands on the workflow; the repair guarantee U5 does not depend on it)

**Files:**

- Modify: `apps/admin/src/mastra/workflows/multi-step-draft-workflow.ts` (new `executeSkeletonStep`/`executeFillStep` pure executors + `createStep` wrappers; insert into the `.then()` chain replacing/augmenting `draftStep`; update `MULTI_STEP_DRAFT_MAX_STEPS`/`QUICK_DRAFT_MAX_STEPS`)
- Create: skeleton + per-block fill schemas in `apps/admin/src/services/experience-ai/experience-ai.schemas.ts` (a `SkeletonSchema` of `{ type, sectionRef?, children? }`; a flat per-variant fill schema map)
- Create: a `validateSkeleton()` structural check (allowed types, scoped nesting, cardinality, ordering, `GENERATION_MIN_BLOCKS`) in `experience-ai.schemas.ts` or a sibling
- Create: `apps/admin/src/mastra/agents/specialized-agents.ts` skeleton + fill agents (+ `SpecializedAgentId` union entries) and register in `apps/admin/src/mastra/index.ts`; new prompts in `apps/admin/src/mastra/prompts/`
- Modify: `apps/admin/src/mastra/budgets.ts` (`TOKEN_CAPS` entries for the new steps)
- Test: `apps/admin/src/mastra/workflows/multi-step-draft-workflow.test.ts`, schema tests, `specialized-agents.test.ts`

**Approach:**

- Skeleton step emits structure only; `validateSkeleton` rejects/repairs before any fill (cheap fail-fast). Fill step iterates skeleton nodes sequentially, each constrained to that node's flat block schema, passing prior filled blocks as context for coherence. Reuse the `executeXStep` pure-executor + synthetic `MastraSurface` test convention.
- **Envelope contract (load-bearing):** the fill step's output envelope MUST remain `{ ...planFields, draft: DraftExperience }` so `critiqueStep.inputSchema` (`draftSchema`) and the action's `result.draft` cast (`generate-draft-action.ts:320`) stay valid for BOTH `multiStepDraftWorkflow` (plan→skeleton→fill→critique→revise) and `quickDraftWorkflow` (plan→skeleton→fill). Do not emit a bare `{ blocks }` shape — it breaks both consumers.

**Patterns to follow:** existing step executors (L415–473) and `createStep` wrappers (L485–515); cost-budget test asserting `MAX_STEPS`.

**Test scenarios:**

- Covers AE1. Edge case: skeleton proposes section-inside-section → `validateSkeleton` rejects immediately. Assertion: a `vi.fn` spy on the fill executor shows zero calls AND a `[draft-workflow] event=skeleton_validation_failed` log is emitted; control comparison — a valid skeleton proceeds and the fill spy is called.
- Happy path: valid skeleton → sequential fill produces a `{ ...planFields, draft }` envelope whose `draft` passes `DraftExperienceSchema`.
- Edge case: skeleton with fewer than `GENERATION_MIN_BLOCKS` nodes is rejected pre-fill.
- Integration: update the hardcoded step-count assertions (`multi-step-draft-workflow.test.ts:96` `expect(MULTI_STEP_DRAFT_MAX_STEPS).toBe(...)` and the quick-draft equivalent) to the new counts; re-derive the `TOKEN_CAPS` sum comment (`budgets.ts:96-97`) and `TIME_BUDGET_MS.multiStepWorkflow` for the new step count + sequential fill fan-out; cost-budget test green.
- Integration: both `multiStepDraftWorkflow` and `quickDraftWorkflow` are updated symmetrically — a test asserts each ends on a `.draft`-carrying envelope.
- Edge case (sequential): fill order is deterministic and a later fill can reference earlier filled blocks.

**Verification:** A draft is produced via skeleton→validate→fill; an illegal skeleton never reaches the fill phase (fill spy zero calls); both workflows updated symmetrically and stay under their respective `MAX_STEPS`; token-cap sum and wall-clock budget re-derived.

---

### U4. Per-phase schema-constrained decoding (gated, with truncation guard)

**Goal:** Where a provider is verified to honor it, constrain decoding per phase (skeleton schema, flat fill schema) so off-shape output is prevented at the source — without the guarantee depending on it.

**Requirements:** R4, R5, R6

**Dependencies:** U3 (the per-phase `structuredOutput` opts hook into the skeleton/fill steps U3 creates; without U3 there are no per-phase schemas to constrain — but the final guarantee still holds via U5's free-text + coercion + repair path)

**Files:**

- Modify: `apps/admin/src/mastra/workflows/multi-step-draft-workflow.ts` — widen the local `MastraAgent.generate` type and `callAgent`'s `extraOpts.structuredOutput.schema` (L121–189) from `typeof DraftExperienceSchema` to a generic Zod schema so per-phase schemas can be threaded, AND add `finishReason?: string` to the local return type; extend `structuredDraftOutputEnabled()`/`STRUCTURED_DRAFT_OPTS` to apply the per-phase schema; thread `finishReason === "length"` → fail closed as `structurally_impossible`/`UPSTREAM_ERROR` (NOT into the repair loop)
- Modify: `apps/admin/src/config/env.ts` (+ `runtimeEnv` entry per the `env.ts:476-492` pattern) — add `AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED` as `z.enum(["true","false"]).optional().default("false")` in the AI-gateway block
- Test: `apps/admin/src/mastra/workflows/multi-step-draft-workflow.test.ts`, `apps/admin/src/config/env.test.ts`

**Approach:**

- Per-phase `structuredOutput: { schema }` passed only when the trusted flag is on for the active provider; otherwise free-text path (coercion+repair carry it). Guard truncation strictly on `finishReason === "length"` before parsing — `finishReason` is exposed synchronously on Mastra's `FullOutput` (`@mastra/core` `stream/base/output.d.ts`), typed `LanguageModelV2FinishReason | string` with `'length'` a real member, and is OPTIONAL, so guard on `=== "length"` only (never `!== "stop"`, which would spuriously fail closed on providers that omit it). A `length` finish is not repairable.

**Patterns to follow:** existing `structuredDraftOutputEnabled`/`STRUCTURED_DRAFT_OPTS`/`resolveDraft` seam; the env flag convention (`SEARCH_AUTH_REQUIRED` at `env.ts:154`).

**Test scenarios:**

- Covers AE2. Happy path (flag off / default): generation runs through the free-text + coercion + validator path and still yields a valid draft.
- Happy path (flag on): per-phase `structuredOutput` opts are passed to the agent.
- Error path: `finish_reason === "length"` → fails closed as non-repairable (NOT routed into the repair loop).
- Edge case: env flag absent → defaults to `"false"`; admin boots (no required-without-default var).

**Verification:** Default mode never depends on constrained decoding; flag toggles per-phase opts; truncation fails closed.

---

### U5. Validate→repair-with-error-feedback boundary loop (the fail-closed guarantee)

**Goal:** Wrap generation in a bounded repair loop that re-validates against `BlocksSchema` and never returns off-shape output — the layer that makes "never off-shape" true.

**Requirements:** R8, R9, R10, R13

**Dependencies:** U1, U2 (works on single-draft or two-phase generation)

**Files:**

- Modify: `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts` (wrap workflow-run + `normalizeExperienceDraft` + `BlocksSchema` in a bounded repair loop; on repair-eligible classified failure, re-prompt with concrete errors + bad output; budget under `withTimeout` ceiling)
- Create: a repair orchestration helper (e.g. `apps/admin/src/services/experience-ai/repair-draft.ts`) + `repair-draft.test.ts` (error classifier `malformed_syntax|schema_violation|structurally_impossible`; only `schema_violation` is repair-eligible)
- Modify: `apps/admin/src/config/env.ts` (+ `runtimeEnv`) — `EXPERIENCE_AI_MAX_REPAIR_ATTEMPTS` as `.optional()` with runtime default (e.g. 2)
- Modify: prompts in `apps/admin/src/mastra/prompts/` (a repair instruction taking serialized Zod errors)
- Test: `repair-draft.test.ts`, `generate-draft-action.test.ts`

**Approach:**

- Classify the failure (taxonomy below); for `schema_violation`, serialize the Zod/normalize errors + the offending output back into a repair re-prompt that calls a single agent via `getMastra().getAgentById(...).generate(...)` (NOT a workflow re-run — see Key Technical Decisions); cap attempts; each call timeout ≤ 30s and < remaining budget. After attempts exhausted (or a non-repairable class), fail closed with a classified editor message — never persist/show.
- **Error-class mapping (keys off U1's typed codes, never message regex):** `malformed_syntax` = JSON un-parseable after the U2/ladder path → fail closed; `schema_violation` = parses but fails `DraftExperienceSchema`/`BlocksSchema` (e.g. wrong discriminator, extra key, missing field) → repair-eligible; `structurally_impossible` = `ExperienceAiNormalizationError` `UNKNOWN_VIDEO_REF`/`UNKNOWN_SECTION_REF`/`DUPLICATE_SECTION_REF` (the model cannot invent a candidate that doesn't exist) and `finishReason === "length"` truncation → fail closed immediately, NOT repair-eligible.

**Patterns to follow:** `WorkflowStepError`/`classifyWorkflowError` typed-classification; `withTimeout` (L188); plain-string logging (`event=repair_attempt attempt=N zod_error_count=K`).

**Test scenarios:**

- Covers AE3. Error path: draft emits a storage key instead of an authoring ref → first validation fails, repair re-prompt with the specific error → repaired output validates (fail-then-pass; the repair branch is load-bearing).
- Covers AE3. Error path: `structurally_impossible` (ref to a non-existent candidate) → loop stops early, does NOT exhaust attempts.
- Covers AE4. Error path: attempts exhausted, output still off-shape → nothing persisted; action returns a classified failure (assert no persistence side-effect).
- Integration (end-to-end action test): mock the workflow to return three cases and assert the persistence contract — (a) clean valid output → persists via the existing chat-message path exactly once; (b) schema-invalid then repaired-valid → persists once; (c) schema-invalid + attempts exhausted → zero persistence side-effects, classified failure code returned. Guards against double-persist and against persisting off-shape output.
- Edge case: repair budget — initial-run + (repair × maxAttempts) stays under the 180s action ceiling; each call timeout ≤ 30s and < remaining (no outer-budget-fires-first retry storm).
- Edge case: `maxRepairAttempts` env absent → default applies; admin boots.

**Verification:** A drifted draft recovers via repair; a non-converging draft stops early; an unrepairable draft is never persisted/shown and yields a classified message.

---

### U6. Structural-validity smoke gate (asserts BlocksSchema; gates the trusted flag)

**Goal:** Extend the real-LLM smoke harness to assert the FULL guarantee (post-normalize `BlocksSchema` validity, not just `DraftExperienceSchema`) and provide the green gate that authorizes flipping the constrained-decoding-trusted flag (R6).

**Requirements:** R6, R10 (verification)

**Dependencies:** U3, U4, U5

**Files:**

- Modify: `apps/admin/src/scripts/smoke-mastra-draft-workflow.ts` (after the workflow run, call `normalizeExperienceDraft` + assert `BlocksSchema`; report per-prompt first-pass / recovered / failed)
- Modify: `apps/admin/package.json` if a sibling script (e.g. `smoke:draft-structural`) is warranted
- Modify: doc note for the gateway-verification procedure (in the plan/CLAUDE.md addendum, not code)

**Approach:**

- Run over the existing prompt set; classify each outcome (first-pass-valid / recovered-after-repair / terminal-fail) and exit non-zero on any terminal fail. The same harness, run with the constrained-decoding flag on against a provider, is the gate that authorizes trusting that provider.

**Patterns to follow:** existing `smoke-mastra-draft-workflow.ts` structure and `TIME_BUDGET_MS.multiStepWorkflow`.

**Test scenarios:**

- Test expectation: none (smoke harness is itself the test surface). The harness asserts: every prompt's final output passes `BlocksSchema` post-normalize; the summary reports the first-pass/recovered/terminal split.

**Verification:** Smoke run is green (zero terminal fails) on the default provider; the trusted flag is only flipped after a green run with constrained decoding on.

---

## System-Wide Impact

- **Interaction graph:** Entry is the `generateDraftAction` server action → `runGenerateDraftAction` → embedded Mastra workflow → `normalizeExperienceDraft`. No GraphQL/Pothos surface. Editor consumes `result.error` at `experience-chat-panel.tsx` (~L990).
- **Error propagation:** All generation/normalize/repair failures become typed codes classified at the action; `UNKNOWN` reserved + logged. Editor shows `USER_MESSAGES` copy.
- **State lifecycle risks:** The repair loop must not double-persist; persistence happens only on success after the boundary validator passes. Confirm the existing chat-message persistence (L335–406) runs once per successful run.
- **API surface parity:** The `quick-draft` workflow shares steps — apply skeleton/fill + max-steps updates consistently to both `multiStepDraftWorkflow` and `quickDraftWorkflow`.
- **Integration coverage:** End-to-end action test that drives a mocked workflow returning (a) clean, (b) repair-then-valid, (c) unrepairable output and asserts persist/fail-closed behavior.
- **Unchanged invariants:** `BlocksSchema` block-type set and the public/persistence contract are unchanged; manual experiences are unaffected; the playable-candidate filter (`PLAYABLE_CANDIDATE_VIDEO_WHERE`) stays the upstream defense for streamingUrl.

---

## Risks & Dependencies

| Risk                                                                              | Mitigation                                                                                                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Two-phase rebuild (U3) is the largest change and could regress generation quality | U5 guarantee is decoupled and lands independently; smoke gate (U6) asserts BlocksSchema validity across prompts before trusting the path               |
| Repair loop loops on non-converging failures, burning budget                      | Classify failures; only `schema_violation` is repair-eligible; cap attempts + wall-clock; `structurally_impossible`/truncation fail closed immediately |
| New env flag bricks Railway deploy                                                | All new flags `.optional()`/`.default("false")` with runtime fallback; no required-without-default var                                                 |
| Telemetry invisible in production                                                 | Plain-string `[label] event=... key=value` logs in the server-action path, never `JSON.stringify`                                                      |
| Gateway constrained decoding silently under-constrains                            | Trusted only behind a flag flipped after a green BlocksSchema smoke gate; default provider path never depends on it                                    |
| Nested timeouts cause retry storms                                                | skeleton+fill+(repair×N) budgeted under the action ceiling; per-call timeout strictly under remaining budget                                           |

---

## Documentation / Operational Notes

- After landing, run `ce:compound` to capture the "constrained-decode → coerce → validate → repair" layered-guarantee pattern under `docs/solutions/architecture-patterns/`.
- Operational: the constrained-decoding-trusted flag stays `false` until a green smoke run with it on; document the verification step alongside the existing `smoke:draft-workflow` runbook.
- Update `apps/admin/CLAUDE.md` (experience-ai section) with the new layered-validity model and the smoke-gate procedure.

---

## Sources & References

- **Origin document:** docs/brainstorms/2026-06-15-ai-experience-generation-structural-validity-requirements.md
- Generator: `apps/admin/src/mastra/workflows/multi-step-draft-workflow.ts`, `apps/admin/src/services/experience-ai/experience-ai-normalize.ts`, `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts`
- Schemas: `apps/admin/src/services/experience-ai/experience-ai.schemas.ts`, `apps/admin/src/domain/blocks.ts`
- Smoke: `apps/admin/src/scripts/smoke-mastra-draft-workflow.ts`
- Learnings: see Context & Research → Institutional Learnings
