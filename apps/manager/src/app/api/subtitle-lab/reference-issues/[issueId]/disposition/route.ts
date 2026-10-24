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

import { referenceIssueDispositionBodySchema } from "../../../operator-route-contract"

export async function POST(
  request: Request,
  context: { params: Promise<{ issueId: string }> },
) {
  const session = await requireSubtitleLabOperator(request)
  if (session instanceof NextResponse) return subtitleLabNotFound()
  if (guardSubtitleLabMutation(request)) return subtitleLabNotFound()
  const { issueId } = await context.params
  if (!BOUNDED_ID.safeParse(issueId).success) return subtitleLabNotFound()
  try {
    const body = referenceIssueDispositionBodySchema.parse(
      await readBoundedSubtitleLabJson(request, 16 * 1024),
    )
    const result = await (
      await SubtitleLabAdminClient.configured()
    ).dispositionReferenceIssue(session, { issueId, ...body })
    return privateNoStoreJson(result, { status: 201 })
  } catch {
    return privateNoStoreJson(
      { error: "Reference issue disposition was rejected." },
      { status: 400 },
    )
  }
}
