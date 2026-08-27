import { registerApiRoute } from "@mastra/core/server"
import { z } from "zod"

import {
  isValidServiceBearer,
  parseServiceApiKeys,
} from "../../server/service-bearer"
import {
  StorefrontHomepageCurationInputSchema,
  StorefrontHomepageCurationOutputSchema,
  type StorefrontHomepageCurationOutput,
} from "./storefront-homepage-curation"

type WorkflowRunResult = {
  status: string
  result?: unknown
  error?: unknown
}

type StorefrontWorkflowState = {
  runId: string
  status: string
  result?: unknown
  createdAt: Date
  updatedAt: Date
}

type StorefrontWorkflowRun = {
  start: (options: { inputData: unknown }) => Promise<WorkflowRunResult>
  runId: string
}

type StorefrontWorkflow = {
  createRun: () => Promise<StorefrontWorkflowRun> | StorefrontWorkflowRun
  listWorkflowRuns: (options: {
    perPage: number
    page: number
  }) => Promise<{ runs: Array<{ runId: string }>; total: number }>
  getWorkflowRunById: (
    runId: string,
    options: { fields: ["result"] },
  ) => Promise<StorefrontWorkflowState | null>
}

const STOREFRONT_WORKFLOW_ID = "storefront-homepage-curation"
const StorefrontRunIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const StorefrontRunStatusSchema = z.enum([
  "running",
  "success",
  "failed",
  "tripwire",
  "suspended",
  "waiting",
  "pending",
  "canceled",
  "bailed",
  "paused",
  "skipped",
])
const StorefrontRunLimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(25)
  .default(10)

export type StorefrontRunSummary = {
  runId: string
  status: z.infer<typeof StorefrontRunStatusSchema>
  createdAt: string
  updatedAt: string
  output: StorefrontHomepageCurationOutput | null
}

type StorefrontRouteFailureReason =
  | "invalid_input"
  | "workflow_unavailable"
  | "workflow_failed"
  | "invalid_workflow_output"

type StorefrontRouteFailure = {
  ok: false
  reason: StorefrontRouteFailureReason
  retryable: boolean
  message: string
  runId?: string
}

export type StorefrontHomepageCurationRouteOutcome = {
  status: number
  body:
    | (StorefrontHomepageCurationOutput & { runId: string })
    | StorefrontRouteFailure
    | { error: string }
}

export async function launchStoredStorefrontHomepageCurationRun(input: {
  workflow: StorefrontWorkflow
  input: z.output<typeof StorefrontHomepageCurationInputSchema>
}): Promise<{ runId: string; result: WorkflowRunResult }> {
  const run = await input.workflow.createRun()
  return {
    runId: run.runId,
    result: await run.start({ inputData: input.input }),
  }
}

export async function handleStorefrontHomepageCurationRouteRequest(input: {
  authHeader: string | null | undefined
  curatorServiceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch: (
    input: z.output<typeof StorefrontHomepageCurationInputSchema>,
  ) => Promise<{ runId: string; result: WorkflowRunResult }>
}): Promise<StorefrontHomepageCurationRouteOutcome> {
  if (!authorized(input.authHeader, input.curatorServiceKeys)) {
    return {
      status: 401,
      body: { error: "Storefront curator operator bearer required" },
    }
  }

  const raw = await input.readJson().catch(() => undefined)
  const parsed = StorefrontHomepageCurationInputSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        ok: false,
        reason: "invalid_input",
        retryable: false,
        message: "request body failed validation",
      },
    }
  }

  let launched: { runId: string; result: WorkflowRunResult }
  try {
    launched = await input.launch(parsed.data)
  } catch {
    return {
      status: 503,
      body: {
        ok: false,
        reason: "workflow_unavailable",
        retryable: false,
        message: "storefront curation workflow is unavailable",
      },
    }
  }

  const runResult = launched.result
  if (runResult.status !== "success") {
    return {
      status: 502,
      body: {
        ok: false,
        reason: "workflow_failed",
        retryable: false,
        message: "storefront curation workflow did not complete",
        runId: launched.runId,
      },
    }
  }

  const output = StorefrontHomepageCurationOutputSchema.safeParse(
    runResult.result,
  )
  if (!output.success) {
    return {
      status: 502,
      body: {
        ok: false,
        reason: "invalid_workflow_output",
        retryable: false,
        message: "storefront curation workflow returned an invalid result",
        runId: launched.runId,
      },
    }
  }

  // Business outcomes, including stage_outcome_unknown, remain exact workflow
  // output. In particular, the route never retries an ambiguous stage write.
  return { status: 200, body: { runId: launched.runId, ...output.data } }
}

function authorized(
  authHeader: string | null | undefined,
  curatorServiceKeys: readonly string[],
) {
  return isValidServiceBearer({ authHeader, allowlist: curatorServiceKeys })
}

function summarizeRun(
  state: StorefrontWorkflowState,
): StorefrontRunSummary | null {
  const runId = StorefrontRunIdSchema.safeParse(state.runId)
  const status = StorefrontRunStatusSchema.safeParse(state.status)
  if (!runId.success || !status.success) return null
  const output = StorefrontHomepageCurationOutputSchema.safeParse(state.result)
  return {
    runId: runId.data,
    status: status.data,
    createdAt: state.createdAt.toISOString(),
    updatedAt: state.updatedAt.toISOString(),
    output: output.success ? output.data : null,
  }
}

export async function handleStorefrontRunListRequest(input: {
  authHeader: string | null | undefined
  curatorServiceKeys: readonly string[]
  limit: unknown
  workflow: StorefrontWorkflow
}) {
  if (!authorized(input.authHeader, input.curatorServiceKeys)) {
    return {
      status: 401,
      body: { error: "Storefront curator operator bearer required" },
    }
  }
  const limit = StorefrontRunLimitSchema.safeParse(input.limit ?? undefined)
  if (!limit.success) {
    return {
      status: 400,
      body: { error: "Run list limit must be between 1 and 25" },
    }
  }
  try {
    const stored = await input.workflow.listWorkflowRuns({
      perPage: limit.data,
      page: 0,
    })
    const runs = (
      await Promise.all(
        stored.runs.map((run) =>
          input.workflow.getWorkflowRunById(run.runId, { fields: ["result"] }),
        ),
      )
    ).flatMap((state) => {
      if (!state) return []
      const summary = summarizeRun(state)
      return summary ? [summary] : []
    })
    return {
      status: 200,
      body: { runs, total: stored.total, limit: limit.data },
    }
  } catch {
    return {
      status: 503,
      body: { error: "Storefront curator run storage unavailable" },
    }
  }
}

export async function handleStorefrontRunReadRequest(input: {
  authHeader: string | null | undefined
  curatorServiceKeys: readonly string[]
  runId: unknown
  workflow: StorefrontWorkflow
}) {
  if (!authorized(input.authHeader, input.curatorServiceKeys)) {
    return {
      status: 401,
      body: { error: "Storefront curator operator bearer required" },
    }
  }
  const runId = StorefrontRunIdSchema.safeParse(input.runId)
  if (!runId.success) {
    return { status: 400, body: { error: "Invalid storefront curator run ID" } }
  }
  try {
    const state = await input.workflow.getWorkflowRunById(runId.data, {
      fields: ["result"],
    })
    const summary = state ? summarizeRun(state) : null
    return summary
      ? { status: 200, body: summary }
      : { status: 404, body: { error: "Storefront curator run not found" } }
  } catch {
    return {
      status: 503,
      body: { error: "Storefront curator run storage unavailable" },
    }
  }
}

export function createStorefrontHomepageCurationApiRoutes(apiKeysCsv?: string) {
  const curatorServiceKeys = parseServiceApiKeys(apiKeysCsv)
  return [
    registerApiRoute("/forge-storefront-curation", {
      method: "POST",
      handler: async (c) => {
        const workflow = c.get("mastra").getWorkflowById(STOREFRONT_WORKFLOW_ID)
        const outcome = await handleStorefrontHomepageCurationRouteRequest({
          authHeader: c.req.header("authorization"),
          curatorServiceKeys,
          readJson: () => c.req.json(),
          launch: (input) =>
            launchStoredStorefrontHomepageCurationRun({ workflow, input }),
        })
        return Response.json(outcome.body, { status: outcome.status })
      },
    }),
    registerApiRoute("/forge-storefront-curation/runs", {
      method: "GET",
      handler: async (c) => {
        const outcome = await handleStorefrontRunListRequest({
          authHeader: c.req.header("authorization"),
          curatorServiceKeys,
          limit: c.req.query("limit"),
          workflow: c.get("mastra").getWorkflowById(STOREFRONT_WORKFLOW_ID),
        })
        return Response.json(outcome.body, { status: outcome.status })
      },
    }),
    registerApiRoute("/forge-storefront-curation/runs/:runId", {
      method: "GET",
      handler: async (c) => {
        const outcome = await handleStorefrontRunReadRequest({
          authHeader: c.req.header("authorization"),
          curatorServiceKeys,
          runId: c.req.param("runId"),
          workflow: c.get("mastra").getWorkflowById(STOREFRONT_WORKFLOW_ID),
        })
        return Response.json(outcome.body, { status: outcome.status })
      },
    }),
  ]
}
