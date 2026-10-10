import { NextResponse } from "next/server"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import {
  BOUNDED_ID,
  subtitleLabPaginationSchema,
} from "@/features/subtitle-lab/subtitle-lab-contract"
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
  if (session instanceof NextResponse) return subtitleLabNotFound()
  const { runId } = await context.params
  if (!BOUNDED_ID.safeParse(runId).success) return subtitleLabNotFound()
  const url = new URL(request.url)
  const rawRunCellId = url.searchParams.get("runCellId") ?? undefined
  const runCellId = rawRunCellId
    ? BOUNDED_ID.safeParse(rawRunCellId)
    : undefined
  const pagination = subtitleLabPaginationSchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    after: url.searchParams.get("after") ?? undefined,
  })
  if (!pagination.success || (runCellId && !runCellId.success)) {
    return privateNoStoreJson({ error: "Invalid query" }, { status: 400 })
  }
  try {
    return privateNoStoreJson(
      await (
        await SubtitleLabAdminClient.configured()
      ).listOperatorAssignments(
        runId,
        runCellId?.data,
        pagination.data.limit,
        pagination.data.after,
      ),
    )
  } catch {
    return subtitleLabUpstreamUnavailable()
  }
}
