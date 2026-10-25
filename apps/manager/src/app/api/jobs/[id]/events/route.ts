import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import {
  createJobEventStreamResponse,
  subscribeToJobEvents,
} from "@/lib/job-events"
import { getJobLookup } from "@/lib/state"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { id } = await params
  const lookup = await getJobLookup(id)

  if (lookup.status === "error") {
    return NextResponse.json({ error: "Failed to load job" }, { status: 502 })
  }

  if (lookup.status === "not-found") {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  return createJobEventStreamResponse({
    request,
    initialEvent: {
      type: "snapshot",
      job: lookup.job,
    },
    subscribe: (listener) => subscribeToJobEvents(id, listener),
  })
}
