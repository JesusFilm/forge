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
 * route can classify the eventual rejection as `timeout` (the chat
 * service's `runMastraChat` and the draft action do this directly).
 */

/**
 * Token caps — `maxOutputTokens` for each agent's model invocation.
 * Aligned to the agent's job:
 *   - Draft: up to ~4k for a full Experience envelope
 *   - Add-section: ~1.5k for a single-section addition
 *   - Rewrite-copy: ~1k for narrow text edits
 *   - Auto-enrich: ~3k for a full enriched blocks array
 *
 * Two-phase draft workflow caps (per-step `maxOutputTokens` passed
 * to `agent.generate({ maxOutputTokens })` inside each workflow
 * step's `execute` body — see
 * `src/mastra/workflows/multi-step-draft-workflow.ts`). The U3 rebuild
 * replaced the single ~4k draft step with a tiny skeleton step plus a
 * sequence of small per-block fill calls. The non-fill caps sum to
 * 8_500 (plan 1500 + skeleton 1500 + critique 1500 + revise 4000). The
 * fill step makes ONE call per fillable skeleton node at
 * `multiStepDraftFill` (1500) each; for a representative 8-block page
 * that adds ~12_000, for a worked total of ~20_500 across the chain —
 * higher head-count than the old single-shot 4k draft, but each call is
 * a tiny, reliable single-block fill rather than one fragile ~17-variant
 * emission, which is the whole point of the two-phase rebuild (the
 * structural guarantee, not raw token thrift). Quick-draft
 * (plan→skeleton→fill) sums to 3000 + (1500 × fills).
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
   * Legacy single-shot draft step (`draft-experience` agent). Retained
   * after the U3 two-phase rebuild because `executeDraftStep` is still
   * exported (and unit-tested) even though neither workflow chains it —
   * the skeleton/fill steps replaced it in the `.then()` chains. Matches
   * the single-call draftExperience ceiling.
   */
  multiStepDraftDraft: 4_000,
  /**
   * Skeleton step (`experience-skeleton` agent — U3). Structure-only
   * block tree (types/order/nesting, no content) — a tiny JSON
   * envelope. Consumed by the workflow's skeleton step `execute` body
   * via `agent.generate({ maxOutputTokens })`.
   */
  multiStepDraftSkeleton: 1_500,
  /**
   * Fill step (`experience-fill` agent — U3). Per-block cap: ONE call
   * per fillable skeleton node, each emitting a single flat block
   * object. Sized for the largest single-block content (a videoHero or
   * a multi-quote bibleQuotesCarousel) plus tool round-trips. Consumed
   * once per node inside the fill step's sequential loop.
   */
  multiStepDraftFill: 1_500,
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
 * multi-step workflow's cap is structural (chain length, 5 after the
 * U3 two-phase rebuild: plan → skeleton → fill → critique → revise);
 * this cap governs per-turn tool-call recursion on single-pass agents.
 */
export const STEP_CAPS = {
  /** Tool-calling agent ceiling on tool-call recursion per turn. */
  toolCallingTurn: 8,
  /** Multi-step workflow chain length (informational; structural). */
  multiStepDraft: 5,
} as const

/**
 * Time budgets — wall-clock ceilings on agent and workflow runs.
 * Call sites wrap with `AbortSignal.timeout(ms)`. The streaming
 * bridge classifies the resulting AbortError as `timeout`.
 */
export const TIME_BUDGET_MS = {
  /**
   * Single-turn chat (draft / add-section / rewrite-copy).
   *
   * A from-scratch full-Experience draft on the production gateway
   * model ("coding"/Qwen) measures ~37-45s end to end (tool round-trips
   * + a ~3k-token envelope emission). The previous 30s ceiling aborted
   * generate() mid-emission; because the AI SDK RESOLVES an aborted
   * generate() with empty text (it does not reject), the chat path then
   * misreported the empty completion as "agent returned text without a
   * JSON object" / DRAFT REJECTED (see the abort guard in
   * `experience-ai-chat.service.ts`). 90s clears the observed draft
   * time with headroom while staying under the ~100s Cloudflare 524
   * proxy ceiling that fronts admin. Add-section / rewrite-copy turns
   * are much faster and finish well inside this budget.
   */
  chatTurn: 90_000,
  /**
   * Multi-step workflow's full chain (plan → skeleton → fill →
   * critique → revise after the U3 two-phase rebuild) — wall-clock cap.
   * The action layer (`generate-draft-action.ts`) is responsible for
   * wrapping `multiStepDraftWorkflow.createRun().start({ signal })`
   * with `AbortSignal.timeout(TIME_BUDGET_MS.multiStepWorkflow)` so the
   * upstream Server Action classifies the abort as `timeout`.
   *
   * The U3 rebuild replaced the single draft call with a skeleton call
   * plus a SEQUENTIAL fill loop (one call per fillable node). The
   * per-step caps are in `TOKEN_CAPS.multiStepDraft*`; the fill step's
   * wall-clock is N sequential `experience-fill` calls, where N is the
   * skeleton's fillable-node count.
   *
   * Kept at 3 minutes (the pre-U3 ceiling). The old single ~4k draft
   * call (~30-50s) is replaced by a fast skeleton call (~5-10s, tiny
   * output) plus N small fill calls. At a representative 5-8 fillable
   * nodes those fills run ~5-12s each (small single-block outputs, some
   * with one tool round-trip) for ~40-80s of fill wall-time —
   * comparable to the old draft step it replaces, so the planner +
   * critique + revise envelope keeps the whole chain inside 180s. If a
   * pathological skeleton declares many nodes, the action's
   * `AbortSignal.timeout` still fail-closes the run as `timeout`. NOTE:
   * if production fill counts trend high, lift this ceiling (and the
   * matching `ACTION_BUDGET_MS`) rather than capping node count —
   * structural completeness is the point of two-phase.
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
