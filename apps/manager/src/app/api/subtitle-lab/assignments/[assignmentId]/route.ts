import { NextResponse } from "next/server"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import { BOUNDED_ID } from "@/features/subtitle-lab/subtitle-lab-contract"
import {
  privateNoStoreJson,
  requireSubtitleLabReviewer,
  subtitleLabNotFound,
} from "@/features/subtitle-lab/subtitle-lab-route"
import { hasReviewerLanguageGrant } from "@/lib/auth"

export async function GET(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const session = await requireSubtitleLabReviewer(request)
  if (session instanceof NextResponse) return session
  const { assignmentId } = await context.params
  if (!BOUNDED_ID.safeParse(assignmentId).success) return subtitleLabNotFound()
  try {
    const detail = await (
      await SubtitleLabAdminClient.configured()
    ).reviewerDetail(session, assignmentId)
    if (
      !detail ||
      !hasReviewerLanguageGrant(
        session,
        detail.targetLanguageId,
        detail.targetLanguageSlug,
      )
    ) {
      return subtitleLabNotFound()
    }
    return privateNoStoreJson(detail)
  } catch {
    return subtitleLabNotFound()
  }
}
