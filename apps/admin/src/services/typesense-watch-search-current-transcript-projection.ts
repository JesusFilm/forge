import type { PrismaClient } from "@prisma/client"

export const WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID =
  "watch-search-current-transcript-projection"

export type CurrentWatchSearchTranscriptProjection = Readonly<{
  transcriptCollection: string
  contentEmbeddingContractId: string
  transcriptChunkingVersion: string
  projectionRevision: bigint
}>

export class WatchSearchCurrentTranscriptProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WatchSearchCurrentTranscriptProjectionError"
  }
}

function requiredString(
  value: string | null | undefined,
  name: string,
): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new WatchSearchCurrentTranscriptProjectionError(`${name} is required`)
  }
  return normalized
}

export async function resolveCurrentWatchSearchTranscriptProjection(
  prisma: Pick<PrismaClient, "watchSearchCurrentTranscriptProjection">,
): Promise<CurrentWatchSearchTranscriptProjection> {
  const row = await prisma.watchSearchCurrentTranscriptProjection.findUnique({
    where: { id: WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID },
  })
  if (!row) {
    throw new WatchSearchCurrentTranscriptProjectionError(
      "current transcript projection is missing",
    )
  }
  if (row.projectionRevision < 1n) {
    throw new WatchSearchCurrentTranscriptProjectionError(
      "current transcript projection revision must be at least 1",
    )
  }
  return Object.freeze({
    transcriptCollection: requiredString(
      row.transcriptCollection,
      "current transcript collection",
    ),
    contentEmbeddingContractId: requiredString(
      row.contentEmbeddingContractId,
      "current transcript content embedding contract id",
    ),
    transcriptChunkingVersion: requiredString(
      row.transcriptChunkingVersion,
      "current transcript chunking version",
    ),
    projectionRevision: row.projectionRevision,
  })
}
