import { env } from "../config/env"
import {
  ManagerAutomationDryRunInputSchema,
  ManagerDryRunResultSchema,
  type ManagerAutomationDryRunInput,
  type ManagerDryRunResult,
} from "../contracts/manager-automation-dry-run"
import { readAutomationDryRunJson } from "../server/automation-dry-run-json"

export type ManagerDryRunDependencies = {
  managerBaseUrl?: string
  managerAgenticApiKey?: string
  requestTimeoutMs?: number
  fetcher?: typeof fetch
}
export const managerDryRunFailure = (
  code: Extract<ManagerDryRunResult, { ok: false }>["code"],
): Extract<ManagerDryRunResult, { ok: false }> => ({
  ok: false,
  code,
  message: "Manager automation dry run is unavailable.",
})

export async function callManagerDryRunEndpoint(
  rawInput: ManagerAutomationDryRunInput,
  dependencies: ManagerDryRunDependencies = {},
): Promise<ManagerDryRunResult> {
  const parsed = ManagerAutomationDryRunInputSchema.safeParse(rawInput)
  if (!parsed.success) return managerDryRunFailure("invalid_automation")
  const base = dependencies.managerBaseUrl ?? env.MANAGER_AUTOMATION_BASE_URL
  const key = dependencies.managerAgenticApiKey ?? env.MANAGER_AGENTIC_API_KEY
  if (!base || !key) return managerDryRunFailure("config_missing")
  let url: URL
  try {
    url = new URL(base)
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return managerDryRunFailure("config_missing")
    url.pathname = `/api/automations/${encodeURIComponent(parsed.data.automationDocumentId)}/agentic-dry-run`
  } catch {
    return managerDryRunFailure("config_missing")
  }
  const timeoutMs =
    dependencies.requestTimeoutMs ??
    env.MANAGER_AUTOMATION_DRY_RUN_TIMEOUT_MS ??
    60_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    return managerDryRunFailure("config_missing")
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    const response = await (dependencies.fetcher ?? fetch)(url, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "idempotency-key": parsed.data.idempotencyKey,
      },
      signal,
      // Authority and mode are never copied from an untrusted caller.
      body: JSON.stringify({
        idempotencyKey: parsed.data.idempotencyKey,
        requestedBy: parsed.data.requestedBy,
      }),
    })
    if (
      response.redirected ||
      (response.status >= 300 && response.status < 400)
    ) {
      void response.body?.cancel().catch(() => undefined)
      return managerDryRunFailure("manager_unavailable")
    }
    const body = ManagerDryRunResultSchema.safeParse(
      await readAutomationDryRunJson(response, 16_384, signal),
    )
    if (!body.success || response.ok !== body.data.ok)
      return managerDryRunFailure("manager_unavailable")
    if (!body.data.ok) return managerDryRunFailure(body.data.code)
    if (body.data.automationDocumentId !== parsed.data.automationDocumentId)
      return managerDryRunFailure("manager_unavailable")
    const expectedReportUrl = `/dashboard/agents?automationId=${encodeURIComponent(body.data.automationDocumentId)}&runId=${encodeURIComponent(body.data.managerAutomationRunDocumentId)}`
    if (body.data.reportUrl !== expectedReportUrl)
      return managerDryRunFailure("manager_unavailable")
    return body.data
  } catch {
    return managerDryRunFailure("manager_unavailable")
  }
}
