import { NextResponse } from "next/server"
import { loadJobReviewContext } from "@/features/jobs/review-player/load-job-review-context"
import { authenticateRequest } from "@/lib/auth"
import { getJob } from "@/lib/state"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await authenticateRequest(request)
  if (authError) {
    return authError
  }

  const { id } = await params
  const job = await getJob(id)

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  const reviewContext = await loadJobReviewContext(job)

  return NextResponse.json({ reviewContext })
}
