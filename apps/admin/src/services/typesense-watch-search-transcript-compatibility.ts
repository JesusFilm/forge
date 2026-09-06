import { Prisma, type PrismaClient } from "@prisma/client"

import { resolveActiveContentEmbeddingContract } from "./content-embedding-contract"

export type WatchSearchTranscriptCompatibilityIdentity = Readonly<{
  contentEmbeddingContractId: string
  transcriptChunkingVersion: string
}>

export class WatchSearchTranscriptCompatibilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WatchSearchTranscriptCompatibilityError"
  }
}

function requiredString(
  value: string | null | undefined,
  name: string,
): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new WatchSearchTranscriptCompatibilityError(`${name} is required`)
  }
  return normalized
}

type TranscriptChunkingVersionRow = {
  chunkingVersion: string | null
}

export async function resolveCurrentWatchSearchTranscriptCompatibility(
  prisma: Pick<PrismaClient, "$queryRaw">,
): Promise<WatchSearchTranscriptCompatibilityIdentity> {
  const contract = await resolveActiveContentEmbeddingContract(prisma)
  const rows = await prisma.$queryRaw<TranscriptChunkingVersionRow[]>(
    Prisma.sql`
      SELECT DISTINCT vt.chunking_version AS "chunkingVersion"
      FROM video_transcript vt
      JOIN video_transcript_chunk vtc
        ON vtc.transcript_id = vt.id
      WHERE vtc.embedding IS NOT NULL
        AND vt.embedding_provider = ${contract.storage.provider}
        AND vt.model = ${contract.storage.model}
        AND vt.dimensions = ${contract.storage.dimensions}
        AND vt.embedding_native_dimensions = ${contract.storage.nativeDimensions}
        AND vt.embedding_transform_version IS NOT DISTINCT FROM
          ${contract.storage.transformVersion}::text
        AND vtc.model = ${contract.storage.model}
        AND vtc.dimensions = ${contract.storage.dimensions}
      ORDER BY vt.chunking_version ASC NULLS FIRST
    `,
  )

  if (rows.length !== 1) {
    throw new WatchSearchTranscriptCompatibilityError(
      "Watch Search transcript compatibility requires one exact current chunking version",
    )
  }

  return Object.freeze({
    contentEmbeddingContractId: requiredString(
      contract.id,
      "content embedding contract id",
    ),
    transcriptChunkingVersion: requiredString(
      rows[0]?.chunkingVersion,
      "transcript chunking version",
    ),
  })
}
