/**
 * Real-LLM smoke test for the multi-step draft workflow.
 *
 * Exercises the same path the dashboard "create full experience draft"
 * action consumes:
 *   getMastra().getWorkflowById("multi-step-draft").createRun().start({ inputData })
 *
 * Verifies for each prompt in the committed set:
 *   - The workflow returns status: "success"
 *   - The final envelope Zod-parses against DraftExperienceSchema
 *   - Each step's text is captured for editor review (R11 — the
 *     "at least as good as single-agent" gate is editor judgment at
 *     smoke-test time, not an automated assertion)
 *
 * Exits non-zero on:
 *   - Missing env (OPENROUTER_API_KEY)
 *   - Workflow status !== "success"
 *   - DraftExperienceSchema parse failure
 *
 * Run with:
 *   pnpm --filter @forge/admin exec tsx --env-file=.env \
 *     src/scripts/smoke-mastra-draft-workflow.ts
 */

import { getMastra } from "@/mastra"
import { env } from "@/config/env"
import { TIME_BUDGET_MS } from "@/mastra/budgets"
import { DraftExperienceSchema } from "@/services/experience-ai/experience-ai.schemas"

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

type SmokeOutcome = {
  prompt: string
  durationMs: number
  status: string
  planSnippet?: string
  critiqueSnippet?: string
  draftValid: boolean
  draftTitle?: string
  blockCount?: number
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
        candidates: [],
      },
    })
    clearTimeout(timeoutHandle)
    const durationMs = Date.now() - started

    if (result.status !== "success") {
      return {
        prompt,
        durationMs,
        status: result.status,
        draftValid: false,
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
    return {
      prompt,
      durationMs,
      status: result.status,
      planSnippet: snippet(planOutput?.plan),
      critiqueSnippet: snippet(critiqueOutput?.notes),
      draftValid: parsed.success,
      draftTitle: parsed.success ? parsed.data.title : undefined,
      blockCount: parsed.success ? parsed.data.blocks.length : undefined,
      error: parsed.success
        ? undefined
        : `DraftExperienceSchema parse failed: ${parsed.error.message}`,
    }
  } catch (err) {
    return {
      prompt,
      durationMs: Date.now() - started,
      status: "thrown",
      draftValid: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function main() {
  console.log("[smoke] start — multi-step draft workflow smoke")
  console.log(
    "[smoke] env OPENROUTER_API_KEY present:",
    !!env.OPENROUTER_API_KEY,
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

  console.log("\n[smoke] summary:")
  console.log(
    JSON.stringify(
      {
        total: outcomes.length,
        passing: outcomes.filter((o) => o.draftValid).length,
        failing: outcomes.filter((o) => !o.draftValid).length,
        avgDurationMs:
          outcomes.reduce((a, o) => a + o.durationMs, 0) / outcomes.length,
      },
      null,
      2,
    ),
  )

  const failed = outcomes.filter((o) => !o.draftValid)
  if (failed.length > 0) {
    console.error(
      `[smoke] FAIL: ${failed.length} of ${outcomes.length} prompts produced an invalid draft`,
    )
    process.exit(1)
  }

  console.log(
    "\n[smoke] PASS — every prompt produced a DraftExperienceSchema-valid draft",
  )
  console.log(
    "[smoke] Editor review required: confirm the final drafts above are at least as good as the single-agent default-chat baseline (R11).",
  )
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err)
  process.exit(1)
})
