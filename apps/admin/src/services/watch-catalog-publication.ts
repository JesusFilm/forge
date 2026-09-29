import type { PrismaClient } from "@prisma/client"
import type { TypesenseWatchSearchCandidateGenerationService } from "./typesense-watch-search-candidate-generation"
import {
  createCandidateWatchSearchProfile,
  type TypesenseWatchSearchProfile,
} from "./typesense-watch-search-profile"

export const WATCH_CATALOG_PUBLICATION_ID = "core"
const RELEVANT_PHASES = new Set([
  "languages",
  "keywords",
  "video-origins",
  "videos",
  "video-images",
  "video-editions",
  "video-subtitles",
  "video-dubs",
  "video-dub-downloads",
])
type PhaseSummary = {
  phase: string
  errors?: number
  created?: number
  updated?: number
  softDeleted?: number
}

export function shouldRequestWatchCatalogPublication(
  phases: readonly PhaseSummary[],
): boolean {
  // A retry can report zero changes after its previous attempt committed the
  // data but lost the completion acknowledgment. Always queue successful
  // relevant runs; the publisher's content digest avoids redundant indexing.
  return (
    phases.length > 0 &&
    phases.every((p) => p.errors === 0) &&
    phases.some((p) => RELEVANT_PHASES.has(p.phase))
  )
}

export async function requestWatchCatalogPublication(
  prisma: Pick<PrismaClient, "watchCatalogPublication">,
): Promise<void> {
  const now = new Date()
  await prisma.watchCatalogPublication.upsert({
    where: { id: WATCH_CATALOG_PUBLICATION_ID },
    create: {
      id: WATCH_CATALOG_PUBLICATION_ID,
      requestedVersion: 1,
      lastRequestedAt: now,
    },
    update: {
      requestedVersion: { increment: 1 },
      lastRequestedAt: now,
      retryAt: now,
      attempts: 0,
    },
  })
}

/** Baseline qualification is checked by the caller, never inherited as a
 * passing evaluation of this different content snapshot. */
export async function resolvePublishedWatchCatalog({
  prisma,
  base,
  generations,
  rankingRevision,
}: {
  prisma: Pick<PrismaClient, "watchCatalogPublication">
  base: TypesenseWatchSearchProfile
  generations: Pick<
    TypesenseWatchSearchCandidateGenerationService,
    "resolveGeneration"
  >
  rankingRevision: string
}): Promise<TypesenseWatchSearchProfile> {
  if (base.kind !== "CANDIDATE" || !base.generationId) return base
  const publication = await prisma.watchCatalogPublication.findUnique({
    where: { id: WATCH_CATALOG_PUBLICATION_ID },
  })
  if (
    !publication?.generationId ||
    publication.baseGenerationId !== base.generationId ||
    publication.rankingRevision !== rankingRevision
  )
    return base
  const generation = await generations.resolveGeneration({
    generationId: publication.generationId,
    indexContractRevision: base.indexContractRevision!,
    transcriptCollection: base.binding.transcript,
    contentEmbeddingContractId: base.contentEmbeddingContractId!,
    transcriptChunkingVersion: base.transcriptChunkingVersion!,
  })
  return createCandidateWatchSearchProfile(
    generation,
    `catalog-refresh:${publication.searchVersion}:${base.qrelsRevision}`,
  )
}
