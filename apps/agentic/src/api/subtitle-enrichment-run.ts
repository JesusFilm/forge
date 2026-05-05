import {
  startSubtitleEnrichmentRunRequestSchema,
  type StartSubtitleEnrichmentRunRequest,
  type StartSubtitleEnrichmentRunResponse,
} from "@/contracts/subtitle-enrichment-run"

export type LaunchSubtitleEnrichmentRunWorkflow = (
  input: StartSubtitleEnrichmentRunRequest,
  context: SubtitleEnrichmentRunRuntimeContext | undefined,
) => Promise<StartSubtitleEnrichmentRunResponse>

export type SubtitleEnrichmentRunRuntimeContext = {
  mastra?: unknown
  requestContext?: unknown
}

export type SubtitleEnrichmentRunHandlerDependencies = {
  serviceApiKey: string
  launchWorkflow: LaunchSubtitleEnrichmentRunWorkflow
}

export type SubtitleEnrichmentRunRoute = {
  path: "/forge/subtitle-enrichment-runs"
  method: "POST"
  requiresAuth: true
  handler: (
    request: Request,
    context?: SubtitleEnrichmentRunRuntimeContext,
  ) => Promise<Response>
}

type IdempotencyRecord = {
  fingerprint: string
  result: StartSubtitleEnrichmentRunResponse
}

export function createSubtitleEnrichmentRunRoute({
  serviceApiKey,
  launchRun,
}: {
  serviceApiKey: string
  launchRun: LaunchSubtitleEnrichmentRunWorkflow
}): SubtitleEnrichmentRunRoute {
  return {
    path: "/forge/subtitle-enrichment-runs",
    method: "POST",
    requiresAuth: true,
    handler: createSubtitleEnrichmentRunHandler({
      serviceApiKey,
      launchWorkflow: launchRun,
    }),
  }
}

export function createSubtitleEnrichmentRunHandler({
  serviceApiKey,
  launchWorkflow,
}: SubtitleEnrichmentRunHandlerDependencies) {
  const runsByIdempotencyKey = new Map<string, IdempotencyRecord>()

  return async (
    request: Request,
    context?: SubtitleEnrichmentRunRuntimeContext,
  ): Promise<Response> => {
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
    const parsed = startSubtitleEnrichmentRunRequestSchema.safeParse(json)

    if (!parsed.success) {
      return jsonResponse(
        {
          ok: false,
          code: "invalid_request",
          message: "Request must match the subtitle enrichment run contract.",
        },
        400,
      )
    }

    const fingerprint = stableFingerprint(parsed.data)
    const existing = runsByIdempotencyKey.get(parsed.data.idempotencyKey)

    if (existing && existing.fingerprint !== fingerprint) {
      return jsonResponse(
        {
          ok: false,
          code: "idempotency_conflict",
          message:
            "Idempotency key already belongs to a different subtitle enrichment request.",
        },
        409,
      )
    }

    if (existing) {
      return jsonResponse(existing.result, responseStatus(existing.result))
    }

    const result = await launchWorkflow(parsed.data, context).catch(() => ({
      ok: false as const,
      code: "mastra_runtime_error" as const,
      message: "Failed to start subtitle enrichment workflow.",
    }))
    if (result.ok) {
      runsByIdempotencyKey.set(parsed.data.idempotencyKey, {
        fingerprint,
        result,
      })
    }

    return jsonResponse(result, responseStatus(result))
  }
}

function isAuthorized(request: Request, serviceApiKey: string): boolean {
  return request.headers.get("authorization") === `Bearer ${serviceApiKey}`
}

function responseStatus(result: StartSubtitleEnrichmentRunResponse): number {
  if (result.ok) {
    return 202
  }

  switch (result.code) {
    case "unauthorized":
      return 401
    case "invalid_request":
    case "job_not_approved":
      return 400
    case "idempotency_conflict":
      return 409
    case "manager_unavailable":
    case "mastra_runtime_error":
      return 502
  }
}

function stableFingerprint(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue)
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)]),
    )
  }

  return value
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  })
}
