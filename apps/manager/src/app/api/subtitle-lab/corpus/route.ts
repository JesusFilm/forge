import { NextResponse } from "next/server"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import {
  guardSubtitleLabMutation,
  readBoundedSubtitleLabJson,
  requireSubtitleLabOperator,
} from "@/features/subtitle-lab/subtitle-lab-route"
import { activateSubtitleEvalCorpus } from "@/services/subtitle-corpus-activation"

export async function POST(request: Request) {
  const mutationError = guardSubtitleLabMutation(request)
  if (mutationError) return mutationError
  const session = await requireSubtitleLabOperator(request)
  if (session instanceof NextResponse) return session
  try {
    const activated = await activateSubtitleEvalCorpus(
      await readBoundedSubtitleLabJson(request, 512 * 1024),
    )
    const client = await SubtitleLabAdminClient.configured()
    const result = await client.importCorpus(session, {
      ...activated,
      supersedesVersionId: activated.supersedesVersionId ?? null,
    })
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 })
  } catch {
    return NextResponse.json(
      { error: "Subtitle corpus activation was rejected." },
      { status: 400 },
    )
  }
}
