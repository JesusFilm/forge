/**
 * Multi-step planning workflow (U7) — plan → draft → critique → revise.
 *
 * A `@mastra/core/workflows` workflow with four fixed sequential
 * steps. The step cap is implicit in the chain length (no recursion
 * is possible), which satisfies plan C7 (no runaway loops). A
 * wall-clock cap should be applied at invocation time via
 * `AbortSignal.timeout()` — the workflow itself doesn't enforce it.
 *
 * Each step's `execute` is intentionally minimal at U7 — the workflow
 * structure is the load-bearing decision. Actual prompt content for
 * the per-step calls is tuned in U11 (cost-budgets pass) once U6's
 * default chat agent has shipped end-to-end and we have observed call
 * costs.
 *
 * Rebase note: the workflow doesn't register itself with the Mastra
 * singleton in this commit; that registration is part of the U6+
 * agent-wiring work post-rebase, where the workflow gets attached to
 * the agent that opt-in routes "thoughtful mode" through it.
 */

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

// Per-step schemas. Kept inside this module — these shapes aren't
// part of the public agent surface, just the workflow's internal
// step boundaries.

const inputSchema = z.object({
  prompt: z.string().min(1),
  locale: z.string().default("en"),
})

const planSchema = z.object({
  plan: z.string(),
})

const draftSchema = z.object({
  envelope: z.string(),
})

const critiqueSchema = z.object({
  envelope: z.string(),
  notes: z.string(),
})

const revisedSchema = z.object({
  envelope: z.string(),
})

// Step 1 — plan. Produces an outline before any block content.
const planStep = createStep({
  id: "plan",
  inputSchema,
  outputSchema: planSchema,
  execute: async ({ inputData }) => {
    // Placeholder body: in production this calls a Mastra agent with
    // a "planner" system prompt and returns the planner's outline
    // string. Wiring lands in the post-rebase integration commit.
    return { plan: `Plan for: ${inputData.prompt}` }
  },
})

// Step 2 — draft. Produces a structured envelope from the plan.
const draftStep = createStep({
  id: "draft",
  inputSchema: planSchema,
  outputSchema: draftSchema,
  execute: async ({ inputData }) => {
    // Placeholder body — see planStep note.
    return {
      envelope: `{"diff":{"scalars":{},"blocks":[]},"_plan":"${inputData.plan}"}`,
    }
  },
})

// Step 3 — critique. Reviews the draft against quality criteria.
const critiqueStep = createStep({
  id: "critique",
  inputSchema: draftSchema,
  outputSchema: critiqueSchema,
  execute: async ({ inputData }) => {
    // Placeholder body — see planStep note.
    return {
      envelope: inputData.envelope,
      notes: "OK",
    }
  },
})

// Step 4 — revise. Applies critique to produce the final envelope.
const reviseStep = createStep({
  id: "revise",
  inputSchema: critiqueSchema,
  outputSchema: revisedSchema,
  execute: async ({ inputData }) => {
    // Placeholder body — see planStep note.
    return { envelope: inputData.envelope }
  },
})

/**
 * Multi-step draft workflow. Four sequential named steps. Step cap
 * is structural — no `.unless()`, no `.loop()`, no recursion.
 */
export const multiStepDraftWorkflow = createWorkflow({
  id: "multi-step-draft",
  inputSchema,
  outputSchema: revisedSchema,
})
  .then(planStep)
  .then(draftStep)
  .then(critiqueStep)
  .then(reviseStep)

multiStepDraftWorkflow.commit()

/**
 * Maximum number of steps this workflow will execute. Exported so
 * U11's cost-budget tests can assert structural invariance: any
 * change to the chain length would change this constant, which
 * fails the cap check.
 */
export const MULTI_STEP_DRAFT_MAX_STEPS = 4
