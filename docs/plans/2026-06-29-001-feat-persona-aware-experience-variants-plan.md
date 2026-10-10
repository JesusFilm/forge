---
title: "feat: Persona-aware experience variant generation (v1)"
type: feat
status: active
date: 2026-06-29
origin: docs/brainstorms/2026-06-29-persona-aware-experience-variant-generation-requirements.md
deepened: 2026-06-29
---

# feat: Persona-aware experience variant generation (v1)

## Summary

**v1 is a generation proof slice.** It adds a Mastra-owned persona library and persona-threaded variant generation, triggered by an operator script: give a topic + a set of persona ids, and it generates one tailored experience per persona (reusing the existing `multi-step-draft` pipeline with the persona threaded into the prompts), re-validates each through the existing block-schema gate, and stages each as a plain experience the editor reviews and publishes in the existing dashboard. No new schema, no UI, no structured critique — those are Phase B, layered on only once the generation is proven worth it.

The point of v1 is to answer one question cheaply: **do persona-tailored variants actually generate well and differ usefully?**

---

## Problem Frame

The same gospel topic lands differently for a grieving skeptic, a new believer, or a family — but today's generator produces one generic page and editors re-frame by hand, with no structured notion of audience anywhere in the system. See origin for the full pain narrative and product decisions (`docs/brainstorms/2026-06-29-persona-aware-experience-variant-generation-requirements.md`).

---

## Requirements

v1 (this plan) advances the core generation requirements; the audience-fit, grouping, and editor-UX requirements are carried but deferred to Phase B (see Scope Boundaries).

- R1. Curated persona library, owned by Mastra, reusable by the generator and future features. _(v1)_
- R2. Given a topic + selected personas, produce one tailored experience per persona. _(v1)_
- R3. All variants for a topic share the same grounded facts but diverge in framing/scripture/questions. _(v1)_
- R5. Build on the existing quality pipeline; persona steers generation. _(v1 — persona-threading; the persona-fit critique is Phase B)_
- R9. Each persona definition carries: name, tone, needs, scripture posture, emotional goal, faith-stage, cultural context. _(v1)_
- R10. The persona roster is data (editable without a code change); ship a starter roster placeholder. _(v1)_
- R11. Generated variants pass the same block-schema validation gate as the existing generator. _(v1)_
- R13. Mastra owns persona library + variant generation; admin is a thin caller; web owns rendering. Mastra never owns experience data. _(v1)_
- R4. Editors select topic + personas, review, edit, and publish from admin. _(Phase B — v1 triggers via script; editor reviews/publishes generated experiences in the existing dashboard)_
- R6. Persona-fit critique surfaces named audience-fit risk labels. _(Phase B)_
- R7. Each published variant is its own page with its own URL. _(v1 — each variant is a plain experience with its own slug; the grouping that links them is Phase B)_
- R8. Each variant carries an editor-facing "how this lands" note. _(Phase B)_
- R12. Variants grouped under one logical topic, routable later. _(Phase B)_

**Origin actors:** A1 (content editor), A2 (Mastra generation engine), A3 (ministry/content lead), A4 (watch-site visitor).
**Origin flows:** F1 (generate persona variants — v1), F2 (review/publish/share — v1 via existing dashboard), F3 (maintain persona library — v1).
**Origin acceptance examples:** AE1 (covers R2, R3 — v1), AE4 (covers R11 — v1); AE2 (R6/R8) and AE3-grouping (R12) are Phase B.

---

## Scope Boundaries

### Deferred for later

- Automatic audience-routing on the public site (signal/A-B).
- Visitor-signal capture; per-variant performance analytics.
- Editor-side AI-chat "User Mind Reader" upgrades.
- Persona × locale/translation interaction.

### Outside this product's identity

- A personal communication assistant (email/recipe/"write to my supervisor"). "Audience" = the ministry's audience, never the editor's personal correspondents.
- Adopting a generic ten-layer content-pipeline architecture; we extend the existing Mastra → admin → web split.
- Real-time per-visitor personalization.

### Deferred to Follow-Up Work (Phase B — after v1 proves generation)

These were active units in the first draft of this plan; the lean v1 defers them. They keep their U-IDs and are sketched (not fully specified) below under "Phase B units."

- **U9. Persona-fit critique** (structured audience-fit risk labels + "how this lands" note) and **U2. shared audience-fit schema** — the "audience mind reader" overlay. Deferred because it's a quality/safety layer on top of generation, not the generation itself.
- **U6. Grouping entity + per-variant metadata** (`ExperienceGroup`, `groupId`, `personaKey`, note/labels) — needed for "managed together + routable later," not for proving generation. v1 variants are plain experiences with descriptive slugs.
- **U8. Editor picker + variant-review UI** (+ the `/forge-personas` list route) — v1 triggers via an operator script and reviews in the existing dashboard; the dedicated UI is the payoff once generation quality is proven.

---

## Context & Research

### Relevant Code and Patterns

- **Generation pipeline (extend):** `apps/mastra/src/mastra/workflows/multi-step-draft.ts` (`multiStepDraftWorkflow`, exported step executors, `WorkflowStepError`), `apps/mastra/src/mastra/workflows/experience-draft-route.ts` (`ExperienceDraftRequestSchema`, `{ ok | reason | retryable }` envelope, `AbortSignal.timeout(TIME_BUDGET_MS.multiStepWorkflow=180s)`, `statusForResult`). Registration seam: the `agents`/`workflows` maps + `registerApiRoute(...)` in `apps/mastra/src/mastra/index.ts`.
- **Prompt builders + model (extend):** `apps/mastra/src/mastra/agents/specialized-agents.ts` (`buildSpecializedAgents`, `resolveAgentModel`), prompt registry `apps/mastra/src/mastra/prompts/`.
- **Mastra-owned structured data (pattern for the persona library):** `apps/mastra/src/config/languages/ja.json` + loader `apps/mastra/src/services/subtitle-enrichment/language-config.ts` (committed JSON + cached `import()` loader); versioned dataset `apps/mastra/src/services/offline-search-eval/seed-prompt-set.ts`.
- **Admin caller (extend) + transport template:** `apps/admin/src/app/dashboard/experiences/generate-draft-action.ts` (flag gate, `config_missing` degrade, `loadExperienceAiVideoCandidates`, normalize gate); `apps/admin/src/services/experience-ai/mastra-experience-section-client.ts` (`node:http` `postViaNode`, `resolveTimeoutMs`); block gate `apps/admin/src/services/experience-ai/experience-ai-normalize.ts` (`normalizeExperienceDraft`).
- **Persistence (reuse):** `apps/admin/src/services/experience.service.ts` (`create`/`createLocale`/`publishLocale`). v1 needs no schema change — each variant is one `Experience` + one `ExperienceLocale` via the existing path.
- **Operator-script pattern (follow for the v1 trigger):** `apps/admin/src/scripts/seed-experience.ts`, `apps/admin/src/scripts/apply-experience-from-json.ts`, and the `run-embeds` CLI shape — prod-URL guard, `import { prisma }`, `tsx` invocation.
- **Shared contract:** `packages/experience-schema/src/experience-ai.schemas.ts` (`DraftExperienceSchema`, `GENERATION_MIN_BLOCKS`).
- **Fan-out pattern (reuse):** admin's embedding backfills use `pLimit(env.X ?? DEFAULT) + Promise.allSettled`.

### Institutional Learnings

- `docs/solutions/runtime-errors/mastra-launch-timeout-env-string-network-error.md` — t3-env `skipValidation` drops Zod number defaults → `setTimeout(undefined)` throws a 1ms fake network error. Normalize env timeouts at the boundary; regression-test with a numeric **string**.
- `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md` — size the budget chain top-down: trigger per-call timeout > Mastra workflow (180s) > inner call.
- `docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md` + `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md` — N-variant fan-out is `pLimit + Promise.allSettled`, never bare `Promise.all`; one variant's failure must not abort the batch; classify on typed `instanceof`/`code`, never regex; concurrency default below the shared budget.
- `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md` — new flag/URL/key is `.optional()` + runtime `config_missing` degrade; add an env-import-with-var-unset test.
- `docs/solutions/conventions/single-service-http-client-result-union-convention.md` — new clients are typed no-throw unions with `config_missing` short-circuit, injectable `fetchImpl`, `redirect:"error"`; never log raw upstream reasons.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — persona-threaded generation needs a real-LLM smoke (catalog membership ≠ live-served).
- `docs/solutions/tooling-decisions/mastra-dev-tsx-loader-for-raw-ts-workspace-deps.md` — relevant only if Phase B adds multi-file schema to `packages/experience-schema/`; not triggered by lean v1.
- Consolidation pattern lives in `apps/admin/CLAUDE.md` ("Experience draft/chat — standalone Mastra consolidation") + `docs/plans/2026-06-19-001-feat-mastra-admin-to-standalone-consolidation-plan.md`; consider `/ce-compound`-ing it after this lands.

---

## Key Technical Decisions

- **v1 is a generation proof slice, script-triggered.** The smallest thing that proves the bet is generation, not management. Trigger via an operator script (the `seed-experience`/`run-embeds` pattern), review generated experiences in the existing dashboard. Defers the editor UI, the structured persona-fit critique, and the grouping schema to Phase B. Rationale: prove persona-tailored generation is good and differentiated before investing in the surfaces around it.
- **Generation topology: N independent per-persona calls.** The script loads candidates once, then fans out one generation call per persona under bounded concurrency. Mastra owns each per-variant generation; the script owns the fan-out + persistence. Each call stays inside the existing 180s budget. Rejected: a single N-variant route (new budget model + concentrates rate-limit risk).
- **Personas steer the prompt, not the output contract.** All variants emit the same `DraftExperienceSchema`, so the existing block-schema gate validates every variant for free (R11/AE4). "Shared facts, divergent framing" (R3) is structural: every persona call gets the **same topic + same candidates**; only the persona differs.
- **Persona library stays Mastra-owned.** Committed JSON + cached loader (the `config/languages` pattern). The script sends persona **ids**; Mastra resolves the full definition. v1 needs no persona-list route (that's for the Phase B picker).
- **No new schema in v1.** Each variant is a plain `Experience` + `ExperienceLocale` with its own descriptive slug (e.g. `easter-grieving`), reusing the existing create/publish path. Grouping (`ExperienceGroup`), persona attribution, and the audience-fit note/labels are additive Phase B columns.
- **Reuse `MASTRA_SERVICE_API_KEYS`.** Same service → no new credential, no receiver-first deploy ordering. New admin envs (`EXPERIENCE_AI_REMOTE_VARIANTS` + any `MASTRA_VARIANTS_*`) are `.optional()` + `config_missing` degrade.
- **`node:http` transport, not `fetch`.** Copy `mastra-experience-section-client.ts` to dodge the Next-patched-fetch-over-Railway-private-net failure; guard env timeouts with `resolveTimeoutMs`.

---

## Open Questions

### Resolved During Planning

- Generation topology → N independent calls, script-orchestrated.
- v1 trigger → operator script (defer UI).
- Grouping / critique / metadata → Phase B (not needed to prove generation).
- New credential? → No; reuse `MASTRA_SERVICE_API_KEYS`.

### Deferred to Implementation

- Default fan-out concurrency value — tune against the shared AI-gateway/OpenRouter + Prisma budget during U7.
- Exact persona-block prompt shape (how the persona definition is rendered into the plan/skeleton/fill prompts) — settle when wiring U3 against real output.
- Whether the script writes staged (DRAFT) or published experiences — default to DRAFT so the editor reviews before publishing.

---

## Implementation Units (lean v1)

### U1. Persona library (Mastra-owned)

**Goal:** A committed, versioned, editable-as-data persona roster with a typed loader.

**Requirements:** R1, R9, R10.

**Dependencies:** None.

**Files:**

- Create: `apps/mastra/src/config/personas/` (committed roster — one JSON per persona or a single versioned module)
- Create: `apps/mastra/src/services/persona/persona-library.ts` (`PersonaSchema`, `loadPersona(id)`, module-level cache)
- Test: `apps/mastra/src/services/persona/persona-library.test.ts`

**Approach:** Mirror `apps/mastra/src/services/subtitle-enrichment/language-config.ts` (cached loader, graceful `undefined`) and the versioned shape of `seed-prompt-set.ts`. `PersonaSchema` carries the R9 fields + a stable `id`. Ship a starter roster (seeker/skeptic, grieving, new believer, family/kids, seasoned believer), clearly marked as a placeholder pending ministry confirmation.

**Patterns to follow:** `language-config.ts`; `seed-prompt-set.ts`.

**Test scenarios:**

- Happy path: `loadPersona("grieving")` returns a definition satisfying `PersonaSchema`.
- Edge case: `loadPersona("unknown")` returns `undefined` (no throw).
- Edge case: every committed roster entry validates against `PersonaSchema`.

**Verification:** Loader returns typed personas; the full starter roster validates.

---

### U3. Persona-threaded generation

**Goal:** Make the existing draft pipeline persona-aware by threading a persona definition into its prompts.

**Requirements:** R3, R5, R9.

**Dependencies:** U1.

**Files:**

- Modify: `apps/mastra/src/mastra/agents/specialized-agents.ts` (thread an optional persona block into the plan/skeleton/fill prompt builders)
- Modify (as needed): `apps/mastra/src/mastra/prompts/` builders that assemble the generation prompts
- Test: `apps/mastra/src/mastra/agents/specialized-agents.test.ts` (or colocated)

**Approach:** Pass the persona definition (from U1) into the existing multi-step prompt builders so content is persona-shaped. Do NOT change the output contract (`DraftExperienceSchema` unchanged). The structured persona-fit critique is deferred (U9); v1 relies on persona-threading alone to differentiate variants.

**Execution note:** Add a real-LLM smoke comparing two personas over the same topic+candidates to confirm the outputs genuinely diverge.

**Patterns to follow:** existing prompt builders + `resolveAgentModel`.

**Test scenarios:**

- Covers AE1. Two different personas over the same topic + candidates produce drafts that differ in framing/scripture/questions.
- Happy path: a persona-threaded generation still produces a draft valid against `DraftExperienceSchema`.
- Edge case: with no persona supplied, generation behaves exactly as today (no regression to the existing draft path).

**Verification:** Persona-threaded prompts produce persona-shaped, schema-valid copy; the no-persona path is unchanged.

---

### U4. Per-persona variant route (Mastra)

**Goal:** A bearer-gated route that generates one variant for a topic + persona.

**Requirements:** R2, R5, R13.

**Dependencies:** U1, U3.

**Files:**

- Create: `apps/mastra/src/mastra/workflows/experience-variant-route.ts` (request `{ topic/prompt, locale, candidates, exemplar?, personaId }`; discriminated `{ ok, draft, personaId } | { ok:false, reason, retryable }` envelope; internal timeout)
- Modify: `apps/mastra/src/mastra/index.ts` (register `/forge-experience-variant`; register any new workflow in the maps)
- Test: `apps/mastra/src/mastra/workflows/experience-variant-route.test.ts`

**Approach:** Mirror `experience-draft-route.ts` (bearer → parse → run-with-internal-timeout → discriminated envelope). Resolve the persona via U1, run the U3 persona-threaded generation reusing the `multi-step-draft` step executors (extract a plain service helper rather than `start()`-ing a sibling workflow). Reuse `MASTRA_SERVICE_API_KEYS` + `isValidServiceBearer`. No persona-list route in v1.

**Patterns to follow:** `experience-draft-route.ts`; the `getMastra` thunk registration seam; `workflow-step-body-calls-service` learning.

**Test scenarios:**

- Happy path: valid `{ topic, personaId, candidates }` → `{ ok:true, draft, personaId }` (200).
- Error path: missing/invalid bearer → 401.
- Error path: invalid input → `reason:"invalid_input"` (400).
- Error path: generation timeout → `reason:"timeout"` retryable (504); inner budget < route budget.
- Error path: unknown `personaId` → typed `invalid_input` (no throw).

**Verification:** Route responds under bearer; envelope matches the contract; timeouts return the typed retryable reason.

---

### U5. Persona-variant launch client (admin)

**Goal:** A typed no-throw client that calls the Mastra variant route.

**Requirements:** R2, R13.

**Dependencies:** U4.

**Files:**

- Create: `apps/admin/src/services/experience-ai/mastra-experience-variant-client.ts`
- Modify: `apps/admin/src/config/env.ts` (`EXPERIENCE_AI_REMOTE_VARIANTS` + any `MASTRA_VARIANTS_*` overrides, all `.optional()`)
- Test: `apps/admin/src/services/experience-ai/mastra-experience-variant-client.test.ts`

**Approach:** Copy the `node:http` transport from `mastra-experience-section-client.ts` (`postViaNode`, `resolveTimeoutMs`); `config_missing` short-circuit when base URL/key unset; re-validate the returned `draft` against `DraftExperienceSchema`; typed failure union; never log raw upstream reasons. Per-call timeout sized above Mastra's inner budget.

**Patterns to follow:** `mastra-experience-section-client.ts`; single-service-http-client-result-union convention.

**Test scenarios:**

- Happy path: a 200 with a valid variant → `{ ok:true, draft }`.
- Edge case: base URL/key unset → `config_missing` (no throw).
- Error path: numeric-string timeout env (`"75000"`) is coerced, not passed raw to a timer.
- Error path: malformed `draft` in the response → typed parse failure (no throw).
- Error path: non-2xx → typed failure; raw reason not logged.

**Verification:** Client degrades cleanly when unconfigured; coerces env timeouts; returns typed results for success and every failure mode.

---

### U7. Operator script: topic + personas → N staged experiences

**Goal:** A script that generates persona variants for a topic and stages them as plain experiences for review.

**Requirements:** R2, R3, R7, R11.

**Dependencies:** U5.

**Files:**

- Create: `apps/admin/src/scripts/generate-persona-variants.ts`
- Test: `apps/admin/src/scripts/generate-persona-variants.test.ts` (fan-out + gate behavior with an injected client)

**Approach:** Mirror `apps/admin/src/scripts/seed-experience.ts` (prod-URL guard, `import { prisma }`, `tsx` invocation). Take `--topic` + repeated `--persona` ids. Load video candidates once; fan out one U5 client call per persona with `pLimit(concurrency) + Promise.allSettled` (never `Promise.all`); run each result through `normalizeExperienceDraft` (R11 gate, AE4); create one `Experience` + one `ExperienceLocale` per variant (status DRAFT, descriptive slug like `<topic>-<persona>`) via `ExperienceService`. Print a per-persona outcome summary (succeeded/failed) plus the dashboard URLs for review. One persona's failure must not drop the others.

**Execution note:** Start from a failing test for the fan-out contract (N personas → N outcomes; one failure doesn't drop the others; `observedMaxInFlight` ≤ cap).

**Patterns to follow:** `seed-experience.ts`, `apply-experience-from-json.ts`, the `run-embeds` fan-out; admin's `pLimit + Promise.allSettled` backfill pattern.

**Test scenarios:**

- Covers AE1. 3 personas + topic → 3 staged DRAFT experiences sharing candidates, differing in framing.
- Covers AE4. A variant with an invalid block is rejected by `normalizeExperienceDraft` and not persisted; the others still persist.
- Error path (robustness): one persona's generation fails → the others still persist; the failure is reported per-persona.
- Edge case: `observedMaxInFlight` never exceeds the concurrency cap (exact assertion).
- Edge case: prod-like `DATABASE_URL` is refused (guard).

**Verification:** Running the script on a topic + personas stages N reviewable DRAFT experiences in the local/admin dashboard; partial failures degrade gracefully; the block gate holds.

---

## Phase B units (deferred — sketched, not specified)

> Pulled out of lean v1. Build only after v1 shows persona-tailored generation is good and differentiated. U-IDs preserved.

### U9. Persona-fit critique + U2. shared audience-fit schema _(deferred)_

A structured persona-fit critic (new Mastra prompt + agent) emitting `{ riskLabels[], howThisLands }`, single-sourced via a shared `AudienceFitSchema` in `@forge/experience-schema`. Surfaces R6/R8/AE2. Adds the "audience mind reader" overlay on top of generation.

### U6. Grouping entity + per-variant metadata _(deferred)_

Additive Prisma migration: `ExperienceGroup` + `Experience.groupId`; `ExperienceLocale.personaKey` + `audienceFitNote` + `audienceFitRisks`. Service helpers to create a group + grouped variants. Delivers R12/R8 and AE3-grouping; the foundation later auto-routing selects among.

### U8. Editor picker + variant-review UI _(deferred)_

Topic + persona multi-select (sourced from a new `/forge-personas` list route), trigger, and a review surface showing each variant with its audience-fit note/labels. Replaces the v1 script trigger; delivers R4 as a first-class editor flow.

---

## System-Wide Impact

- **Interaction graph:** new script → new admin client → new Mastra route → persona library + multi-step pipeline; persistence reuses `ExperienceService` (publish still fires the existing revalidate webhook + manifest refresh per variant). No existing route or read is modified.
- **Error propagation:** Mastra returns typed `{ ok:false, reason, retryable }`; the client maps to a typed union; the script reports per-persona outcomes; one persona's failure never aborts the batch.
- **State lifecycle risks:** variants stage as DRAFT; the editor publishes individually (existing path). No new persistent state in v1.
- **API surface parity:** the new `/forge-experience-variant` route reuses the existing bearer + envelope conventions; existing draft/section/chat routes untouched.
- **Unchanged invariants:** existing single-draft/section/chat generation, `DraftExperienceSchema`, `normalizeExperienceDraft`, the experience schema, and all experience reads are untouched. Personas steer prompts only; with no persona, behavior is identical to today.

---

## Risks & Dependencies

| Risk                                                             | Mitigation                                                                                                                                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N parallel LLM calls hit AI-gateway / OpenRouter rate limits     | Bounded concurrency (`pLimit`) below the shared budget; per-persona failures isolated via `Promise.allSettled`                                                    |
| Ministry persona roster not yet confirmed (origin's one blocker) | Ship a committed starter roster as a clearly-marked placeholder (R10) — unblocks v1; swap content when ministry confirms                                          |
| Variants don't differ enough (persona-threading alone is weak)   | The U3 real-LLM smoke explicitly checks two personas diverge; if weak, the Phase B persona-fit critique + a revise loop is the lever — but prove generation first |
| Variants drift factually across audiences (R3)                   | Same topic + same candidates fed to every persona; only the persona steers — shared grounding is structural                                                       |
| t3-env `skipValidation` drops the new timeout/flag defaults      | Normalize env timeouts at the boundary (`resolveTimeoutMs`); numeric-string regression test; new vars `.optional()` + `config_missing` degrade                    |

---

## Phased Delivery

### v1 — Generation proof slice (U1, U3, U4, U5, U7)

Persona library, persona-threaded generation, the variant route, the admin client, and the operator script. Operator runs the script with a topic + personas → reviews staged DRAFT experiences in the existing dashboard. No schema, no UI, no critique. Answers: _do persona variants generate well and differ usefully?_

### Phase B — Productize (U9/U2, U6, U8) — only if v1 proves out

The structured persona-fit critique, the grouping/metadata schema, and the editor picker + review UI. Then (later, already deferred) public-site auto-routing.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-06-29-persona-aware-experience-variant-generation-requirements.md`
- Consolidation reference: `apps/admin/CLAUDE.md` ("Experience draft/chat — standalone Mastra consolidation"), `docs/plans/2026-06-19-001-feat-mastra-admin-to-standalone-consolidation-plan.md`
- Operator-script pattern: `apps/admin/src/scripts/seed-experience.ts`, `apps/admin/src/scripts/apply-experience-from-json.ts`
- Key learnings: `docs/solutions/runtime-errors/mastra-launch-timeout-env-string-network-error.md`, `docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md`, `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`, `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
