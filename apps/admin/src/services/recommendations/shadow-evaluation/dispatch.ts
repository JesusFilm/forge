import { createHash } from "node:crypto"
import {
  Prisma,
  WorkflowRunStatus,
  type PrismaClient,
  type WorkflowRun,
} from "@prisma/client"
import { start } from "workflow/api"
import { getWorld } from "workflow/runtime"
import { prisma } from "@/db/client"
import { runRecommendationShadowEvaluation } from "@/workflows/recommendationShadowEvaluation"
import { RECOMMENDATION_RAW_RETENTION_DAYS } from "../contracts"
import { RecommendationConflictError } from "../errors"

export const RECOMMENDATION_SHADOW_EVALUATION_WORKFLOW_KEY =
  "recommendation-shadow-evaluation"
const DISPATCH_VERSION = "shadow-dispatch-v1"
const RECONCILIATION_TIMEOUT_MS = 2_000

export type RecommendationShadowEvaluationJobInput = Readonly<{
  evaluationId: string
  expectedGeneration: number
  generatorKey: string
  minimumRuns: number
  ledgerRunId?: string
}>
type DispatchInput = Omit<RecommendationShadowEvaluationJobInput, "ledgerRunId">
type Client = Pick<
  PrismaClient,
  "workflowRun" | "recommendationShadowEvaluation"
>
type DispatchState =
  | "prepared"
  | "uncertain"
  | "attached"
  | "running"
  | "terminal"
export type ShadowDispatchReceipt = Readonly<{
  state: DispatchState
  queued: boolean
  ledgerRunId: string
  runId: string | null
  reused: boolean
  workflowStatus: WorkflowRunStatus
  runtimeStatus?: string
}>

/** One PK owns the attempt; only the atomic prepared -> attempted winner may start. */
export async function dispatchRecommendationShadowEvaluation(
  input: DispatchInput,
  options: Readonly<{ actorId?: string; client?: Client; now?: Date }> = {},
): Promise<ShadowDispatchReceipt> {
  const client = options.client ?? prisma
  const now = options.now ?? new Date()
  const evaluation =
    await client.recommendationShadowEvaluation.findUniqueOrThrow({
      where: { id: input.evaluationId },
    })
  const tuple = {
    ...input,
    manifestId: evaluation.manifestId,
    generatorVersion: evaluation.generatorVersion,
    contextVersion: evaluation.contextVersion,
    eligibilityVersion: evaluation.eligibilityVersion,
    samplingVersion: evaluation.samplingVersion,
    retentionPolicyVersion: evaluation.retentionPolicyVersion,
    windowStart: evaluation.windowStart.toISOString(),
    windowEnd: evaluation.windowEnd.toISOString(),
    requestedSampleSize: evaluation.requestedSampleSize,
  }
  const id = `${DISPATCH_VERSION}:${createHash("sha256")
    .update(JSON.stringify([input.evaluationId, input.expectedGeneration]))
    .digest("hex")}`
  let ledger = await client.workflowRun.findUnique({ where: { id } })
  if (!ledger) {
    // Old dispatches used random IDs. Their FAILED/null-runtime state does not
    // establish that start was rejected. Never bypass them with a new attempt.
    const previous = await client.workflowRun.findFirst({
      where: {
        workflowKey: RECOMMENDATION_SHADOW_EVALUATION_WORKFLOW_KEY,
        subjectType: "recommendation-shadow-evaluation",
        subjectId: input.evaluationId,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    })
    if (previous && previous.id !== id) {
      assertLegacyInput(previous, input)
      return reconcileReceipt(previous, true)
    }
    assertEvaluationCanStart(evaluation, input, now)
    await client.workflowRun.createMany({
      data: [
        {
          id,
          workflowKey: RECOMMENDATION_SHADOW_EVALUATION_WORKFLOW_KEY,
          workflowName: "Recommendation Shadow Candidate Evaluation",
          subjectType: "recommendation-shadow-evaluation",
          subjectId: input.evaluationId,
          trigger: options.actorId ? "MANUAL" : "SYSTEM",
          actorId: options.actorId,
          summary:
            "Recommendation shadow dispatch prepared; runtime start not attempted.",
          details: {
            ...input,
            dispatchVersion: DISPATCH_VERSION,
            dispatchState: "prepared",
            tuple,
          },
        },
      ],
      skipDuplicates: true,
    })
    ledger = await client.workflowRun.findUniqueOrThrow({ where: { id } })
  }
  const details = detailsOf(ledger)
  if (
    details.dispatchVersion !== DISPATCH_VERSION ||
    !sameJson(details.tuple, tuple)
  ) {
    throw new RecommendationConflictError(
      "The shadow dispatch retry does not match its immutable configuration",
    )
  }
  if (
    details.dispatchState !== "prepared" ||
    ledger.status !== "QUEUED" ||
    ledger.runtimeRunId !== null
  ) {
    return reconcileReceipt(ledger, true)
  }
  assertEvaluationCanStart(evaluation, input, now)
  const claimed = await client.workflowRun.updateMany({
    where: {
      id,
      status: "QUEUED",
      runtimeRunId: null,
      details: { equals: details },
    },
    data: {
      details: { ...details, dispatchState: "start_attempted" },
      summary:
        "Recommendation shadow runtime start attempted; acceptance is uncertain until attachment.",
    },
  })
  if (claimed.count !== 1) {
    return reconcileReceipt(
      await client.workflowRun.findUniqueOrThrow({ where: { id } }),
      true,
    )
  }

  let runtime: Awaited<ReturnType<typeof start>>
  try {
    // Workflow 4.2.2 has no caller-supplied start ID and may throw after queue
    // acceptance. Neither a thrown start nor a null runtime ID permits retry.
    runtime = await start(runRecommendationShadowEvaluation, [
      { ...input, ledgerRunId: id },
    ])
  } catch {
    return reconcileReceipt(
      await client.workflowRun.findUniqueOrThrow({ where: { id } }),
      false,
    )
  }
  try {
    const attached = await attachRuntime(
      client,
      { ...input, ledgerRunId: id },
      runtime.runId,
      false,
    )
    if (!attached)
      return receipt(
        await client.workflowRun.findUniqueOrThrow({ where: { id } }),
        "uncertain",
        false,
      )
    const current = await client.workflowRun.findUniqueOrThrow({
      where: { id },
    })
    return receipt(
      current,
      terminal(current)
        ? "terminal"
        : current.status === "RUNNING"
          ? "running"
          : "attached",
      false,
    )
  } catch {
    // The runtime has its own fenced self-attachment path. Preserve intent if
    // this process dies or the database is unavailable after successful start.
    return { ...receipt(ledger, "uncertain", false), runId: runtime.runId }
  }
}

export async function markRecommendationShadowEvaluationRuntimeStarted(
  input: RecommendationShadowEvaluationJobInput,
  runtimeRunId: string,
  client: Client = prisma,
): Promise<boolean> {
  return attachRuntime(client, input, runtimeRunId, true)
}

async function attachRuntime(
  client: Client,
  input: RecommendationShadowEvaluationJobInput,
  runtimeRunId: string,
  running: boolean,
): Promise<boolean> {
  if (!input.ledgerRunId || !runtimeRunId) return false
  // Two bounded passes allow the dispatcher and worker to attach the SAME
  // runtime concurrently; a different runtime never replaces its identity.
  for (let attempt = 0; attempt < 2; attempt++) {
    const ledger = await client.workflowRun.findUnique({
      where: { id: input.ledgerRunId },
    })
    if (
      !ledger ||
      !matchesInput(ledger, input) ||
      (ledger.runtimeRunId !== null && ledger.runtimeRunId !== runtimeRunId)
    )
      return false
    if (terminal(ledger))
      return !running && ledger.runtimeRunId === runtimeRunId
    const details = detailsOf(ledger)
    if (
      details.dispatchState !== "start_attempted" &&
      details.dispatchState !== "attached"
    )
      return false
    const result = await client.workflowRun.updateMany({
      where: {
        id: ledger.id,
        runtimeRunId: ledger.runtimeRunId,
        status: ledger.status,
        details: { equals: details },
      },
      data: {
        runtimeRunId,
        ...(running
          ? {
              status: WorkflowRunStatus.RUNNING,
              startedAt: ledger.startedAt ?? new Date(),
            }
          : {}),
        details: { ...details, dispatchState: "attached" },
        summary: running
          ? "Recommendation shadow evaluation running."
          : ledger.summary,
      },
    })
    if (result.count === 1) return true
  }
  return false
}

/** Terminal writes cannot erase the tuple or overwrite another runtime's receipt. */
export async function finishRecommendationShadowDispatch(
  input: RecommendationShadowEvaluationJobInput,
  runtimeRunId: string | undefined,
  result: {
    status: WorkflowRunStatus
    summary: string
    details?: Prisma.InputJsonObject
    error?: string
  },
  client: Client = prisma,
): Promise<void> {
  if (!input.ledgerRunId || !runtimeRunId) return
  const ledger = await client.workflowRun.findUnique({
    where: { id: input.ledgerRunId },
  })
  if (!ledger || !matchesInput(ledger, input)) return
  const details = detailsOf(ledger)
  await client.workflowRun.updateMany({
    where: {
      id: ledger.id,
      runtimeRunId,
      status: "RUNNING",
      details: { equals: details },
    },
    data: {
      status: result.status,
      summary: result.summary,
      error: result.error ?? null,
      finishedAt: new Date(),
      details: { ...details, result: result.details ?? {} },
    },
  })
}

function assertEvaluationCanStart(
  evaluation: {
    state: string
    generation: number
    windowStart: Date
    expiresAt: Date
  },
  input: DispatchInput,
  now: Date,
) {
  if (
    evaluation.state !== "ACTIVE" ||
    evaluation.generation !== input.expectedGeneration ||
    evaluation.expiresAt <= now ||
    evaluation.windowStart.getTime() <
      now.getTime() - RECOMMENDATION_RAW_RETENTION_DAYS * 86_400_000
  ) {
    throw new RecommendationConflictError(
      "The shadow evaluation is terminal, stale or expired and cannot start",
    )
  }
}

function matchesInput(
  ledger: WorkflowRun,
  input: RecommendationShadowEvaluationJobInput,
) {
  const details = detailsOf(ledger)
  return (
    ledger.workflowKey === RECOMMENDATION_SHADOW_EVALUATION_WORKFLOW_KEY &&
    ledger.subjectId === input.evaluationId &&
    details.dispatchVersion === DISPATCH_VERSION &&
    details.evaluationId === input.evaluationId &&
    details.expectedGeneration === input.expectedGeneration &&
    details.generatorKey === input.generatorKey &&
    details.minimumRuns === input.minimumRuns
  )
}

function assertLegacyInput(ledger: WorkflowRun, input: DispatchInput) {
  const details = detailsOf(ledger)
  for (const key of [
    "evaluationId",
    "expectedGeneration",
    "generatorKey",
    "minimumRuns",
  ] as const) {
    if (details[key] !== undefined && details[key] !== input[key])
      throw new RecommendationConflictError(
        `The shadow dispatch retry does not match its original ${key}`,
      )
  }
}

function detailsOf(ledger: WorkflowRun): Prisma.InputJsonObject {
  return ledger.details !== null &&
    typeof ledger.details === "object" &&
    !Array.isArray(ledger.details)
    ? ledger.details
    : {}
}

function sameJson(left: unknown, right: unknown): boolean {
  // JSONB object key ordering is not insertion ordering.
  if (left === right) return true
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) ||
    Array.isArray(right)
  )
    return false
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => sameJson(a[key], b[key]))
  )
}

function terminal(ledger: WorkflowRun) {
  return ledger.status !== "QUEUED" && ledger.status !== "RUNNING"
}

function receipt(
  ledger: WorkflowRun,
  state: DispatchState,
  reused: boolean,
  runtimeStatus?: string,
): ShadowDispatchReceipt {
  return {
    state,
    queued: state === "attached" || state === "running",
    ledgerRunId: ledger.id,
    runId: ledger.runtimeRunId,
    reused,
    workflowStatus: ledger.status,
    ...(runtimeStatus ? { runtimeStatus } : {}),
  }
}

async function reconcileReceipt(
  ledger: WorkflowRun,
  reused: boolean,
): Promise<ShadowDispatchReceipt> {
  if (!ledger.runtimeRunId) return receipt(ledger, "uncertain", reused)
  if (
    terminal(ledger) &&
    detailsOf(ledger).dispatchVersion === DISPATCH_VERSION
  ) {
    return receipt(ledger, "terminal", reused)
  }
  // Legacy start failure could overwrite a worker's RUNNING receipt even
  // after attachment. Its terminal ledger status needs runtime reconciliation.
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const run = await Promise.race([
      getWorld().runs.get(ledger.runtimeRunId, { resolveData: "none" }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), RECONCILIATION_TIMEOUT_MS)
      }),
    ])
    if (!run) return receipt(ledger, "uncertain", reused)
    const state =
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "cancelled"
        ? "terminal"
        : run.status === "running"
          ? "running"
          : run.status === "pending"
            ? "attached"
            : "uncertain"
    // Runtime completion is not a shadow decision or permission to restart.
    return receipt(ledger, state, reused, run.status)
  } catch {
    return receipt(ledger, "uncertain", reused)
  } finally {
    if (timer) clearTimeout(timer)
  }
}
