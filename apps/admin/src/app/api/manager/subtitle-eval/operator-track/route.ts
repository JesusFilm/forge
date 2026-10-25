import { NextResponse } from "next/server"
import { z } from "zod"

import { isValidManagerServiceToken } from "@/auth/manager-service-token"
import { MANAGER_BACKEND_PRINCIPAL } from "@/auth/principal"
import { prisma } from "@/db/client"
import { SubtitleEvalService } from "@/services/subtitle-eval.service"
import { readBoundedManagerJson } from "../../route-utils"

const Payload = z
  .object({
    assignmentId: z.string().min(1).max(191),
    contentId: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

/** Manager-BFF-only locator. Object keys never cross the BFF boundary. */
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
    const locator = await new SubtitleEvalService(
      prisma,
    ).resolveOperatorTrackObject({
      user: MANAGER_BACKEND_PRINCIPAL,
      ...parsed.data,
    })
    return NextResponse.json({
      locator: { ...locator, byteLength: locator.byteLength.toString() },
    })
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
}
