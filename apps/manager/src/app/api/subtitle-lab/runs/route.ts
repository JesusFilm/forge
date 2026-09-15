import { NextResponse } from "next/server"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import { subtitleLabPaginationSchema } from "@/features/subtitle-lab/subtitle-lab-contract"
import {
  guardSubtitleLabMutation,
  privateNoStoreJson,
  readBoundedSubtitleLabJson,
  requireSubtitleLabOperator,
  subtitleLabUpstreamUnavailable,
} from "@/features/subtitle-lab/subtitle-lab-route"
import { launchSubtitleEval } from "@/workflows/launchSubtitleEval"
import { createAndLaunchSubtitleEvalRun } from "@/workflows/subtitleEvalLaunch"

export async function GET(request: Request) {
  const session = await requireSubtitleLabOperator(request)
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
    const client = await SubtitleLabAdminClient.configured()
    return privateNoStoreJson(
      await client.listRuns(pagination.data.limit, pagination.data.after),
    )
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
    const result = await createAndLaunchSubtitleEvalRun({
      rawRequest: await readBoundedSubtitleLabJson(request),
      session,
      client: await SubtitleLabAdminClient.configured(),
      launch: launchSubtitleEval,
    })
    return NextResponse.json(result, { status: result.replayed ? 200 : 202 })
  } catch {
    return NextResponse.json(
      { error: "Subtitle evaluation launch was rejected." },
      { status: 400 },
    )
  }
}
