import { NextResponse } from "next/server"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import {
  assignmentRequestSchema,
  subtitleLabPaginationSchema,
} from "@/features/subtitle-lab/subtitle-lab-contract"
import {
  guardSubtitleLabMutation,
  privateNoStoreJson,
  readBoundedSubtitleLabJson,
  requireSubtitleLabOperator,
  requireSubtitleLabReviewer,
  subtitleLabUpstreamUnavailable,
} from "@/features/subtitle-lab/subtitle-lab-route"

export async function GET(request: Request) {
  const session = await requireSubtitleLabReviewer(request)
  if (session instanceof NextResponse) return session
  const url = new URL(request.url)
  const pagination = subtitleLabPaginationSchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    after: url.searchParams.get("after") ?? undefined,
  })
  if (!pagination.success) {
    return privateNoStoreJson({ error: "Invalid pagination" }, { status: 400 })
  }
  try {
    const page = await (
      await SubtitleLabAdminClient.configured()
    ).reviewerQueue(session, pagination.data.limit, pagination.data.after)
    return privateNoStoreJson(page ?? { nodes: [], nextCursor: null })
  } catch {
    return subtitleLabUpstreamUnavailable()
  }
}

export async function POST(request: Request) {
  const mutationError = guardSubtitleLabMutation(request)
  if (mutationError) return mutationError
  const session = await requireSubtitleLabOperator(request)
  if (session instanceof NextResponse) return session
  try {
    const body = assignmentRequestSchema.parse(
      await readBoundedSubtitleLabJson(request, 32 * 1024),
    )
    const result = await (
      await SubtitleLabAdminClient.configured()
    ).createAssignment(session, {
      ...body,
      specialistDimension: body.specialistDimension ?? null,
    })
    return NextResponse.json(result, { status: 201 })
  } catch {
    return NextResponse.json(
      { error: "Assignment was rejected." },
      { status: 400 },
    )
  }
}
