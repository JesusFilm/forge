import { NextResponse } from "next/server"
import {
  ingestAgenticSubtitleEvent,
  isValidAgenticServiceRequest,
  parseAgenticSubtitleEvent,
} from "@/lib/agentic-subtitle-enrichment"

function jsonError(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json({ ok: false, code, message }, { status })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  if (!isValidAgenticServiceRequest(request)) {
    return jsonError(
      "service_bearer_required",
      "Agentic service bearer token required",
      403,
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError("invalid_event", "Request body must be valid JSON.", 400)
  }

  const parsed = parseAgenticSubtitleEvent(body)
  if (!parsed.success) {
    return jsonError(
      "invalid_event",
      "Agentic subtitle enrichment event is invalid.",
      400,
    )
  }

  const { runId } = await context.params
  if (parsed.data.runId !== runId) {
    return jsonError(
      "invalid_event",
      "Agentic subtitle enrichment event runId does not match the route.",
      400,
    )
  }

  try {
    const result = await ingestAgenticSubtitleEvent(parsed.data)
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    console.error(
      "[api/agentic/subtitle-enrichment/events] Failed to ingest event:",
      error,
    )
    return jsonError(
      "event_ingest_failed",
      "Failed to ingest Agentic subtitle enrichment event.",
      502,
    )
  }
}
