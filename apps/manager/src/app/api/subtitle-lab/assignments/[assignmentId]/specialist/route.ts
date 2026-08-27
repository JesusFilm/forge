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

import { specialistAssignmentBodySchema } from "../../../operator-route-contract"

export async function POST(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const session = await requireSubtitleLabOperator(request)
  if (session instanceof NextResponse) return subtitleLabNotFound()
  if (guardSubtitleLabMutation(request)) return subtitleLabNotFound()
  const { assignmentId } = await context.params
  if (!BOUNDED_ID.safeParse(assignmentId).success) return subtitleLabNotFound()
  try {
    const body = specialistAssignmentBodySchema.parse(
      await readBoundedSubtitleLabJson(request, 8 * 1024),
    )
    const result = await (
      await SubtitleLabAdminClient.configured()
    ).assignSpecialist(session, { assignmentId, ...body })
    return privateNoStoreJson(result, { status: result.replayed ? 200 : 201 })
  } catch {
    return privateNoStoreJson(
      { error: "Specialist assignment was rejected." },
      { status: 400 },
    )
  }
}
