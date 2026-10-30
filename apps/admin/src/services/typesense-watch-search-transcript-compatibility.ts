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
  // Compatibility needs one matching chunk per version, not every chunk from
  // every transcript. Keep this live check without the corpus-sized join.
  const rows = await prisma.$queryRaw<TranscriptChunkingVersionRow[]>(
    Prisma.sql`
      WITH compatible_transcripts AS NOT MATERIALIZED (
        SELECT id, chunking_version
        FROM video_transcript
        WHERE embedding_provider = ${contract.storage.provider}
          AND model = ${contract.storage.model}
          AND dimensions = ${contract.storage.dimensions}
          AND embedding_native_dimensions = ${contract.storage.nativeDimensions}
          AND embedding_transform_version IS NOT DISTINCT FROM
            ${contract.storage.transformVersion}::text
      )
      SELECT versions.chunking_version AS "chunkingVersion"
      FROM (
        SELECT DISTINCT chunking_version FROM compatible_transcripts
      ) versions
      WHERE EXISTS (
        SELECT 1
        FROM compatible_transcripts vt
        JOIN video_transcript_chunk vtc ON vtc.transcript_id = vt.id
        WHERE vt.chunking_version IS NOT DISTINCT FROM versions.chunking_version
          AND vtc.embedding IS NOT NULL
          AND vtc.model = ${contract.storage.model}
          AND vtc.dimensions = ${contract.storage.dimensions}
      )
      ORDER BY versions.chunking_version ASC NULLS FIRST
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
