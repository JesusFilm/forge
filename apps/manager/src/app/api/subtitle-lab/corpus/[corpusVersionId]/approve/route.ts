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

import { corpusApprovalBodySchema } from "../../../operator-route-contract"

export async function POST(
  request: Request,
  context: { params: Promise<{ corpusVersionId: string }> },
) {
  const session = await requireSubtitleLabOperator(request)
  if (session instanceof NextResponse) return subtitleLabNotFound()
  if (guardSubtitleLabMutation(request)) return subtitleLabNotFound()
  const { corpusVersionId } = await context.params
  if (!BOUNDED_ID.safeParse(corpusVersionId).success) {
    return subtitleLabNotFound()
  }
  try {
    const body = corpusApprovalBodySchema.parse(
      await readBoundedSubtitleLabJson(request, 32 * 1024),
    )
    const client = await SubtitleLabAdminClient.configured()
    const corpus = await client.getCorpusVersion(corpusVersionId)
    if (!corpus) return subtitleLabNotFound()
    const result = await client.approveCorpus(session, {
      corpusVersionId,
      reason: body.reason,
      certification: {
        ...body.certification,
        authority: corpus.authority,
        sourceTracksVerified: corpus.cells.length,
        referenceTracksVerified: corpus.cells.length,
      },
    })
    return privateNoStoreJson(result, { status: 200 })
  } catch {
    return privateNoStoreJson(
      { error: "Corpus certification was rejected." },
      { status: 400 },
    )
  }
}
