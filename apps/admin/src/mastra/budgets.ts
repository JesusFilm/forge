/**
 * Cost budgets for Mastra agents and workflows (U11).
 *
 * Per-shape token / step / time caps. Agents and workflows read
 * these constants at construction time (or at invocation, when the
 * call-site needs a tighter ceiling than the default).
 *
 * Defaults are conservative and tuned for typical editor turns. Per
 * the institutional learning on optional scaffolding env vars
 * (`docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`),
 * env overrides are `.optional()` and the constants below remain
 * the runtime defaults.
 *
 * Time budgets are AbortSignal-friendly — call sites wrap their
 * invocations with `AbortSignal.timeout(budgetMs)` so the upstream
 * route can classify the eventual rejection as `timeout` via the
 * streaming bridge (see classifyError in streaming-bridge.ts).
 */

/**
 * Token caps — `maxOutputTokens` for each agent's model invocation.
 * Aligned to the agent's job:
 *   - Draft: up to ~4k for a full Experience envelope
 *   - Add-section: ~1.5k for a single-section addition
 *   - Rewrite-copy: ~1k for narrow text edits
 *   - Auto-enrich: ~3k for a full enriched blocks array
 *
 * Multi-step draft workflow caps (per-step `maxOutputTokens` passed
 * to `agent.generate({ maxOutputTokens })` inside each workflow
 * step's `execute` body — see
 * `src/mastra/workflows/multi-step-draft-workflow.ts`). Split sums
 * to 11_000 (1500 + 4000 + 1500 + 4000) ≈ 2.75× the single-call
 * draftExperience ceiling, within the brainstorm's ~4× envelope.
 */
export const TOKEN_CAPS = {
  draftExperience: 4_000,
  addSection: 1_500,
  rewriteCopy: 1_000,
  autoEnrich: 3_000,
  /**
   * Plan step (`experience-planner` agent). Cheap planning outline —
   * 2-5 sentences. Consumed by the workflow's plan step `execute`
   * body via `agent.generate({ maxOutputTokens })`.
   */
  multiStepDraftPlan: 1_500,
  /**
   * Draft step (`draft-experience` agent). Full Experience envelope
   * emission — matches the single-call draftExperience ceiling.
   * Consumed by the workflow's draft step `execute` body via
   * `agent.generate({ maxOutputTokens })`.
   */
  multiStepDraftDraft: 4_000,
  /**
   * Critique step (`experience-critic` agent). Reasoning notes over
   * a structured draft (3-6 bullet revision notes) — cheaper than
   * draft emission. Consumed by the workflow's critique step
   * `execute` body via `agent.generate({ maxOutputTokens })`.
   */
  multiStepDraftCritique: 1_500,
  /**
   * Revise step (`experience-reviser` agent). Full re-emission of
   * the draft envelope after applying critique notes — same shape
   * as draft. Consumed by the workflow's revise step `execute`
   * body via `agent.generate({ maxOutputTokens })`.
   */
  multiStepDraftRevise: 4_000,
} as const

/**
 * Step caps — `maxSteps` ceiling for tool-calling agents. The
 * multi-step workflow's cap is structural (chain length, 4); this
 * cap governs per-turn tool-call recursion on single-pass agents.
 */
export const STEP_CAPS = {
  /** Tool-calling agent ceiling on tool-call recursion per turn. */
  toolCallingTurn: 8,
  /** Multi-step workflow chain length (informational; structural). */
  multiStepDraft: 4,
} as const

/**
 * Time budgets — wall-clock ceilings on agent and workflow runs.
 * Call sites wrap with `AbortSignal.timeout(ms)`. The streaming
 * bridge classifies the resulting AbortError as `timeout`.
 */
export const TIME_BUDGET_MS = {
  /** Single-turn chat (draft / add-section / rewrite-copy). */
  chatTurn: 30_000,
  /**
   * Multi-step workflow's full chain (plan → draft → critique →
   * revise) — wall-clock cap. The action layer
   * (`generate-draft-action.ts`) is responsible for wrapping
   * `multiStepDraftWorkflow.createRun().start({ signal })` with
   * `AbortSignal.timeout(TIME_BUDGET_MS.multiStepWorkflow)` so the
   * upstream Server Action classifies the abort as `timeout`. The
   * per-step `maxOutputTokens` sum across the four steps is 11_000
   * (1500 + 4000 + 1500 + 4000) — see `TOKEN_CAPS.multiStepDraft*`.
   *
   * Sized at 3 minutes after live smoke runs: four sequential
   * OpenRouter free-model calls (planner / drafter / critic /
   * reviser) measured 50-90s end-to-end on a representative prompt.
   * The original plan guessed 60s based on chat-turn latency; that
   * proved too tight — runs hit the cap and surfaced as UPSTREAM_ERROR
   * even though the workflow itself was producing valid drafts.
   */
  multiStepWorkflow: 180_000,
  /** Background auto-enrich agent's full run on one experience locale. */
  backgroundAutoEnrich: 300_000,
} as const

/**
 * Convenience accessor — return the time budget for a named shape.
 * Used by U6+ call sites to wrap invocations uniformly.
 */
export type BudgetShape = keyof typeof TIME_BUDGET_MS

export function getTimeBudgetMs(shape: BudgetShape): number {
  return TIME_BUDGET_MS[shape]
}
