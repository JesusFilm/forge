/**
 * Real-LLM structural-validity smoke gate for the multi-step draft workflow.
 *
 * Exercises the same path the dashboard "create full experience draft"
 * action consumes:
 *   getMastra().getWorkflowById("multi-step-draft").createRun().start({ inputData })
 *
 * Asserts the FULL structural guarantee for each prompt in the committed set:
 *   - The workflow returns status: "success"
 *   - The workflow envelope's `draft` Zod-parses against DraftExperienceSchema
 *   - normalizeExperienceDraft(draft, candidates) succeeds — i.e. the
 *     assembled output ALSO satisfies the persistence-layer BlocksSchema AND
 *     the generation minimum-block-count (GENERATION_MIN_BLOCKS). This is the
 *     same boundary `runGenerateDraftAction` enforces before persisting, so a
 *     green run here proves the workflow produces output the action will
 *     accept — not merely DraftExperienceSchema-shaped output.
 *   - Each step's text is captured for editor review (the "at least as good
 *     as single-agent" gate is editor judgment at smoke-test time, not an
 *     automated assertion)
 *
 * Outcome classification (per prompt):
 *   - first-pass-valid: the workflow's draft parsed clean AND normalized
 *     clean against BlocksSchema + the generation minimum.
 *   - terminal-fail: the workflow threw / returned a non-success status, OR
 *     the draft failed DraftExperienceSchema, OR normalize threw.
 *
 *   "recovered-after-repair" is NOT observable at this layer. The repair loop
 *   lives in `runGenerateDraftAction` (`normalizeWithRepair`), which this
 *   harness deliberately does NOT call — it drives the workflow directly to
 *   isolate the generator's first-pass structural quality. Repair-recovery is
 *   exercised by the action-level path and its unit tests
 *   (`generate-draft-action.test.ts` / `repair-draft.test.ts`), not by this
 *   workflow-level smoke. The summary records the recovered count as 0 with a
 *   note to that effect so the split stays honest about what this gate covers.
 *
 * GATEWAY-VERIFICATION ROLE (R6): this same harness, run with the AI gateway
 * enabled AND constrained decoding on
 * (`AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED=true` against that provider), is
 * the green gate that authorizes flipping the trusted flag for the provider.
 * The flag stays "false" until a green run confirms the provider honors
 * schema-constrained decoding for the experience schema. Because this gate
 * asserts post-normalize BlocksSchema validity (not just
 * DraftExperienceSchema), a green run proves the provider's constrained
 * output survives the FULL boundary, not just the draft schema.
 *
 * Exits non-zero on:
 *   - Missing env (OPENROUTER_API_KEY)
 *   - Any terminal-fail (workflow !== success, DraftExperienceSchema parse
 *     failure, or normalize failure)
 *
 * Run with:
 *   pnpm --filter @forge/admin smoke:draft-workflow
 */

import { getMastra } from "@/mastra"
import { env } from "@/config/env"
import { TIME_BUDGET_MS } from "@/mastra/budgets"
import { BlocksSchema } from "@/domain/blocks"
import {
  DraftExperienceSchema,
  type VideoCandidate,
} from "@forge/experience-schema"
import {
  ExperienceAiNormalizationError,
  normalizeExperienceDraft,
} from "@/services/experience-ai/experience-ai.service"

const SMOKE_PROMPTS: ReadonlyArray<string> = [
  "A short reflection on hope during a difficult season.",
  "An Easter Sunday introduction for new believers.",
  "A page about forgiveness that includes a video and a scripture.",
  "A welcome page for first-time visitors exploring faith.",
  "A short guide on prayer for everyday life.",
  "An Advent reflection for families with young children.",
  "A story-driven page about anchoring in scripture during loss.",
  "An invitation page for a youth group event focused on community.",
]

/**
 * Candidate set fed to BOTH the workflow inputData and the post-run
 * `normalizeExperienceDraft` call. The boundary MUST be asserted against the
 * SAME candidate list the generator saw — a draft that references a candidate
 * the normalize step doesn't know about would (correctly) fail normalize, so
 * the two halves must agree. This smoke runs candidate-free (empty list): the
 * workflow agents are told there are no candidates and produce candidate-free
 * pages, so any video-ref drift surfaces as a terminal-fail rather than being
 * silently absorbed.
 */
const SMOKE_CANDIDATES: VideoCandidate[] = []

/**
 * Per-prompt outcome class. See the file header for why
 * "recovered-after-repair" is not observable at the workflow layer.
 */
type SmokeOutcomeClass = "first-pass-valid" | "terminal-fail"

type SmokeOutcome = {
  prompt: string
  durationMs: number
  status: string
  outcome: SmokeOutcomeClass
  planSnippet?: string
  critiqueSnippet?: string
  /** Draft passed DraftExperienceSchema. */
  draftValid: boolean
  /**
   * Draft also normalized into a BlocksSchema-valid payload meeting the
   * generation minimum — the FULL structural guarantee. Only true when
   * `draftValid` is also true.
   */
  normalizeValid: boolean
  draftTitle?: string
  /** Top-level block count AFTER normalize (the assembled BlocksSchema shape). */
  normalizedBlockCount?: number
  error?: string
}

function snippet(text: unknown, max = 200): string | undefined {
  if (typeof text !== "string") return undefined
  return text.length > max ? `${text.slice(0, max)}…` : text
}

async function runOne(prompt: string): Promise<SmokeOutcome> {
  const started = Date.now()
  try {
    const mastra = getMastra()
    const workflow = mastra.getWorkflowById("multi-step-draft")
    const run = await workflow.createRun()
    const timeoutHandle = setTimeout(() => {
      // Logged but cannot abort the run — Mastra start() doesn't
      // accept an abortSignal. The run continues in the background;
      // this smoke run gives up and moves on.
      console.warn(
        `[smoke] prompt timed out after ${TIME_BUDGET_MS.multiStepWorkflow}ms (orphan run continues)`,
      )
    }, TIME_BUDGET_MS.multiStepWorkflow)

    const result = await run.start({
      inputData: {
        prompt,
        locale: "en",
        candidates: SMOKE_CANDIDATES,
      },
    })
    clearTimeout(timeoutHandle)
    const durationMs = Date.now() - started

    if (result.status !== "success") {
      return {
        prompt,
        durationMs,
        status: result.status,
        outcome: "terminal-fail",
        draftValid: false,
        normalizeValid: false,
        error:
          "error" in result && result.error instanceof Error
            ? result.error.message
            : `workflow returned status=${result.status}`,
      }
    }

    const steps = (result as { steps?: Record<string, { output?: unknown }> })
      .steps
    const planOutput = steps?.plan?.output as { plan?: string } | undefined
    const critiqueOutput = steps?.critique?.output as
      | { notes?: string }
      | undefined

    const finalDraft = (result.result as { draft?: unknown } | undefined)?.draft

    const parsed = DraftExperienceSchema.safeParse(finalDraft)
    if (!parsed.success) {
      return {
        prompt,
        durationMs,
        status: result.status,
        outcome: "terminal-fail",
        planSnippet: snippet(planOutput?.plan),
        critiqueSnippet: snippet(critiqueOutput?.notes),
        draftValid: false,
        normalizeValid: false,
        error: `DraftExperienceSchema parse failed: ${parsed.error.message}`,
      }
    }

    // FULL boundary assertion — the same gate the action enforces before
    // persisting. normalizeExperienceDraft validates the assembled output
    // against BlocksSchema (re-checked below as a belt-and-braces guard) AND
    // the generation minimum-block-count, and throws a typed
    // ExperienceAiNormalizationError on any structure/reference failure.
    try {
      const normalized = normalizeExperienceDraft(parsed.data, SMOKE_CANDIDATES)
      // Belt-and-braces: assert the assembled blocks satisfy BlocksSchema
      // here too, so this harness fails loudly if normalize's internal
      // BlocksSchema gate is ever loosened.
      const blocksParsed = BlocksSchema.safeParse(normalized.blocks)
      if (!blocksParsed.success) {
        return {
          prompt,
          durationMs,
          status: result.status,
          outcome: "terminal-fail",
          planSnippet: snippet(planOutput?.plan),
          critiqueSnippet: snippet(critiqueOutput?.notes),
          draftValid: true,
          normalizeValid: false,
          draftTitle: parsed.data.title,
          error: `normalized output failed BlocksSchema: ${blocksParsed.error.message}`,
        }
      }

      return {
        prompt,
        durationMs,
        status: result.status,
        outcome: "first-pass-valid",
        planSnippet: snippet(planOutput?.plan),
        critiqueSnippet: snippet(critiqueOutput?.notes),
        draftValid: true,
        normalizeValid: true,
        draftTitle: normalized.title,
        normalizedBlockCount: normalized.blocks.length,
      }
    } catch (normalizeError) {
      const message =
        normalizeError instanceof ExperienceAiNormalizationError
          ? `normalize failed [${normalizeError.code}]: ${normalizeError.message}`
          : normalizeError instanceof Error
            ? `normalize threw: ${normalizeError.message}`
            : `normalize threw: ${String(normalizeError)}`
      return {
        prompt,
        durationMs,
        status: result.status,
        outcome: "terminal-fail",
        planSnippet: snippet(planOutput?.plan),
        critiqueSnippet: snippet(critiqueOutput?.notes),
        draftValid: true,
        normalizeValid: false,
        draftTitle: parsed.data.title,
        error: message,
      }
    }
  } catch (err) {
    return {
      prompt,
      durationMs: Date.now() - started,
      status: "thrown",
      outcome: "terminal-fail",
      draftValid: false,
      normalizeValid: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function main() {
  console.log(
    "[smoke] start — multi-step draft workflow structural-validity gate",
  )
  console.log(
    "[smoke] env OPENROUTER_API_KEY present:",
    !!env.OPENROUTER_API_KEY,
  )
  console.log(
    "[smoke] AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED:",
    env.AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED ?? "false",
  )
  if (!env.OPENROUTER_API_KEY) {
    console.error(
      "[smoke] FAIL: OPENROUTER_API_KEY is required for a real-LLM smoke",
    )
    process.exit(1)
  }

  const outcomes: SmokeOutcome[] = []
  for (const prompt of SMOKE_PROMPTS) {
    console.log(`\n[smoke] --- prompt: ${prompt}`)
    const outcome = await runOne(prompt)
    outcomes.push(outcome)
    console.log(JSON.stringify(outcome, null, 2))
  }

  const firstPassValid = outcomes.filter(
    (o) => o.outcome === "first-pass-valid",
  ).length
  // recovered-after-repair is not observable at the workflow layer — the
  // repair loop lives in runGenerateDraftAction. Always 0 here; surfaced
  // explicitly so the split is honest about what this gate covers.
  const recoveredAfterRepair = 0
  const terminalFail = outcomes.filter(
    (o) => o.outcome === "terminal-fail",
  ).length

  console.log("\n[smoke] summary:")
  console.log(
    JSON.stringify(
      {
        total: outcomes.length,
        firstPassValid,
        recoveredAfterRepair,
        terminalFail,
        avgDurationMs:
          outcomes.reduce((a, o) => a + o.durationMs, 0) / outcomes.length,
      },
      null,
      2,
    ),
  )
  console.log(
    "[smoke] note: recoveredAfterRepair is always 0 here — repair-recovery is exercised by the action-level path (runGenerateDraftAction) and its tests, not this workflow-level smoke.",
  )

  if (terminalFail > 0) {
    const failed = outcomes.filter((o) => o.outcome === "terminal-fail")
    console.error(
      `[smoke] FAIL: ${terminalFail} of ${outcomes.length} prompts terminal-failed (DraftExperienceSchema parse, normalize, or workflow error)`,
    )
    for (const f of failed) {
      console.error(`[smoke]   - "${f.prompt}" → ${f.error ?? "unknown error"}`)
    }
    process.exit(1)
  }

  console.log(
    "\n[smoke] PASS — every prompt produced a draft that is DraftExperienceSchema-valid AND normalizes into a BlocksSchema-valid payload meeting the generation minimum (the FULL structural guarantee).",
  )
  console.log(
    "[smoke] Editor review required: confirm the final drafts above are at least as good as the single-agent default-chat baseline.",
  )
  console.log(
    "[smoke] Gateway-trust gate: a green run with the AI gateway enabled + AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED on authorizes flipping that flag for the provider (R6).",
  )
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err)
  process.exit(1)
})
