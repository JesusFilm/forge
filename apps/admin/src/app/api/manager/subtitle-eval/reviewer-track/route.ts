import { NextResponse } from "next/server"
import { z } from "zod"

import { isValidManagerServiceToken } from "@/auth/manager-service-token"
import { verifySubtitleReviewAssertion } from "@/auth/subtitle-review-assertion"
import { prisma } from "@/db/client"
import { SubtitleEvalService } from "@/services/subtitle-eval.service"
import { readBoundedManagerJson } from "../../route-utils"

const Payload = z
  .object({
    assignmentId: z.string().min(1).max(191),
    contentId: z.string().regex(/^[a-f0-9]{64}$/),
    assertion: z.string().min(1).max(16_384),
  })
  .strict()

/**
 * Manager-BFF-only bridge. The OAuth service credential never reaches the
 * browser; the response locator is consumed server-side to stream media.
 */
export async function POST(request: Request) {
  if (
    !(await isValidManagerServiceToken(
      request.headers.get("authorization"),
      "admin:manager-backend",
    ))
  ) {
    return NextResponse.json(
      { error: "Manager OAuth required" },
      { status: 403 },
    )
  }
  let body: unknown
  try {
    body = await readBoundedManagerJson(request)
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = Payload.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid track request" },
      { status: 400 },
    )
  }
  try {
    const assertion = await verifySubtitleReviewAssertion(parsed.data.assertion)
    if (assertion.assignmentId !== parsed.data.assignmentId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const locator = await new SubtitleEvalService(
      prisma,
    ).resolveReviewerTrackObject({
      assertion,
      contentId: parsed.data.contentId,
    })
    return NextResponse.json({
      locator: { ...locator, byteLength: locator.byteLength.toString() },
    })
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
}
