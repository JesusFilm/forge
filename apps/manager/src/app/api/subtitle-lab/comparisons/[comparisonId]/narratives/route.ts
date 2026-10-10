import { NextResponse } from "next/server"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import { BOUNDED_ID } from "@/features/subtitle-lab/subtitle-lab-contract"
import {
  guardSubtitleLabMutation,
  privateNoStoreJson,
  readBoundedSubtitleLabJson,
  requireSubtitleLabOperator,
  subtitleLabNotFound,
} from "@/features/subtitle-lab/subtitle-lab-route"

import { appendNarrativeBodySchema } from "../../../operator-route-contract"

export async function POST(
  request: Request,
  context: { params: Promise<{ comparisonId: string }> },
) {
  const session = await requireSubtitleLabOperator(request)
  if (session instanceof NextResponse) return subtitleLabNotFound()
  if (guardSubtitleLabMutation(request)) return subtitleLabNotFound()
  const { comparisonId } = await context.params
  if (!BOUNDED_ID.safeParse(comparisonId).success) return subtitleLabNotFound()
  try {
    const body = appendNarrativeBodySchema.parse(
      await readBoundedSubtitleLabJson(request, 24 * 1024),
    )
    const result = await (
      await SubtitleLabAdminClient.configured()
    ).appendNarrative(session, { comparisonId, ...body })
    return privateNoStoreJson(result, { status: 201 })
  } catch {
    return privateNoStoreJson(
      { error: "Experiment narrative was rejected." },
      { status: 400 },
    )
  }
}
