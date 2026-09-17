import { NextResponse } from "next/server"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import {
  guardSubtitleLabMutation,
  privateNoStoreJson,
  readBoundedSubtitleLabJson,
  requireSubtitleLabReviewer,
  subtitleLabNotFound,
} from "@/features/subtitle-lab/subtitle-lab-route"

export async function POST(request: Request) {
  const mutationError = guardSubtitleLabMutation(request)
  if (mutationError) return mutationError
  const session = await requireSubtitleLabReviewer(request)
  if (session instanceof NextResponse) return session
  try {
    const result = await (
      await SubtitleLabAdminClient.configured()
    ).submitReview(
      session,
      await readBoundedSubtitleLabJson(request, 256 * 1024),
    )
    return privateNoStoreJson(result, { status: result.replayed ? 200 : 201 })
  } catch {
    return subtitleLabNotFound()
  }
}
