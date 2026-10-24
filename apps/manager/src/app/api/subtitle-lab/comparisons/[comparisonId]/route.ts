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
  context: { params: Promise<{ comparisonId: string }> },
) {
  const session = await requireSubtitleLabOperator(request)
  if (session instanceof NextResponse) return subtitleLabNotFound()
  const { comparisonId } = await context.params
  if (!BOUNDED_ID.safeParse(comparisonId).success) return subtitleLabNotFound()
  try {
    const comparison = await (
      await SubtitleLabAdminClient.configured()
    ).getComparison(comparisonId)
    return comparison ? privateNoStoreJson(comparison) : subtitleLabNotFound()
  } catch {
    return subtitleLabUpstreamUnavailable()
  }
}
