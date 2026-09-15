import { vi } from "vitest"
import { RecommendationDeliveryService } from "./delivery.service"
import type { RecommendationAdmissionResult } from "./admission"
import {
  runCandidatePlatform,
  runSemanticCandidatePlatform,
} from "./orchestration"
import type { ExperimentAssignmentResolution } from "./experiment/assignment"
import type { LiveProfileCandidateResult } from "./candidates/profile-candidate.service"
import type { SemanticCandidatePoolItem } from "./candidate"
import type { RecommendationRecentContext } from "./recent-context.service"

export const candidate: SemanticCandidatePoolItem = {
  videoId: "target-video",
  videoCoreId: "target-core",
  embeddingText: "[0.1,0.2]",
  videoSlug: "target",
  videoTitle: "Target video",
  imageUrl: "https://images.example/target.jpg",
  sceneIndex: 2,
  description: "A related scene",
  startSeconds: 12,
  endSeconds: 42,
  similarity: 0.91,
  themes: ["hope"],
  demographics: [],
  spiritualContext: ["discipleship"],
  playbackId: "mux-target",
}

export function semanticCandidates(count: number): SemanticCandidatePoolItem[] {
  return Array.from({ length: count }, (_, index) => ({
    ...candidate,
    videoId: `semantic-video-${index + 1}`,
    videoCoreId: `semantic-core-${String(index + 1).padStart(3, "0")}`,
    videoSlug: `semantic-video-${index + 1}`,
    videoTitle: `Semantic video ${index + 1}`,
    embeddingText: null,
    playbackId: `mux-semantic-${index + 1}`,
    similarity: 0.9 - index * 0.01,
  }))
}

export const profileCandidateResult: LiveProfileCandidateResult = {
  projection: {
    id: "projection-2",
    scope: "session",
    generation: 2,
    projectionVersion: "multi-interest-profile-projection-v1",
    inputDigest: "e".repeat(64),
    publishedAt: new Date("2026-08-19T02:59:00.000Z"),
    expiresAt: new Date("2026-08-20T02:59:00.000Z"),
    cohortQuality: 0.8,
    sessionIntentPresent: true,
    interestCount: 1,
  },
  nominations: [
    {
      nominationKey: "profile:0:1:personalized-video",
      targetMediaId: "personalized-video",
      canonicalIdentity: {
        videoId: "personalized-video",
        videoCoreId: "personalized-core",
        videoTitle: "Personalized video",
        embeddingText: null,
      },
      presentation: {
        videoSlug: "personalized-video",
        videoTitle: "Personalized video",
        imageUrl: "https://images.example/personalized.jpg",
        sceneIndex: 0,
        description: "A session-shaped recommendation",
        startSeconds: 0,
        endSeconds: 30,
        themes: ["hope"],
        demographics: [],
        spiritualContext: [],
        playbackId: "mux-personalized",
        locale: "en",
        audioLanguageSlug: "english",
        watchPlayable: true,
        localePublished: true,
      },
      action: { kind: "scene_start", startSeconds: 0 },
      source: {
        generator: "multi-interest-profile",
        generatorVersion: "multi-interest-profile-candidate-v1",
        rank: 1,
        score: 0.92,
        evidence: {
          interestOrdinal: 0,
          interestKind: "session",
          projectionVersion: "multi-interest-profile-projection-v1",
        },
        rejectionReason: null,
      },
    },
  ],
}

export function makeHarness() {
  const requests = new Map<string, Record<string, unknown>>()
  const transactions: string[] = []
  const tx = {
    $queryRaw: vi.fn(async () => []),
    recommendationRequest: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const state = String(data.state ?? "PREPARED")
        transactions.push(state.toLowerCase())
        requests.set(String(data.id), { ...data, state })
        return data
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string }; data: object }) => {
          transactions.push("issued")
          requests.set(where.id, { ...requests.get(where.id), ...data })
          return { count: 1 }
        },
      ),
    },
    recommendationCandidateRun: {
      create: vi.fn(async (_input: { data: Record<string, unknown> }) => ({})),
    },
    recommendationCandidateStageEvidence: {
      createMany: vi.fn(
        async (_input: { data: Array<Record<string, unknown>> }) => ({
          count: 0,
        }),
      ),
    },
    recommendationPersonalizationDecision: {
      create: vi.fn(
        async ({ data }: { data: Record<string, unknown> }) => data,
      ),
    },
    recommendationEvidenceAudit: { create: vi.fn(async () => ({})) },
  }
  const prisma = {
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
      work(tx),
    ),
  }
  const acquire = vi.fn(
    async (): Promise<RecommendationAdmissionResult> => ({
      allowed: true,
      leaseId: "lease",
    }),
  )
  const release = vi.fn(async () => undefined)
  const getServingState = vi.fn(async () => ({
    canIssue: true as const,
    reason: "ready" as const,
    revokedKids: [],
    lastKnownGoodManifestId: "semantic-transcript-pgvector-v1",
    manifest: {
      id: "semantic-transcript-pgvector-v1",
      strategyVersion: "semantic-transcript-pgvector-v1",
      contractVersion: "semantic-recommendation-v1",
      surfaceVersion: "watch-below-player-v1",
      generator: "semantic",
      maxItems: 6,
    },
  }))
  const retrieve = vi.fn(
    async (): Promise<SemanticCandidatePoolItem[]> => [candidate],
  )
  const recheckCached = vi.fn(
    async (items: SemanticCandidatePoolItem[]) => items,
  )
  const signDeliveryCapability = vi.fn(async ({ jti }) => `token:${jti}`)
  const orchestrate = vi.fn(runSemanticCandidatePlatform)
  const orchestrateHybrid = vi.fn(runCandidatePlatform)
  const assignExperiment = vi.fn(
    async (): Promise<ExperimentAssignmentResolution> => ({
      assignment: null,
      bypassReason: "no_active_experiment",
    }),
  )
  const retrieveProfile = vi.fn(
    async (): Promise<LiveProfileCandidateResult | null> => null,
  )
  const resolveRecentContext = vi.fn(
    async (): Promise<RecommendationRecentContext> => ({ videos: [] }),
  )
  const authorizeProfile = vi.fn(async () => true)
  let clock = Date.now()
  let id = 0
  const service = new RecommendationDeliveryService({
    prisma: prisma as never,
    admission: {
      acquire,
      release,
    },
    getServingState,
    retrieve,
    recheckCached,
    orchestrate,
    orchestrateHybrid,
    assignExperiment,
    retrieveProfile,
    resolveRecentContext,
    authorizeProfile,
    tokenService: {
      activeKid: "active-kid",
      signDeliveryCapability,
    },
    now: () => new Date("2026-08-19T03:00:00.000Z"),
    nowMilliseconds: () => clock,
    newId: () => `fresh-${++id}`,
  })
  return {
    service,
    requests,
    transactions,
    tx,
    prisma,
    acquire,
    release,
    getServingState,
    retrieve,
    recheckCached,
    signDeliveryCapability,
    orchestrate,
    orchestrateHybrid,
    assignExperiment,
    retrieveProfile,
    resolveRecentContext,
    authorizeProfile,
    advanceClock(milliseconds: number) {
      clock += milliseconds
    },
  }
}

export function input(seedMediaId = "seed-video", session = "a") {
  return {
    caller: {
      id: null,
      role: "CONSUMER_BEARER" as const,
      fleet: false,
      rateLimitBucketKey: "test-web-consumer-key",
    },
    seedMediaId,
    locale: "en",
    audioLanguageSlug: "english",
    sessionDigest: session.repeat(64),
  }
}

export function personalizedInput(seedMediaId = "seed-video", session = "a") {
  return {
    ...input(seedMediaId, session),
    consentReceiptDigest: "c".repeat(64),
    profileTokenDigest: "d".repeat(64),
  }
}
