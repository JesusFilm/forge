import type { TypesenseClient } from "./typesense-client"
import type { TypesenseWatchSearchCandidateGenerationService } from "./typesense-watch-search-candidate-generation"
import {
  createCandidateWatchSearchProfile,
  createCurrentWatchSearchProfile,
  freezeCurrentWatchSearchProfile,
  watchSearchBindingMembers,
  type TypesenseWatchSearchProfile,
} from "./typesense-watch-search-profile"
import { TypesenseWatchSearchUnavailableError } from "./typesense-watch-search.service"

type ServingProfileResolver = Pick<
  TypesenseWatchSearchCandidateGenerationService,
  "getPointer" | "resolveGeneration"
>

export async function resolveWatchSearchServingProfile(input: {
  selector: string
  indexContractRevision: string | null
  rankingRevision: string | null
  transcriptProjection: {
    transcriptCollection: string
    contentEmbeddingContractId: string
    transcriptChunkingVersion: string
    projectionRevision: bigint
  } | null
  qrelsRevision: string | null
  typesense: Pick<TypesenseClient, "getAlias">
  generations: ServingProfileResolver
}): Promise<TypesenseWatchSearchProfile> {
  if (input.selector === "CURRENT") return createCurrentWatchSearchProfile()
  const match = /^CANDIDATE:([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/.exec(
    input.selector,
  )
  if (!match) {
    throw new TypesenseWatchSearchUnavailableError(
      "Invalid Typesense Watch Search serving profile",
    )
  }
  if (!input.indexContractRevision) {
    throw new TypesenseWatchSearchUnavailableError(
      "Candidate serving requires an index contract revision",
    )
  }
  if (!input.rankingRevision) {
    throw new TypesenseWatchSearchUnavailableError(
      "Candidate serving requires a ranking revision",
    )
  }
  if (!input.transcriptProjection) {
    throw new TypesenseWatchSearchUnavailableError(
      "Candidate serving requires a published transcript projection",
    )
  }
  if (!input.qrelsRevision) {
    throw new TypesenseWatchSearchUnavailableError(
      "Candidate serving requires a qrels revision",
    )
  }

  const servingPointer = await input.generations.getPointer("SERVING")
  if (servingPointer.generationId !== match[1]) {
    throw new TypesenseWatchSearchUnavailableError(
      "Selected candidate is not pinned by the serving pointer",
    )
  }

  const currentProfile = await freezeCurrentWatchSearchProfile(input.typesense)
  const transcriptCollection = currentProfile.binding.transcript
  if (
    transcriptCollection !== input.transcriptProjection.transcriptCollection
  ) {
    throw new TypesenseWatchSearchUnavailableError(
      "Current transcript alias drifted from the published transcript projection",
    )
  }

  const generation = await input.generations.resolveGeneration({
    generationId: match[1]!,
    indexContractRevision: input.indexContractRevision,
    transcriptCollection,
    contentEmbeddingContractId:
      input.transcriptProjection.contentEmbeddingContractId,
    transcriptChunkingVersion:
      input.transcriptProjection.transcriptChunkingVersion,
    requireQualified: true,
    currentBindings: watchSearchBindingMembers(currentProfile),
    qrelsRevision: input.qrelsRevision,
    rankingRevision: input.rankingRevision,
  })
  return createCandidateWatchSearchProfile(
    generation,
    input.qrelsRevision.trim(),
  )
}
