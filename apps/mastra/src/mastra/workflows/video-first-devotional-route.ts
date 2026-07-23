import { createHash } from "node:crypto"

import { z } from "zod"

import { isValidServiceBearer } from "../../server/service-bearer"

const InputSchema = z
  .object({
    chapterIndex: z.number().int().positive().optional(),
    sequence: z.number().int().nonnegative().optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    regenerate: z.boolean().optional(),
    regenerateAudio: z.boolean().optional(),
  })
  .strict()

const ApprovalSchema = z
  .object({
    approved: z.boolean(),
    notes: z.string().max(2_000).optional(),
  })
  .strict()

const ApprovalActorSchema = z
  .object({
    subject: z.string().min(1).max(256),
    email: z.string().email().max(320).optional(),
    role: z.enum(["admin", "editor"]),
  })
  .strict()

export type DevotionalApprovalActor = z.infer<typeof ApprovalActorSchema>

const RetrySchema = z
  .object({
    regenerate: z.boolean().default(false),
    regenerateAudio: z.boolean().default(false),
  })
  .strict()

const ArtifactRefSchema = z
  .object({
    assetId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    artifactType: z.enum([
      "devotional-output-portrait-v1",
      "devotional-output-wide-v1",
    ]),
    ext: z.literal("mp4"),
  })
  .strict()

const SuspensionSchema = z
  .object({
    message: z.string(),
    portraitAsset: ArtifactRefSchema,
    wideAsset: ArtifactRefSchema,
    portraitUrl: z.string().startsWith("/forge-video-first-devotional/assets/"),
    wideUrl: z.string().startsWith("/forge-video-first-devotional/assets/"),
    title: z.string(),
    reference: z.string(),
    reflectionPreview: z.string(),
  })
  .strict()

export type VideoFirstWorkflowState = {
  runId: string
  status: string
  payload?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: { message?: string }
  steps?: Record<string, unknown>
}

type VideoFirstWorkflowResult = {
  status: string
  result?: Record<string, unknown>
  suspendPayload?: unknown
  error?: Error
}

type VideoFirstRun = {
  startAsync: (options: {
    inputData: Record<string, unknown>
  }) => Promise<{ runId: string }>
  resume: (options: {
    resumeData: {
      approved: boolean
      notes?: string
      approvedBy: DevotionalApprovalActor
    }
  }) => Promise<VideoFirstWorkflowResult>
  cancel: () => Promise<void>
}

export type VideoFirstWorkflowAdapter = {
  createRun: (options: { runId: string }) => Promise<VideoFirstRun>
  getWorkflowRunById: (
    runId: string,
    options?: { fields?: string[] },
  ) => Promise<VideoFirstWorkflowState | null>
}

export type VideoFirstLifecycleDeps = {
  workflow: VideoFirstWorkflowAdapter
  renewReservation: (state: VideoFirstWorkflowState) => Promise<void>
  releaseReservation: (state: VideoFirstWorkflowState) => Promise<void>
  now?: () => Date
}

export type VideoFirstReservationOwner = {
  chapterId: string
  reservationId: string
  chapterIndex?: number
  sequence?: number
  date?: string
}

export type VideoFirstRouteOutcome = {
  status: number
  body: Record<string, unknown>
}

type CommonRouteInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
}

function unauthorized(): VideoFirstRouteOutcome {
  return { status: 401, body: { error: "Service bearer required" } }
}

function isAuthorized(input: CommonRouteInput): boolean {
  return isValidServiceBearer({
    authHeader: input.authHeader,
    allowlist: input.serviceKeys,
  })
}

function runIdForDate(date: string): string {
  return `daily-devotional-${date.replaceAll("-", "")}`
}

const lifecycleLocks = new Map<string, Promise<void>>()

async function withLifecycleLock<T>(key: string, work: () => Promise<T>) {
  const previous = lifecycleLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => current)
  lifecycleLocks.set(key, queued)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (lifecycleLocks.get(key) === queued) lifecycleLocks.delete(key)
  }
}

function retryRunId(parentRunId: string, retry: z.infer<typeof RetrySchema>) {
  const variant = createHash("sha256")
    .update(JSON.stringify(retry))
    .digest("hex")
    .slice(0, 12)
  return `${parentRunId}-retry-${variant}`
}

function normalizeSuspension(
  value: unknown,
): z.infer<typeof SuspensionSchema> | null {
  const parsed = SuspensionSchema.safeParse(value)
  if (parsed.success) return parsed.data
  if (value == null || typeof value !== "object") return null
  for (const child of Object.values(value)) {
    const nested = normalizeSuspension(child)
    if (nested) return nested
  }
  return null
}

function suspensionFromState(state: VideoFirstWorkflowState): unknown {
  const seen = new Set<unknown>()
  const visit = (value: unknown): unknown => {
    if (value == null || typeof value !== "object" || seen.has(value)) {
      return undefined
    }
    seen.add(value)
    if (
      "suspendPayload" in value &&
      normalizeSuspension(
        (value as { suspendPayload?: unknown }).suspendPayload,
      )
    ) {
      return (value as { suspendPayload: unknown }).suspendPayload
    }
    for (const child of Object.values(value)) {
      const found = visit(child)
      if (found !== undefined) return found
    }
    return undefined
  }
  return visit(state.steps)
}

export function reservationOwnerFromState(
  state: VideoFirstWorkflowState,
): VideoFirstReservationOwner | null {
  const seen = new Set<unknown>()
  const visit = (value: unknown): VideoFirstReservationOwner | null => {
    if (value == null || typeof value !== "object" || seen.has(value)) {
      return null
    }
    seen.add(value)
    const candidate = value as Record<string, unknown>
    if (typeof candidate.reservationId === "string") {
      const chapter = candidate.chapter as Record<string, unknown> | undefined
      const devotional = candidate.devotional as
        | Record<string, unknown>
        | undefined
      const clip = devotional?.clip as Record<string, unknown> | undefined
      const chapterId =
        typeof chapter?.id === "string"
          ? chapter.id
          : typeof clip?.id === "string"
            ? clip.id
            : undefined
      if (chapterId) {
        return {
          chapterId,
          reservationId: candidate.reservationId,
          ...(typeof chapter?.index === "number"
            ? { chapterIndex: chapter.index }
            : typeof clip?.index === "number"
              ? { chapterIndex: clip.index }
              : {}),
          ...(typeof devotional?.sequence === "number"
            ? { sequence: devotional.sequence }
            : {}),
          ...(typeof devotional?.date === "string"
            ? { date: devotional.date }
            : {}),
        }
      }
    }
    for (const child of Object.values(candidate)) {
      const found = visit(child)
      if (found) return found
    }
    return null
  }
  return visit(state.steps)
}

function summarizeState(
  state: VideoFirstWorkflowState,
): Record<string, unknown> {
  const suspension = normalizeSuspension(suspensionFromState(state))
  return {
    runId: state.runId,
    status: state.status,
    ...(suspension ? { suspension } : {}),
    ...(state.result ? { result: state.result } : {}),
    ...(state.error?.message ? { error: state.error.message } : {}),
  }
}

function outcomeForExecution(
  runId: string,
  result: VideoFirstWorkflowResult,
  existing = false,
): VideoFirstRouteOutcome {
  if (result.status === "suspended") {
    const suspension = normalizeSuspension(result.suspendPayload)
    if (!suspension) {
      return {
        status: 500,
        body: { runId, status: "failed", error: "invalid suspension payload" },
      }
    }
    return {
      status: 202,
      body: { runId, status: "suspended", suspension, existing },
    }
  }
  if (result.status === "success") {
    return {
      status: 200,
      body: {
        runId,
        status: "success",
        result: result.result ?? {},
        existing,
      },
    }
  }
  if (result.status === "failed" || result.status === "tripwire") {
    return {
      status: 502,
      body: {
        runId,
        status: result.status,
        error: result.error?.message ?? "workflow failed",
      },
    }
  }
  return { status: 202, body: { runId, status: result.status, existing } }
}

export async function handleVideoFirstStartRequest(
  input: CommonRouteInput & {
    newRunsEnabled?: boolean
    readJson: () => Promise<unknown>
    deps: VideoFirstLifecycleDeps
  },
): Promise<VideoFirstRouteOutcome> {
  if (!isAuthorized(input)) return unauthorized()
  if (input.newRunsEnabled === false) {
    return { status: 503, body: { error: "new_runs_disabled" } }
  }
  const parsed = InputSchema.safeParse(await input.readJson().catch(() => null))
  if (!parsed.success) return { status: 400, body: { error: "invalid_body" } }

  const date =
    parsed.data.date ??
    (input.deps.now ?? (() => new Date()))().toISOString().slice(0, 10)
  const runId = runIdForDate(date)
  return withLifecycleLock(runId, async () => {
    const existing = await input.deps.workflow.getWorkflowRunById(runId)
    if (existing) {
      if (existing.status === "suspended") {
        await input.deps.renewReservation(existing)
      }
      return {
        status: 200,
        body: { ...summarizeState(existing), existing: true },
      }
    }

    const run = await input.deps.workflow.createRun({ runId })
    await run.startAsync({ inputData: { ...parsed.data, date } })
    const state = await input.deps.workflow.getWorkflowRunById(runId)
    return {
      status: 202,
      body: state
        ? { ...summarizeState(state), existing: false }
        : { runId, status: "pending", existing: false },
    }
  })
}

export async function handleVideoFirstStatusRequest(
  input: CommonRouteInput & {
    runId: string
    renewReservationOnRead?: boolean
    deps: VideoFirstLifecycleDeps
  },
): Promise<VideoFirstRouteOutcome> {
  if (!isAuthorized(input)) return unauthorized()
  const state = await input.deps.workflow.getWorkflowRunById(input.runId)
  if (!state) return { status: 404, body: { error: "not_found" } }
  if (state.status === "suspended" && input.renewReservationOnRead !== false) {
    await input.deps.renewReservation(state)
  }
  return { status: 200, body: summarizeState(state) }
}

export async function handleVideoFirstResumeRequest(
  input: CommonRouteInput & {
    runId: string
    approvalActor: unknown
    readJson: () => Promise<unknown>
    deps: VideoFirstLifecycleDeps
  },
): Promise<VideoFirstRouteOutcome> {
  if (!isAuthorized(input)) return unauthorized()
  const actor = ApprovalActorSchema.safeParse(input.approvalActor)
  if (!actor.success) {
    return { status: 401, body: { error: "approval_actor_required" } }
  }
  const parsed = ApprovalSchema.safeParse(
    await input.readJson().catch(() => null),
  )
  if (!parsed.success) return { status: 400, body: { error: "invalid_body" } }
  return withLifecycleLock(input.runId, async () => {
    const state = await input.deps.workflow.getWorkflowRunById(input.runId)
    if (!state) return { status: 404, body: { error: "not_found" } }
    if (state.status !== "suspended") {
      return { status: 409, body: { error: "run_not_suspended" } }
    }
    await input.deps.renewReservation(state)
    const run = await input.deps.workflow.createRun({ runId: input.runId })
    const result = await run.resume({
      resumeData: { ...parsed.data, approvedBy: actor.data },
    })
    return outcomeForExecution(input.runId, result)
  })
}

export async function handleVideoFirstCancelRequest(
  input: CommonRouteInput & {
    runId: string
    deps: VideoFirstLifecycleDeps
  },
): Promise<VideoFirstRouteOutcome> {
  if (!isAuthorized(input)) return unauthorized()
  return withLifecycleLock(input.runId, async () => {
    const state = await input.deps.workflow.getWorkflowRunById(input.runId)
    if (!state) return { status: 404, body: { error: "not_found" } }
    if (state.status !== "suspended") {
      return { status: 409, body: { error: "run_not_suspended" } }
    }
    const run = await input.deps.workflow.createRun({ runId: input.runId })
    await run.cancel()
    await input.deps.releaseReservation(state)
    return { status: 200, body: { runId: input.runId, status: "canceled" } }
  })
}

export async function handleVideoFirstRetryRequest(
  input: CommonRouteInput & {
    runId: string
    newRunsEnabled?: boolean
    readJson: () => Promise<unknown>
    deps: VideoFirstLifecycleDeps
  },
): Promise<VideoFirstRouteOutcome> {
  if (!isAuthorized(input)) return unauthorized()
  if (input.newRunsEnabled === false) {
    return { status: 503, body: { error: "new_runs_disabled" } }
  }
  const parsed = RetrySchema.safeParse(await input.readJson().catch(() => null))
  if (!parsed.success) return { status: 400, body: { error: "invalid_body" } }
  const state = await input.deps.workflow.getWorkflowRunById(input.runId)
  if (!state) return { status: 404, body: { error: "not_found" } }
  if (!["success", "failed", "tripwire", "canceled"].includes(state.status)) {
    return { status: 409, body: { error: "run_not_terminal" } }
  }
  if (
    state.status === "success" &&
    (state.result?.status === "published" ||
      state.result?.status === "approved")
  ) {
    return { status: 409, body: { error: "published_run_not_retryable" } }
  }
  const originalInput = InputSchema.safeParse(state.payload)
  if (!originalInput.success) {
    return { status: 409, body: { error: "original_input_unavailable" } }
  }
  const runId = retryRunId(input.runId, parsed.data)
  return withLifecycleLock(runId, async () => {
    const existing = await input.deps.workflow.getWorkflowRunById(runId)
    if (existing) {
      return {
        status: 200,
        body: { ...summarizeState(existing), existing: true },
      }
    }
    const run = await input.deps.workflow.createRun({ runId })
    await run.startAsync({
      inputData: { ...originalInput.data, ...parsed.data },
    })
    return {
      status: 202,
      body: { runId, status: "pending", existing: false },
    }
  })
}

export const _internals = {
  normalizeSuspension,
  reservationOwnerFromState,
  retryRunId,
  runIdForDate,
  summarizeState,
}
