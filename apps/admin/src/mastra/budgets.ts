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
 */
export const TOKEN_CAPS = {
  draftExperience: 4_000,
  addSection: 1_500,
  rewriteCopy: 1_000,
  autoEnrich: 3_000,
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
  /** Multi-step workflow's full chain (plan → draft → critique → revise). */
  multiStepWorkflow: 60_000,
  /** Background auto-enrich agent's full run on one experience locale. */
  backgroundAutoEnrich: 120_000,
} as const

/**
 * Convenience accessor — return the time budget for a named shape.
 * Used by U6+ call sites to wrap invocations uniformly.
 */
export type BudgetShape = keyof typeof TIME_BUDGET_MS

export function getTimeBudgetMs(shape: BudgetShape): number {
  return TIME_BUDGET_MS[shape]
}
