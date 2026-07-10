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
    retryable: options.retryable,
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
  if (value instanceof SmartCropWorkflowFailureError) {
    return value.result
  }

  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : ""
  const prefixIndex = message.indexOf(prefix)
  if (prefixIndex < 0) return null

  try {
    const parsed = SmartCropWorkflowFailureSchema.safeParse(
      JSON.parse(message.slice(prefixIndex + prefix.length)),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function smartCropFailureFromRunResult(
  prefix: string,
  value: unknown,
): SmartCropWorkflowFailure | null {
  const direct = smartCropFailureFromUnknown(prefix, value)
  if (direct) return direct
  if (typeof value !== "object" || value === null) return null
  const record = value as {
    error?: unknown
    result?: unknown
    snapshot?: unknown
  }
  return (
    smartCropFailureFromUnknown(prefix, record.error) ??
    smartCropFailureFromUnknown(prefix, record.result) ??
    smartCropFailureFromUnknown(prefix, record.snapshot)
  )
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
  if (result.reason === "provider_auth_failed") return 502
  return result.retryable ? 503 : 502
}
