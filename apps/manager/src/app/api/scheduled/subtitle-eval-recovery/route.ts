import { NextResponse } from "next/server"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import { authenticateServiceBearerRequest } from "@/lib/auth"
import { launchSubtitleEval } from "@/workflows/launchSubtitleEval"
import { recoverStaleSubtitleEvalRuns } from "@/workflows/subtitleEvalRecovery"

export async function POST(request: Request) {
  const authError = authenticateServiceBearerRequest(request)
  if (authError) return authError
  const outcomes = await recoverStaleSubtitleEvalRuns({
    client: await SubtitleLabAdminClient.configured(),
    launch: launchSubtitleEval,
  })
  return NextResponse.json({ outcomes })
}
