import { ManagerAutomationDryRunInputSchema } from "../contracts/manager-automation-dry-run"
import { isValidServiceBearer } from "../server/service-bearer"
import { readAutomationDryRunJson } from "../server/automation-dry-run-json"
import { managerDryRunFailure } from "../services/manager-automation-dry-run-client"
import { launchManagerAutomationDryRunWorkflow } from "./workflows/manager-automation-dry-run"

export async function handleManagerAutomationDryRunRequest(
  request: Request,
  serviceKeys: readonly string[],
  launch = launchManagerAutomationDryRunWorkflow,
): Promise<Response> {
  if (
    !isValidServiceBearer({
      authHeader: request.headers.get("authorization"),
      allowlist: serviceKeys,
    })
  ) {
    return Response.json(managerDryRunFailure("unauthorized"), { status: 401 })
  }
  const parsed = ManagerAutomationDryRunInputSchema.safeParse(
    await readAutomationDryRunJson(request, 8_192, AbortSignal.timeout(5_000)),
  )
  if (!parsed.success)
    return Response.json(managerDryRunFailure("invalid_automation"), {
      status: 400,
    })
  const result = await launch(parsed.data).catch(() =>
    managerDryRunFailure("mastra_runtime_error"),
  )
  const statuses = {
    unauthorized: 401,
    not_found: 404,
    invalid_automation: 400,
    run_in_progress: 409,
    idempotency_conflict: 409,
    config_missing: 503,
    manager_unavailable: 502,
    mastra_runtime_error: 502,
  } as const
  return Response.json(result, {
    status: result.ok ? 200 : statuses[result.code],
  })
}
