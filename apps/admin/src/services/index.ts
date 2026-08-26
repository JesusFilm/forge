// Service registry — assembled once per request in createContext.
//
// Each service receives the Prisma client and the requesting principal.
// Services own all mutation logic: Zod validation, ABAC checks, Prisma
// calls. Resolvers delegate to services; they never call Prisma directly
// for mutations.

import type { PrismaClient } from "@prisma/client"
import { env, resolveWatchSearchRuntimeEnv } from "@/config/env"
import { ExperienceService } from "@/services/experience.service"
import { ExperiencePreviewService } from "@/services/experience-preview.service"
import { ExperienceSearchService } from "@/services/experience.search"
import { ManagerJobService } from "@/services/manager-job.service"
import { ManagerReadModelService } from "@/services/manager-read-model.service"
import { MediaAssetService } from "@/services/media-asset.service"
import { MediaFolderService } from "@/services/media-folder.service"
import { ScripturePassageService } from "@/services/scripture-passage.service"
import { SearchWatchabilityService } from "@/services/search-watchability"
import { SeoExperimentService } from "@/services/seo-experiment.service"
import { SubtitleEvalService } from "@/services/subtitle-eval.service"
import { VideoService } from "@/services/video.service"
import { VideoSearchSocialService } from "@/services/video-search-social.service"
import { WatchEventService } from "@/services/watch-events.service"
import { WatchSearchEventService } from "@/services/watch-search-events.service"
import { WatchSearchService } from "@/services/watch-search.service"
import { createTypesenseWatchSearchSuggestionsService } from "@/services/typesense-watch-search-suggestions"
import { TypesenseClient } from "@/services/typesense-client"
import { TypesenseWatchSearchCandidateGenerationService } from "@/services/typesense-watch-search-candidate-generation"
import {
  candidateWatchSearchApplicationRevision,
  candidateWatchSearchRankingRevision,
} from "@/services/typesense-watch-search-candidate-identity"
import {
  createCandidateWatchSearchProfile,
  createCurrentWatchSearchProfile,
  freezeCurrentWatchSearchProfile,
  type TypesenseWatchSearchProfile,
  watchSearchBindingMembers,
} from "@/services/typesense-watch-search-profile"
import {
  createTypesenseWatchSearchService,
  TypesenseWatchSearchService,
  TypesenseWatchSearchUnavailableError,
} from "@/services/typesense-watch-search.service"
import { WatchSettingService } from "@/services/watch-setting.service"

export type Services = ReturnType<typeof createServices>

type ServingProfileResolver = Pick<
  TypesenseWatchSearchCandidateGenerationService,
  "getPointer" | "resolveGeneration"
>

export async function resolveWatchSearchServingProfile(input: {
  selector: string
  applicationRevision: string | null
  rankingRevision: string | null
  transcriptProjectionRevision: bigint | null
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
  if (!input.applicationRevision) {
    throw new TypesenseWatchSearchUnavailableError(
      "Candidate serving requires an application revision",
    )
  }
  if (!input.rankingRevision) {
    throw new TypesenseWatchSearchUnavailableError(
      "Candidate serving requires a ranking revision",
    )
  }
  if (input.transcriptProjectionRevision == null) {
    throw new TypesenseWatchSearchUnavailableError(
      "Candidate serving requires a transcript projection revision",
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

  const generation = await input.generations.resolveGeneration({
    generationId: match[1]!,
    applicationRevision: input.applicationRevision,
    transcriptCollection,
    transcriptProjectionRevision: input.transcriptProjectionRevision,
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

export const CANDIDATE_SERVING_SERVICE_CACHE_TTL_MS = 30_000

type CandidateServingServiceCacheEntry = {
  promise: Promise<TypesenseWatchSearchService>
  expiresAt: number
}

const candidateServingServices = new WeakMap<
  PrismaClient,
  CandidateServingServiceCacheEntry
>()

export function resolveCachedCandidateServingService(input: {
  prisma: PrismaClient
  create(): Promise<TypesenseWatchSearchService>
  now?: () => number
}): Promise<TypesenseWatchSearchService> {
  const now = (input.now ?? Date.now)()
  const cached = candidateServingServices.get(input.prisma)
  if (cached && cached.expiresAt > now) return cached.promise

  const entry: CandidateServingServiceCacheEntry = {
    promise: Promise.resolve().then(input.create),
    expiresAt: now + CANDIDATE_SERVING_SERVICE_CACHE_TTL_MS,
  }
  entry.promise = entry.promise.catch((error) => {
    if (candidateServingServices.get(input.prisma) === entry) {
      candidateServingServices.delete(input.prisma)
    }
    throw error
  })
  candidateServingServices.set(input.prisma, entry)
  return entry.promise
}

function createServingTypesenseWatchSearchService(prisma: PrismaClient) {
  if (env.WATCH_SEARCH_TYPESENSE_PROFILE === "CURRENT") {
    return createTypesenseWatchSearchService(prisma)
  }

  const host = process.env.TYPESENSE_HOST
  const apiKey = env.TYPESENSE_SEARCH_API_KEY
  if (!host || !apiKey) return null
  const resolveService = () =>
    resolveCachedCandidateServingService({
      prisma,
      create: async () => {
        const runtimeSearchEnv = resolveWatchSearchRuntimeEnv()
        const typesense = new TypesenseClient({
          host,
          apiKey,
          timeoutMs: 2_000,
        })
        const generations = new TypesenseWatchSearchCandidateGenerationService(
          prisma,
          typesense,
        )
        const profile = await resolveWatchSearchServingProfile({
          selector: env.WATCH_SEARCH_TYPESENSE_PROFILE,
          applicationRevision: candidateWatchSearchApplicationRevision(),
          rankingRevision: candidateWatchSearchRankingRevision(),
          transcriptProjectionRevision:
            runtimeSearchEnv.transcriptProjectionRevision ?? null,
          qrelsRevision: env.WATCH_SEARCH_SERVING_QRELS_REVISION ?? null,
          typesense,
          generations,
        })
        return new TypesenseWatchSearchService(prisma, typesense, { profile })
      },
    })
  return {
    search: async (
      ...args: Parameters<TypesenseWatchSearchService["search"]>
    ) => (await resolveService()).search(...args),
  }
}

export function createServices(prisma: PrismaClient) {
  return {
    experience: new ExperienceService(prisma),
    experiencePreview: new ExperiencePreviewService(prisma),
    experienceSearch: new ExperienceSearchService(prisma),
    managerJob: new ManagerJobService(prisma),
    managerReadModel: new ManagerReadModelService(prisma),
    mediaAsset: new MediaAssetService(prisma),
    mediaFolder: new MediaFolderService(prisma),
    scripturePassage: new ScripturePassageService(prisma),
    searchWatchability: new SearchWatchabilityService(prisma),
    seoExperiment: new SeoExperimentService(prisma),
    subtitleEval: new SubtitleEvalService(prisma),
    video: new VideoService(prisma),
    videoSearchSocial: new VideoSearchSocialService(prisma),
    watchEvent: new WatchEventService(prisma),
    watchSearchEvent: new WatchSearchEventService(prisma),
    watchSearch: new WatchSearchService(prisma),
    typesenseWatchSearch: createServingTypesenseWatchSearchService(prisma),
    typesenseWatchSearchSuggestions:
      createTypesenseWatchSearchSuggestionsService(prisma),
    watchSetting: new WatchSettingService(prisma),
  }
}
