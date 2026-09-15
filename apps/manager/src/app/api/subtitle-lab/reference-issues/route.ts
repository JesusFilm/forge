import { NextResponse } from "next/server"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import { subtitleLabPaginationSchema } from "@/features/subtitle-lab/subtitle-lab-contract"
import {
  privateNoStoreJson,
  requireSubtitleLabOperator,
  subtitleLabNotFound,
  subtitleLabUpstreamUnavailable,
} from "@/features/subtitle-lab/subtitle-lab-route"

import { referenceIssueStatusSchema } from "../operator-route-contract"

export async function GET(request: Request) {
  const session = await requireSubtitleLabOperator(request)
  if (session instanceof NextResponse) return subtitleLabNotFound()
  const url = new URL(request.url)
  const pagination = subtitleLabPaginationSchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    after: url.searchParams.get("after") ?? undefined,
  })
  const rawStatus = url.searchParams.get("status") ?? undefined
  const status = rawStatus
    ? referenceIssueStatusSchema.safeParse(rawStatus)
    : undefined
  if (!pagination.success || (status && !status.success)) {
    return privateNoStoreJson({ error: "Invalid query" }, { status: 400 })
  }
  try {
    return privateNoStoreJson(
      await (
        await SubtitleLabAdminClient.configured()
      ).listReferenceIssues(
        status?.data,
        pagination.data.limit,
        pagination.data.after,
      ),
    )
  } catch {
    return subtitleLabUpstreamUnavailable()
  }
}
