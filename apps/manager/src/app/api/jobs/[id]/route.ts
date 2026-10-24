import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import { getJobLookup } from "@/lib/state"

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

  return NextResponse.json({ job: lookup.job })
}
