import { NextResponse } from "next/server"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import {
  guardSubtitleLabMutation,
  privateNoStoreJson,
  readBoundedSubtitleLabJson,
  requireSubtitleLabOperator,
  subtitleLabNotFound,
} from "@/features/subtitle-lab/subtitle-lab-route"

import { createComparisonBodySchema } from "../operator-route-contract"

export async function POST(request: Request) {
  const session = await requireSubtitleLabOperator(request)
  if (session instanceof NextResponse) return subtitleLabNotFound()
  if (guardSubtitleLabMutation(request)) return subtitleLabNotFound()
  try {
    const body = createComparisonBodySchema.parse(
      await readBoundedSubtitleLabJson(request, 16 * 1024),
    )
    const result = await (
      await SubtitleLabAdminClient.configured()
    ).createComparison(session, body)
    return privateNoStoreJson(result, { status: result.replayed ? 200 : 201 })
  } catch {
    return privateNoStoreJson(
      { error: "Comparison was rejected." },
      { status: 400 },
    )
  }
}
