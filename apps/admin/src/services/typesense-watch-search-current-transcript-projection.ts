import type { PrismaClient } from "@prisma/client"
import { resolveWatchSearchRuntimeEnv } from "@/config/env"
import type { TypesenseClient } from "./typesense-client"
import { freezeCurrentWatchSearchProfile } from "./typesense-watch-search-profile"
import { resolveCurrentWatchSearchTranscriptCompatibility } from "./typesense-watch-search-transcript-compatibility"

export const WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID =
  "watch-search-current-transcript-projection"

export type CurrentWatchSearchTranscriptProjection = Readonly<{
  transcriptCollection: string
  contentEmbeddingContractId: string
  transcriptChunkingVersion: string
  projectionRevision: bigint
}>

type CurrentWatchSearchTranscriptProjectionInput = Readonly<{
  transcriptCollection: string
  contentEmbeddingContractId: string
  transcriptChunkingVersion: string
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

type StoredProjectionRow = {
  transcriptCollection: string | null
  contentEmbeddingContractId: string | null
  transcriptChunkingVersion: string | null
  projectionRevision: bigint
}

type ProjectionReader = Pick<
  PrismaClient,
  "watchSearchCurrentTranscriptProjection"
>
type ProjectionWriter = Pick<
  PrismaClient,
  "watchSearchCurrentTranscriptProjection"
>

type ProjectionFallbackReader = Pick<
  PrismaClient,
  "watchSearchCurrentTranscriptProjection" | "$queryRaw"
>

type AliasReader = Pick<TypesenseClient, "getAlias">

function normalizeStoredProjection(
  row: StoredProjectionRow,
): CurrentWatchSearchTranscriptProjection {
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

export function initialCurrentWatchSearchTranscriptProjectionRevision(): bigint {
  return (
    (resolveWatchSearchRuntimeEnv().transcriptProjectionRevision ?? 0n) + 1n
  )
}

async function readStoredCurrentWatchSearchTranscriptProjection(
  prisma: ProjectionReader,
): Promise<CurrentWatchSearchTranscriptProjection | null> {
  const row = await prisma.watchSearchCurrentTranscriptProjection.findUnique({
    where: { id: WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID },
  })
  return row ? normalizeStoredProjection(row) : null
}

export async function resolveCurrentWatchSearchTranscriptProjection(
  prisma: ProjectionReader,
): Promise<CurrentWatchSearchTranscriptProjection> {
  const projection =
    await readStoredCurrentWatchSearchTranscriptProjection(prisma)
  if (!projection) {
    throw new WatchSearchCurrentTranscriptProjectionError(
      "current transcript projection is missing",
    )
  }
  return projection
}

export async function advanceCurrentWatchSearchTranscriptProjection(
  prisma: ProjectionWriter,
  input: CurrentWatchSearchTranscriptProjectionInput,
): Promise<CurrentWatchSearchTranscriptProjection> {
  const row = await prisma.watchSearchCurrentTranscriptProjection.upsert({
    where: { id: WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID },
    create: {
      id: WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID,
      transcriptCollection: requiredString(
        input.transcriptCollection,
        "current transcript collection",
      ),
      contentEmbeddingContractId: requiredString(
        input.contentEmbeddingContractId,
        "current transcript content embedding contract id",
      ),
      transcriptChunkingVersion: requiredString(
        input.transcriptChunkingVersion,
        "current transcript chunking version",
      ),
      projectionRevision:
        initialCurrentWatchSearchTranscriptProjectionRevision(),
      version: 1,
    },
    update: {
      transcriptCollection: requiredString(
        input.transcriptCollection,
        "current transcript collection",
      ),
      contentEmbeddingContractId: requiredString(
        input.contentEmbeddingContractId,
        "current transcript content embedding contract id",
      ),
      transcriptChunkingVersion: requiredString(
        input.transcriptChunkingVersion,
        "current transcript chunking version",
      ),
      projectionRevision: { increment: 1 },
      version: { increment: 1 },
    },
  })
  return normalizeStoredProjection(row)
}

export async function resolveCurrentWatchSearchTranscriptProjectionWithFallback(input: {
  prisma: ProjectionFallbackReader
  currentProfile?: {
    binding: {
      transcript: string
    }
  }
  typesense?: AliasReader
}): Promise<CurrentWatchSearchTranscriptProjection> {
  const stored = await readStoredCurrentWatchSearchTranscriptProjection(
    input.prisma,
  )
  if (stored) return stored

  const transcriptCollection =
    input.currentProfile?.binding.transcript ??
    (input.typesense
      ? (await freezeCurrentWatchSearchProfile(input.typesense)).binding
          .transcript
      : null)
  if (!transcriptCollection) {
    throw new WatchSearchCurrentTranscriptProjectionError(
      "current transcript projection is missing",
    )
  }

  const runtimeProjectionRevision =
    resolveWatchSearchRuntimeEnv().transcriptProjectionRevision
  if (runtimeProjectionRevision == null || runtimeProjectionRevision < 1n) {
    throw new WatchSearchCurrentTranscriptProjectionError(
      "current transcript projection revision is missing",
    )
  }

  const compatibility = await resolveCurrentWatchSearchTranscriptCompatibility(
    input.prisma,
  )
  return Object.freeze({
    transcriptCollection: requiredString(
      transcriptCollection,
      "current transcript collection",
    ),
    contentEmbeddingContractId: compatibility.contentEmbeddingContractId,
    transcriptChunkingVersion: compatibility.transcriptChunkingVersion,
    projectionRevision: runtimeProjectionRevision,
  })
}
