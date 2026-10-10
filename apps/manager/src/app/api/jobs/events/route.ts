import { authenticateRequest } from "@/lib/auth"
import {
  createJobEventStreamResponse,
  subscribeToAllJobEvents,
} from "@/lib/job-events"
import { listJobSummaries } from "@/lib/state"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const jobs = await listJobSummaries()

  return createJobEventStreamResponse({
    request,
    initialEvent: {
      type: "snapshot",
      jobs,
    },
    subscribe: subscribeToAllJobEvents,
  })
}
