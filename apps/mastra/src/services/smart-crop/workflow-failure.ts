/**
 * Shared failure envelope for the three smart-crop workflows.
 *
 * The reason literals are the cross-app wire contract with apps/manager —
 * do not rename them. Each workflow throws a prefixed failure error so
 * Studio records failed runs, then the launch helper unwraps the prefix
 * back into the typed failure result.
 */

import { z } from "zod"

import { SmartCropFrameUrlError } from "./frame-urls"
import { SmartCropProviderError } from "./openrouter-vision"

export const SMART_CROP_FAILURE_REASONS = [
  "invalid_input",
  "provider_config_missing",
  "provider_auth_failed",
  "provider_rate_limited",
  "provider_failed",
  "provider_invalid_output",
  "frame_host_not_allowed",
] as const

export const SmartCropWorkflowFailureSchema = z
  .object({
    ok: z.literal(false),
    reason: z.enum(SMART_CROP_FAILURE_REASONS),
    retryable: z.boolean(),
    message: z.string(),
    mastraRunId: z.string(),
  })
  .strict()
  .superRefine((failure, ctx) => {
    if (failure.reason === "provider_rate_limited" && failure.retryable) {
      ctx.addIssue({
        code: "custom",
        message: "provider_rate_limited must be terminal for workflow retries",
        path: ["retryable"],
      })
    }
  })

export type SmartCropWorkflowFailure = z.infer<
  typeof SmartCropWorkflowFailureSchema
>
export type SmartCropFailureReason = SmartCropWorkflowFailure["reason"]

export function smartCropFailure(
  reason: SmartCropFailureReason,
  options: { retryable: boolean; message: string; mastraRunId: string },
): SmartCropWorkflowFailure {
  return {
    ok: false,
    reason,
    retryable: reason === "provider_rate_limited" ? false : options.retryable,
    message: options.message,
    mastraRunId: options.mastraRunId,
  }
}

export class SmartCropWorkflowFailureError extends Error {
  constructor(
    prefix: string,
    readonly result: SmartCropWorkflowFailure,
  ) {
    super(`${prefix}${JSON.stringify(result)}`)
    this.name = "SmartCropWorkflowFailureError"
  }
}

export function throwSmartCropWorkflowFailure(
  prefix: string,
  result: SmartCropWorkflowFailure,
): never {
  throw new SmartCropWorkflowFailureError(prefix, result)
}

export function smartCropFailureFromUnknown(
  prefix: string,
  value: unknown,
): SmartCropWorkflowFailure | null {
  try {
    if (value instanceof SmartCropWorkflowFailureError) {
      return value.result
    }

    let message = ""
    if (value instanceof Error) {
      message = value.message
    } else if (typeof value === "string") {
      message = value
    } else if (typeof value === "object" && value !== null) {
      const serializedMessage = (value as { message?: unknown }).message
      if (typeof serializedMessage === "string") message = serializedMessage
    }
    const prefixIndex = message.indexOf(prefix)
    if (prefixIndex < 0) return null

    const parsed = SmartCropWorkflowFailureSchema.safeParse(
      JSON.parse(message.slice(prefixIndex + prefix.length)),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function safeFailureEnvelope(value: unknown): SmartCropWorkflowFailure | null {
  try {
    const parsed = SmartCropWorkflowFailureSchema.safeParse(value)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const FAILURE_TRAVERSAL_MAX_DEPTH = 8
const FAILURE_TRAVERSAL_MAX_NODES = 64
const FAILURE_CONTAINER_MAX_ENTRIES = 32
const FAILURE_CHILD_FIELDS = ["error", "cause", "result", "snapshot"] as const
const FAILURE_CONTAINER_FIELDS = ["steps", "context"] as const

function safeField(value: object, field: string): unknown {
  try {
    return (value as Record<string, unknown>)[field]
  } catch {
    return undefined
  }
}

function safeContainerValues(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null) return []
  const values: unknown[] = []
  try {
    if (Array.isArray(value)) {
      for (
        let index = 0;
        index < Math.min(value.length, FAILURE_CONTAINER_MAX_ENTRIES);
        index += 1
      ) {
        values.push(value[index])
      }
      return values
    }

    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue
      values.push(safeField(value, key))
      if (values.length >= FAILURE_CONTAINER_MAX_ENTRIES) break
    }
    return values
  } catch {
    return []
  }
}

export function smartCropFailureFromRunResult(
  prefix: string,
  value: unknown,
): SmartCropWorkflowFailure | null {
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  const visited = new WeakSet<object>()
  let cursor = 0
  let inspected = 0

  function enqueue(child: unknown, depth: number): void {
    if (queue.length < FAILURE_TRAVERSAL_MAX_NODES) {
      queue.push({ value: child, depth })
    }
  }

  while (cursor < queue.length && inspected < FAILURE_TRAVERSAL_MAX_NODES) {
    const current = queue[cursor++]!
    inspected += 1

    const direct = smartCropFailureFromUnknown(prefix, current.value)
    if (direct) return direct

    const envelope = safeFailureEnvelope(current.value)
    if (envelope) return envelope

    if (
      current.depth >= FAILURE_TRAVERSAL_MAX_DEPTH ||
      typeof current.value !== "object" ||
      current.value === null ||
      visited.has(current.value)
    ) {
      continue
    }
    visited.add(current.value)

    for (const field of FAILURE_CHILD_FIELDS) {
      const child = safeField(current.value, field)
      if (child !== undefined) {
        enqueue(child, current.depth + 1)
      }
    }

    for (const field of FAILURE_CONTAINER_FIELDS) {
      const container = safeField(current.value, field)
      if (container === undefined) continue
      enqueue(container, current.depth + 1)
      for (const child of safeContainerValues(container)) {
        enqueue(child, current.depth + 2)
      }
    }
  }

  return null
}

export function smartCropFailureFromError(
  error: unknown,
  mastraRunId: string,
): SmartCropWorkflowFailure {
  if (error instanceof SmartCropFrameUrlError) {
    return smartCropFailure("frame_host_not_allowed", {
      retryable: false,
      message: error.message,
      mastraRunId,
    })
  }
  if (error instanceof SmartCropProviderError) {
    return smartCropFailure(error.reason, {
      retryable: error.retryable,
      message: error.message,
      mastraRunId,
    })
  }
  return smartCropFailure("provider_failed", {
    retryable: true,
    message: error instanceof Error ? error.message : String(error),
    mastraRunId,
  })
}

export function smartCropRouteStatus(
  result: { ok: true } | SmartCropWorkflowFailure,
): number {
  if (result.ok) return 200
  if (result.reason === "invalid_input") return 400
  if (result.reason === "frame_host_not_allowed") return 400
  if (result.reason === "provider_config_missing") return 503
  if (result.reason === "provider_rate_limited") return 503
  if (result.reason === "provider_auth_failed") return 502
  return result.retryable ? 503 : 502
}
