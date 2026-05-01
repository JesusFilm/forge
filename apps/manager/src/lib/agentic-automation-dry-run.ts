import { env } from "@/config/env"
import { z } from "zod"

const DEFAULT_AGENTIC_FETCH_TIMEOUT_MS = 15_000

const agenticDryRunSuccessSchema = z.object({
  ok: z.literal(true),
  agenticRunId: z.string().min(1),
  managerAutomationRunDocumentId: z.string().min(1),
  status: z.enum(["queued", "running", "success", "no_op", "failed"]),
  reportUrl: z.string().optional(),
  summary: z.string().min(1),
})

const agenticDryRunFailureSchema = z.object({
  ok: z.literal(false),
  code: z.string().min(1).default("agentic_error"),
  message: z.string().min(1).optional(),
  messages: z.array(z.string().min(1)).optional(),
})

const agenticDryRunEnvelopeSchema = z.union([
  agenticDryRunSuccessSchema,
  agenticDryRunFailureSchema,
])

export type AgenticAutomationDryRunResult =
  | z.infer<typeof agenticDryRunSuccessSchema>
  | {
      ok: false
      reason: "config_missing"
      messages: string[]
      retryable: false
    }
  | {
      ok: false
      reason: "network_error"
      messages: string[]
      retryable: true
    }
  | {
      ok: false
      reason: "parse_error"
      messages: string[]
      httpStatus: number
      retryable: true
    }
  | {
      ok: false
      reason: "contract_error"
      messages: string[]
      httpStatus: number
      retryable: false
    }
  | {
      ok: false
      reason: "upstream_error"
      code: string
      messages: string[]
      httpStatus: number
      retryable: false
    }

export async function triggerAgenticAutomationDryRun(input: {
  automationDocumentId: string
  requestedBy: {
    kind: "manager_user" | "service"
    id: string
  }
  idempotencyKey: string
}): Promise<AgenticAutomationDryRunResult> {
  if (!env.AGENTIC_BASE_URL || !env.AGENTIC_SERVICE_API_KEY) {
    return {
      ok: false,
      reason: "config_missing",
      messages: [
        "AGENTIC_BASE_URL and AGENTIC_SERVICE_API_KEY must be set on apps/manager to call the Agentic runtime",
      ],
      retryable: false,
    }
  }

  const timeoutMs =
    env.AGENTIC_REQUEST_TIMEOUT_MS ?? DEFAULT_AGENTIC_FETCH_TIMEOUT_MS
  const agenticUrl = `${env.AGENTIC_BASE_URL.replace(/\/+$/, "")}/forge/manager-automation-dry-run`

  let response: Response
  try {
    response = await fetch(agenticUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.AGENTIC_SERVICE_API_KEY}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    return {
      ok: false,
      reason: "network_error",
      messages: [
        isTimeout
          ? `Agentic dry-run request timed out after ${timeoutMs}ms`
          : message,
      ],
      retryable: true,
    }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return {
      ok: false,
      reason: "parse_error",
      messages: ["Agentic returned invalid JSON"],
      httpStatus: response.status,
      retryable: true,
    }
  }

  const parsed = agenticDryRunEnvelopeSchema.safeParse(payload)
  if (!parsed.success) {
    return {
      ok: false,
      reason: "contract_error",
      messages: [
        "Agentic dry-run response did not match the expected contract",
      ],
      httpStatus: response.status,
      retryable: false,
    }
  }

  if (parsed.data.ok) {
    return parsed.data
  }

  return {
    ok: false,
    reason: "upstream_error",
    code: parsed.data.code,
    messages:
      parsed.data.messages ??
      (parsed.data.message
        ? [parsed.data.message]
        : ["Agentic dry run failed"]),
    httpStatus: response.status,
    retryable: false,
  }
}
