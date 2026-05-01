import {
  startManagerAutomationDryRunRequestSchema,
  type StartManagerAutomationDryRunRequest,
  type StartManagerAutomationDryRunResponse,
} from "@/contracts/manager-automation-dry-run"

export type LaunchManagerAutomationDryRunWorkflow = (
  input: StartManagerAutomationDryRunRequest,
) => Promise<StartManagerAutomationDryRunResponse>

export type ManagerAutomationDryRunHandlerDependencies = {
  serviceApiKey: string
  launchWorkflow: LaunchManagerAutomationDryRunWorkflow
}

export type ManagerAutomationDryRunRoute = {
  path: "/forge/manager-automation-dry-run"
  method: "POST"
  requiresAuth: true
  handler: (request: Request) => Promise<Response>
}

export function createManagerAutomationDryRunRoute({
  serviceApiKey,
  launchDryRun,
}: {
  serviceApiKey: string
  launchDryRun: LaunchManagerAutomationDryRunWorkflow
}): ManagerAutomationDryRunRoute {
  return {
    path: "/forge/manager-automation-dry-run",
    method: "POST",
    requiresAuth: true,
    handler: createManagerAutomationDryRunHandler({
      serviceApiKey,
      launchWorkflow: launchDryRun,
    }),
  }
}

export function createManagerAutomationDryRunHandler({
  serviceApiKey,
  launchWorkflow,
}: ManagerAutomationDryRunHandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    if (!isAuthorized(request, serviceApiKey)) {
      return jsonResponse(
        {
          ok: false,
          code: "unauthorized",
          message: "Missing or invalid Agentic service bearer token.",
        },
        401,
      )
    }

    const json = await request.json().catch(() => undefined)
    const parsed = startManagerAutomationDryRunRequestSchema.safeParse(json)

    if (!parsed.success) {
      return jsonResponse(
        {
          ok: false,
          code: "invalid_automation",
          message:
            "Request must match the Manager automation dry-run contract.",
        },
        400,
      )
    }

    const result = await launchWorkflow(parsed.data)

    return jsonResponse(result, result.ok ? 200 : responseStatus(result.code))
  }
}

function isAuthorized(request: Request, serviceApiKey: string): boolean {
  return request.headers.get("authorization") === `Bearer ${serviceApiKey}`
}

function responseStatus(
  code: Exclude<StartManagerAutomationDryRunResponse, { ok: true }>["code"],
): number {
  switch (code) {
    case "unauthorized":
      return 401
    case "not_found":
      return 404
    case "invalid_automation":
      return 400
    case "manager_unavailable":
    case "mastra_runtime_error":
      return 502
    default:
      return 500
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  })
}
