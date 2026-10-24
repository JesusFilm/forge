import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { env } from "../../config/env"

// Registered workflow data is durable and caller-controlled. Transport and
// credentials must never be fields in this schema, even as test overrides.
export const SubtitleEvalRecoveryInputSchema = z.strictObject({}).default({})

export const SubtitleEvalRecoveryOutputSchema = z.object({
  status: z.enum(["swept", "skipped", "failed"]),
  reason: z.string().nullable(),
  total: z.number().int().nonnegative(),
  raced: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
})

export type SubtitleEvalRecoveryOutput = z.infer<
  typeof SubtitleEvalRecoveryOutputSchema
>

/**
 * A run of the Subtitle Quality Lab executes inside Manager's process on the
 * Workflow SDK's local World, so a Manager restart loses the in-flight workflow
 * and leaves the run RUNNING with its spend reserved. Nothing re-drives it.
 *
 * This sweep lives in Mastra rather than in Manager precisely because Manager
 * is the thing that fails: a scheduler inside Manager would be gone at the
 * moment it is needed. Mastra runs a single replica, so the schedule fires
 * once; concurrent sweeps would be safe regardless, because Admin fences
 * recovery with lease generations and token hashes.
 *
 * `schedule` below is supported by @mastra/core ONLY on the evented engine,
 * and it is not retained on the returned workflow object, so nothing at
 * runtime reports that the cron was registered. The test pins the engine type
 * for that reason: if this workflow ever resolves to another engine the
 * schedule stops firing silently.
 */
const DEFAULT_TIMEOUT_MS = 240_000
/** The endpoint returns at most 4 pages of 25 outcomes. Anything beyond this is
 * not a response we should buffer into a shared process. */
const MAX_RESPONSE_BYTES = 1_048_576

// Code-only test seam: the registered execute callback never forwards input to
// this argument. A supplied config replaces the whole pair, never half of env.
type RecoveryDependencies = {
  config?: { url?: string; apiKey?: string }
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

// This is the public Manager origin documented by the deployment guides. The
// recovery runbook documents no private Railway or local HTTP exception.
const RECOVERY_ENDPOINT =
  "https://manager.jesusfilm.org/api/scheduled/subtitle-eval-recovery"

function isRecoveryEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search &&
      // Reject even empty query/fragment/userinfo and noncanonical spellings.
      url.href === value &&
      url.href === RECOVERY_ENDPOINT
    )
  } catch {
    return false
  }
}

export async function runSubtitleEvalRecovery(
  input: unknown = {},
  dependencies: RecoveryDependencies = {},
): Promise<SubtitleEvalRecoveryOutput> {
  SubtitleEvalRecoveryInputSchema.parse(input)
  const { url, apiKey } = dependencies.config ?? {
    url: env.MANAGER_SUBTITLE_EVAL_RECOVERY_URL,
    apiKey: env.MANAGER_SUBTITLE_EVAL_RECOVERY_API_KEY,
  }
  const empty = { total: 0, raced: 0, unknown: 0 }

  // Unconfigured is the normal state until the Lab is turned on. Skip quietly
  // rather than throwing on every tick.
  if (!url || !apiKey) {
    return { status: "skipped", reason: "config_missing", ...empty }
  }

  if (!isRecoveryEndpoint(url)) {
    return { status: "failed", reason: "config_invalid", ...empty }
  }

  const doFetch = dependencies.fetchImpl ?? fetch
  let response: Response
  try {
    response = await doFetch(url, {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch {
    // Never log the caught error: a transport failure can carry request detail.
    return { status: "failed", reason: "request_failed", ...empty }
  }

  if (!response.ok) {
    return { status: "failed", reason: `http_${response.status}`, ...empty }
  }

  let parsed: unknown
  try {
    const body = await readCapped(response)
    if (body == null) {
      return { status: "failed", reason: "response_too_large", ...empty }
    }
    parsed = JSON.parse(body)
  } catch {
    return { status: "failed", reason: "parse_error", ...empty }
  }

  const outcomes = z
    .object({
      outcomes: z
        .array(z.object({ runId: z.string(), status: z.string() }))
        .default([]),
    })
    .safeParse(parsed)
  if (!outcomes.success) {
    return { status: "failed", reason: "unexpected_shape", ...empty }
  }

  const list = outcomes.data.outcomes
  return {
    status: "swept",
    reason: null,
    total: list.length,
    // SKIPPED_OR_RACED is expected when another sweep holds the lease, but
    // Manager also catches EVERY exception into that same status, so a raced
    // count is not on its own evidence of health. It is surfaced, not judged.
    raced: list.filter((o) => o.status === "SKIPPED_OR_RACED").length,
    unknown: list.filter((o) => o.status === "UNKNOWN").length,
  }
}

async function readCapped(response: Response): Promise<string | null> {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        // Abort the socket rather than merely stopping the read.
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Already released by cancel(); nothing to do.
    }
  }
  return new TextDecoder().decode(
    chunks.reduce<Uint8Array>((acc, chunk) => {
      const next = new Uint8Array(acc.length + chunk.length)
      next.set(acc)
      next.set(chunk, acc.length)
      return next
    }, new Uint8Array()),
  )
}

const subtitleEvalRecoveryStep = createStep({
  id: "sweep-stale-subtitle-eval-runs",
  inputSchema: SubtitleEvalRecoveryInputSchema,
  outputSchema: SubtitleEvalRecoveryOutputSchema,
  execute: ({ inputData }) => {
    // Revalidate direct step/time-travel input even if framework validation is
    // disabled. Never pass inputData as code-only transport dependencies.
    SubtitleEvalRecoveryInputSchema.parse(inputData)
    return runSubtitleEvalRecovery()
  },
})

export const subtitleEvalRecoveryWorkflow = createWorkflow({
  id: "subtitle-eval-recovery",
  description:
    "Sweeps Subtitle Quality Lab runs stranded by a Manager restart, releasing their reserved spend.",
  inputSchema: SubtitleEvalRecoveryInputSchema,
  outputSchema: SubtitleEvalRecoveryOutputSchema,
  schedule: { cron: "*/5 * * * *", timezone: "UTC" },
})
  .then(subtitleEvalRecoveryStep)
  .commit()
