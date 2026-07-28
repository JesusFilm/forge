/**
 * PROTOTYPE — answering models and the judge model.
 *
 * ANSWERING MODEL != JUDGE MODEL. The answering model runs the system prompt
 * and produces the response under test; the judge model scores that response.
 * They must never be the same model — a judge grading its own output is not
 * evidence.
 *
 * Slugs verified against `https://openrouter.ai/api/v1/models` on 2026-07-29.
 * Note the `openrouter/` prefix in `seeker-agent.ts:122-123` belongs to
 * Mastra's model router — it is NOT part of the catalog id and must be
 * stripped for direct API calls.
 *
 * SIDE FINDING while verifying: the repo's default judge slug
 * `anthropic/claude-haiku-4-5` (env `SEARCH_EVAL_JUDGE_MODEL`,
 * `EVAL_QUERY_GENERATION_MODEL`) does not appear in OpenRouter's catalog —
 * the live id is `anthropic/claude-haiku-4.5`, with a dot. Worth checking
 * separately; not this prototype's problem.
 */

export type AnsweringModel = {
  /** OpenRouter catalog id, no `openrouter/` prefix. */
  id: string
  /** Short name for grid columns. */
  label: string
  note: string
}

/**
 * Phase A of the eval question — "what should we ship / demo on?" — varies this
 * list with the prompt held fixed. Phase B — "did this prompt edit help?" —
 * pins it to the chosen primary (and maybe secondary) and varies the prompt.
 */
/**
 * WHY NOT THE `:free` SLUGS PRODUCTION USES
 * -----------------------------------------
 * The 2026-07-29 run got HTTP 429 on 6 of 6 `google/gemma-4-31b-it:free`
 * calls, with `limit_source: upstream_provider_shared_pool`. That is not a
 * key problem — the same key completed every Sonnet and Haiku call in the
 * same run. OpenRouter routes `:free` variants through a shared upstream
 * pool whose rate limit is global, so NO key makes them reliable.
 *
 * The paid variants are the SAME model weights on dedicated routing, at
 * roughly $0.0005 for a whole eval run. So the eval uses them and still
 * measures the model production actually runs.
 *
 * The `:free` unreliability is a real production concern — it is what
 * seeker-agent.ts:122 hits first on every turn — but it is a routing
 * decision for that agent, not something the eval should inherit.
 */
export const ANSWERING_MODELS: readonly AnsweringModel[] = [
  {
    id: "google/gemma-4-31b-it",
    label: "gemma-31b",
    note: "Same weights as production's primary (seeker-agent.ts:122), paid routing.",
  },
  {
    id: "google/gemma-4-26b-a4b-it",
    label: "gemma-26b",
    note: "Same weights as production's failover (seeker-agent.ts:123), paid routing.",
  },
  {
    id: "anthropic/claude-sonnet-5",
    label: "sonnet-5",
    note: "Paid reference — the headroom check for stakeholder demos.",
  },
]

/**
 * Never one of ANSWERING_MODELS. Cheap, and temperature 0 at the call site.
 */
export const JUDGE_MODEL = "anthropic/claude-haiku-4.5"

/** USD per token, from OpenRouter's catalog on 2026-07-29. */
const PRICING: Record<string, { input: number; output: number }> = {
  "google/gemma-4-31b-it": { input: 0.00000014, output: 0.0000004 },
  "google/gemma-4-26b-a4b-it": { input: 0.00000015, output: 0.00000045 },
  "google/gemma-4-31b-it:free": { input: 0, output: 0 },
  "google/gemma-4-26b-a4b-it:free": { input: 0, output: 0 },
  "anthropic/claude-sonnet-5": { input: 0.000002, output: 0.00001 },
  "anthropic/claude-haiku-4.5": { input: 0.000001, output: 0.000005 },
}

/**
 * Returns null for an unpriced model rather than guessing — the search-eval
 * runner's `costFor` does the same thing, and a made-up number in a cost
 * column is worse than a blank one.
 */
export function costUsd(
  model: string,
  usage: { input: number; output: number },
): number | null {
  const price = PRICING[model]
  if (!price) return null
  return usage.input * price.input + usage.output * price.output
}

export function answeringModelsByIds(ids: readonly string[]): AnsweringModel[] {
  if (ids.length === 0) return [...ANSWERING_MODELS]
  return ids.map((id) => {
    const known = ANSWERING_MODELS.find((model) => model.id === id)
    return known ?? { id, label: id.split("/").pop() ?? id, note: "ad-hoc" }
  })
}
