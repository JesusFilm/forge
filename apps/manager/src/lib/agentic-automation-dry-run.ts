import { z } from "zod"
import { env } from "@/config/env"
import { readAutomationJson } from "./automation-dry-run-http"

const identity = z.string().trim().min(1).max(160)
const inputSchema = z
  .object({
    automationDocumentId: identity,
    requestedBy: z
      .object({ kind: z.enum(["manager_user", "service"]), id: identity })
      .strict(),
    idempotencyKey: z.string().trim().min(1).max(240),
  })
  .strict()
const successSchema = z
  .object({
    ok: z.literal(true),
    agenticRunId: identity,
    automationDocumentId: identity,
    managerAutomationRunDocumentId: identity,
    runMode: z.literal("dry_run"),
    enqueuedCount: z.literal(0),
    status: z.enum(["success", "partial", "failed", "no_op"]),
    reportUrl: z.string().min(1).max(2_000),
    summary: z.string().max(2_000),
  })
  .strict()
const failureSchema = z
  .object({
    ok: z.literal(false),
    code: z.string().min(1).max(80),
    message: z.string().max(2_000),
  })
  .strict()
const responseSchema = z.discriminatedUnion("ok", [
  successSchema,
  failureSchema,
])

type FailureReason =
  | "config_missing"
  | "invalid_input"
  | "network_error"
  | "contract_error"
  | "upstream_error"
type Failure = {
  ok: false
  reason: FailureReason
  messages: string[]
  retryable: boolean
  httpStatus?: number
  code?: string
}
export type AgenticAutomationDryRunResult =
  | z.output<typeof successSchema>
  | Failure
const failure = (
  reason: FailureReason,
  httpStatus?: number,
  code?: string,
): Failure => ({
  ok: false,
  reason,
  messages: ["Mastra automation dry run is unavailable."],
  retryable: reason === "network_error",
  ...(httpStatus ? { httpStatus } : {}),
  ...(code ? { code } : {}),
})

/** Compatibility helper for PR870 callers, now targeting the current Mastra service. */
export async function triggerAgenticAutomationDryRun(
  input: z.input<typeof inputSchema>,
): Promise<AgenticAutomationDryRunResult> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure("invalid_input")
  if (!env.MASTRA_BASE_URL || !env.MASTRA_SERVICE_API_KEY)
    return failure("config_missing")
  let url: URL
  try {
    url = new URL(env.MASTRA_BASE_URL)
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return failure("config_missing")
    url.pathname = "/forge-manager-automation-dry-run"
  } catch {
    return failure("config_missing")
  }
  const signal = AbortSignal.timeout(
    env.MASTRA_AUTOMATION_DRY_RUN_TIMEOUT_MS ?? 70_000,
  )
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${env.MASTRA_SERVICE_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(parsed.data),
      signal,
    })
    if (
      response.redirected ||
      (response.status >= 300 && response.status < 400)
    ) {
      void response.body?.cancel().catch(() => undefined)
      return failure("contract_error", response.status)
    }
    const result = responseSchema.safeParse(
      await readAutomationJson(response, 16_384, signal),
    )
    if (!result.success || response.ok !== result.data.ok)
      return failure("contract_error", response.status)
    if (!result.data.ok)
      return failure("upstream_error", response.status, result.data.code)
    if (
      result.data.automationDocumentId !== parsed.data.automationDocumentId ||
      result.data.reportUrl !==
        `/dashboard/agents?automationId=${encodeURIComponent(parsed.data.automationDocumentId)}&runId=${encodeURIComponent(result.data.managerAutomationRunDocumentId)}`
    )
      return failure("contract_error", response.status)
    return result.data
  } catch {
    return failure("network_error")
  }
}
