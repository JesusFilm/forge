import { NextResponse } from "next/server"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import {
  BOUNDED_ID,
  subtitleLabPaginationSchema,
} from "@/features/subtitle-lab/subtitle-lab-contract"
import {
  privateNoStoreJson,
  requireSubtitleLabOperator,
  subtitleLabNotFound,
  subtitleLabUpstreamUnavailable,
} from "@/features/subtitle-lab/subtitle-lab-route"

import { specialistDimensionSchema } from "../operator-route-contract"

export async function GET(request: Request) {
  const session = await requireSubtitleLabOperator(request)
  if (session instanceof NextResponse) return subtitleLabNotFound()
  const url = new URL(request.url)
  const targetLanguageId = BOUNDED_ID.safeParse(
    url.searchParams.get("targetLanguageId"),
  )
  const targetLanguageSlug = BOUNDED_ID.safeParse(
    url.searchParams.get("targetLanguageSlug"),
  )
  const pagination = subtitleLabPaginationSchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    after: url.searchParams.get("after") ?? undefined,
  })
  const specialistDimension = specialistDimensionSchema.safeParse(
    url.searchParams.get("specialistDimension") ?? undefined,
  )
  if (
    !targetLanguageId.success ||
    !targetLanguageSlug.success ||
    !pagination.success ||
    !specialistDimension.success
  ) {
    return privateNoStoreJson({ error: "Invalid query" }, { status: 400 })
  }
  try {
    return privateNoStoreJson(
      await (
        await SubtitleLabAdminClient.configured()
      ).listOperatorReviewerCandidates(
        targetLanguageId.data,
        targetLanguageSlug.data,
        specialistDimension.data,
        pagination.data.limit,
        pagination.data.after,
      ),
    )
  } catch {
    return subtitleLabUpstreamUnavailable()
  }
}
