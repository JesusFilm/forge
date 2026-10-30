import { resolvePublishedWatchCatalog } from "./watch-catalog-publication"
// Service registry — assembled once per request in createContext.
//
// Each service receives the Prisma client and the requesting principal.
// Services own all mutation logic: Zod validation, ABAC checks, Prisma
// calls. Resolvers delegate to services; they never call Prisma directly
// for mutations.

import type { PrismaClient } from "@prisma/client"
import { env, resolveWatchCatalogPublicationEnabled } from "@/config/env"
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
import { WhatsNewFeatureVoteService } from "@/services/whats-new-feature-votes.service"
import { WatchSearchService } from "@/services/watch-search.service"
import { createTypesenseWatchSearchSuggestionsService } from "@/services/typesense-watch-search-suggestions"
import { TypesenseClient } from "@/services/typesense-client"
import { TypesenseWatchSearchCandidateGenerationService } from "@/services/typesense-watch-search-candidate-generation"
import {
  candidateWatchSearchIndexContractRevision,
  candidateWatchSearchRankingRevision,
} from "@/services/typesense-watch-search-candidate-identity"
import { resolveCurrentWatchSearchTranscriptProjectionWithFallback } from "@/services/typesense-watch-search-current-transcript-projection"
import {
  createTypesenseWatchSearchService,
  searchResolvedTypesenseWatchSearch,
  TYPESENSE_WATCH_SEARCH_REQUEST_TIMEOUT_MS,
  TypesenseWatchSearchService,
} from "@/services/typesense-watch-search.service"
import { WatchSettingService } from "@/services/watch-setting.service"
import { WatchRouteAlertService } from "@/services/watch-route-alert.service"

export type Services = ReturnType<typeof createServices>

import { resolveWatchSearchServingProfile } from "./typesense-watch-search-serving-profile"
export { resolveWatchSearchServingProfile } from "./typesense-watch-search-serving-profile"

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

  const host = env.TYPESENSE_HOST
  const apiKey = env.TYPESENSE_SEARCH_API_KEY
  if (!host || !apiKey) return null
  const resolveService = () =>
    resolveCachedCandidateServingService({
      prisma,
      create: async () => {
        const typesense = new TypesenseClient({
          host,
          apiKey,
          timeoutMs: TYPESENSE_WATCH_SEARCH_REQUEST_TIMEOUT_MS,
        })
        const generations = new TypesenseWatchSearchCandidateGenerationService(
          prisma,
          typesense,
        )
        const base = await resolveWatchSearchServingProfile({
          selector: env.WATCH_SEARCH_TYPESENSE_PROFILE,
          indexContractRevision: candidateWatchSearchIndexContractRevision(),
          rankingRevision: candidateWatchSearchRankingRevision(),
          transcriptProjection:
            await resolveCurrentWatchSearchTranscriptProjectionWithFallback({
              prisma,
              typesense,
            }),
          qrelsRevision: env.WATCH_SEARCH_SERVING_QRELS_REVISION ?? null,
          typesense,
          generations,
        })
        const profile = resolveWatchCatalogPublicationEnabled()
          ? await resolvePublishedWatchCatalog({
              prisma,
              base,
              generations,
              rankingRevision: candidateWatchSearchRankingRevision(),
            })
          : base
        return new TypesenseWatchSearchService(prisma, typesense, { profile })
      },
    })
  return {
    getLexicalCollection: async () =>
      (await resolveService()).getLexicalCollection(),
    search: (...args: Parameters<TypesenseWatchSearchService["search"]>) =>
      searchResolvedTypesenseWatchSearch(resolveService, ...args),
  }
}

export function createServices(prisma: PrismaClient) {
  const typesenseWatchSearch = createServingTypesenseWatchSearchService(prisma)
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
    whatsNewFeatureVote: new WhatsNewFeatureVoteService(prisma),
    watchSearch: new WatchSearchService(prisma),
    typesenseWatchSearch,
    typesenseWatchSearchSuggestions:
      createTypesenseWatchSearchSuggestionsService(
        prisma,
        typesenseWatchSearch
          ? () => typesenseWatchSearch.getLexicalCollection()
          : undefined,
      ),
    watchSetting: new WatchSettingService(prisma),
    watchRouteAlert: new WatchRouteAlertService(prisma),
  }
}
