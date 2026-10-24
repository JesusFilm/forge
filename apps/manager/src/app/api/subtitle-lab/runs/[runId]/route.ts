import { NextResponse } from "next/server"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import { BOUNDED_ID } from "@/features/subtitle-lab/subtitle-lab-contract"
import {
  privateNoStoreJson,
  requireSubtitleLabOperator,
  subtitleLabNotFound,
  subtitleLabUpstreamUnavailable,
} from "@/features/subtitle-lab/subtitle-lab-route"

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const session = await requireSubtitleLabOperator(request)
  if (session instanceof NextResponse) return session
  const { runId } = await context.params
  if (!BOUNDED_ID.safeParse(runId).success) return subtitleLabNotFound()
  try {
    const run = await (await SubtitleLabAdminClient.configured()).getRun(runId)
    return run ? privateNoStoreJson(run) : subtitleLabNotFound()
  } catch {
    return subtitleLabUpstreamUnavailable()
  }
}
