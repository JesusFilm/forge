import type { Prisma, PrismaClient } from "@prisma/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { adaptSemanticCandidates, type CandidateNomination } from "./candidate"
import { candidateTracePayload } from "./candidate-trace"
import { createDatabaseCowatchLiveSource } from "./cowatch/live.service"
import { COWATCH_FROZEN_TRIAL_MODE } from "./cowatch/trial-authority.service"
import { COWATCH_SOURCE_WINDOW_VERSION } from "./cowatch/source-window"
import {
  composeDeliveryCowatchTrial,
  type TrialCompositionInput,
} from "./delivery-trial.service"
import {
  readActiveStudyAuthority,
  type ActiveStudyAuthority,
} from "./experiment/active-study-authority"
import { COWATCH_MMR_TRIAL_MANIFEST_ID } from "./promotion/manifest"
import { loadViewingModeAffinity } from "./viewing-mode.service"

vi.mock("./cowatch/live.service", () => ({
  createDatabaseCowatchLiveSource: vi.fn(),
}))
vi.mock("./viewing-mode.service", () => ({ loadViewingModeAffinity: vi.fn() }))
vi.mock("./experiment/active-study-authority", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./experiment/active-study-authority")
  >()),
  readActiveStudyAuthority: vi.fn(),
}))

const now = new Date("2026-09-29T00:00:00.000Z")
const until = new Date("2026-09-30T00:00:00.000Z")
const context = {
  surface: "watch-below-player-v1",
  purpose: "watch",
  locale: "en",
  audioLanguageSlug: "english",
} as const
const graphId = "a".repeat(64)
const authority: ActiveStudyAuthority = {
  execution: "cowatch_mmr",
  experimentId: "study",
  experimentGeneration: 1,
  protocolDigest: "b".repeat(64),
  challengerManifestId: COWATCH_MMR_TRIAL_MANIFEST_ID,
  validUntil: until,
  cowatch: {
    mode: COWATCH_FROZEN_TRIAL_MODE,
    studyId: "study",
    experimentGeneration: 1,
    protocolDigest: "b".repeat(64),
    manifestId: COWATCH_MMR_TRIAL_MANIFEST_ID,
    manifestDigest: "c".repeat(64),
    graphGenerationId: graphId,
    sourceWindow: {
      version: COWATCH_SOURCE_WINDOW_VERSION,
      windowStart: new Date("2026-09-20"),
      windowEnd: new Date("2026-09-27"),
      evaluationAsOf: new Date("2026-09-28"),
    },
    calibrationCompletedAt: now,
    enrollmentEnd: until,
    trialValidUntil: until,
    shadowEvaluationId: "shadow-evaluation",
    shadowDecisionId: "shadow-decision",
  },
  composition: {
    protocolId: "00000000-0000-4000-8000-000000000001",
    manifestId: COWATCH_MMR_TRIAL_MANIFEST_ID,
    composerVersion: "source-interest-theme-mmr-v1",
    configDigest: "d".repeat(64),
    evidenceDigest: "e".repeat(64),
    reviewDigest: "f".repeat(64),
    authorityRevision: 1,
    cowatchGenerationId: graphId,
  },
}

function nominations(
  generator: string,
  count: number,
  offset: number,
): CandidateNomination[] {
  return adaptSemanticCandidates(
    Array.from({ length: count }, (_, index) => {
      const id = String(offset + index).padStart(8, "0")
      return {
        videoId: id,
        videoCoreId: id,
        videoSlug: id,
        videoTitle: `Video ${id}`,
        imageUrl: `https://images.example/${id}.jpg`,
        sceneIndex: 0,
        description: "",
        startSeconds: 0,
        endSeconds: 30,
        themes: [`theme-${index % 4}`],
        demographics: [],
        spiritualContext: [],
        playbackId: `playback-${id}`,
        similarity: 0.9,
      }
    }),
    context,
  ).nominations.map((nomination, index) => ({
    ...nomination,
    source: {
      ...nomination.source,
      generator,
      generatorVersion:
        generator === "directional-cowatch"
          ? COWATCH_FROZEN_TRIAL_MODE
          : nomination.source.generatorVersion,
      evidence:
        generator === "directional-cowatch"
          ? {
              generation: graphId,
              bindingDigest: "1".repeat(64),
              anchorMediaId: "seed",
              support: 25,
            }
          : generator === "multi-interest-profile"
            ? { interestOrdinal: index % 4, interestKind: "durable" }
            : nomination.source.evidence,
    },
  }))
}

function setup() {
  // Real fusion, MMR authorization, trace projection and deadline wrappers;
  // only their database and source/registry boundaries are test doubles.
  const queryRaw = vi.fn(async () => [{ validUntil: until }])
  const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient
  const prisma = {
    $transaction: vi.fn(
      async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        operation(tx),
    ),
  } as unknown as PrismaClient
  const graph = nominations("directional-cowatch", 12, 200)
  const input: TrialCompositionInput = {
    assignment: {
      assignmentId: "assignment",
      experimentId: "study",
      experimentVersion: "study-v2",
      experimentGeneration: 1,
      arm: "challenger",
      effectiveManifestId: COWATCH_MMR_TRIAL_MANIFEST_ID,
      assignmentProbability: 0.5,
      configurationDigest: authority.protocolDigest,
    },
    authority,
    context,
    seedMediaId: "seed",
    profileProjectionId: "projection",
    profileTokenDigest: "2".repeat(64),
    semanticNominations: nominations("semantic", 36, 0),
    profileNominations: nominations("multi-interest-profile", 40, 100),
    recentContext: { videos: [] },
    limit: 6,
    deadlineAt: now.getTime() + 5_000,
    now,
  }
  let sourceDependencies: Parameters<typeof createDatabaseCowatchLiveSource>[1]
  const source = vi.fn<ReturnType<typeof createDatabaseCowatchLiveSource>>(
    async (sourceContext) => {
      const active =
        await sourceDependencies.resolveActiveAuthority(sourceContext)
      return active
        ? {
            disposition: "candidate",
            nominations: graph,
            fallbackReason: null,
            provenance: null,
          }
        : {
            disposition: "fallback",
            nominations: [],
            fallbackReason: "cowatch_active_authority_unavailable",
            provenance: null,
          }
    },
  )
  vi.mocked(createDatabaseCowatchLiveSource).mockImplementation(
    (_client, dependencies) => {
      sourceDependencies = dependencies
      return source
    },
  )
  vi.mocked(readActiveStudyAuthority).mockResolvedValue(authority)
  vi.mocked(loadViewingModeAffinity).mockResolvedValue(null)
  return { prisma, input, graph, source, queryRaw }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

describe("live trial composition service", () => {
  it("keeps one exact authority record in either trace format without rewriting candidate source lineage", async () => {
    const h = setup()
    const originalInputs = JSON.stringify([
      h.input.semanticNominations,
      h.input.profileNominations,
      h.graph,
    ])
    const result = await composeDeliveryCowatchTrial(h.prisma, h.input)
    expect(result.status).toBe("composed")
    if (result.status !== "composed") throw new Error("Expected composed trial")
    const { platform } = result
    expect(platform.counts.nominated).toBe(64)
    expect(platform.ordered).toHaveLength(64)
    expect(platform.composed).toHaveLength(6)
    expect(platform.evidence).toHaveLength(384)
    const authorityEntries = platform.evidence.flatMap((entry) =>
      entry.sourceEvidence
        .filter((source) => "compositionProtocolId" in source.evidence)
        .map((source) => ({ entry, source })),
    )
    expect(authorityEntries).toHaveLength(1)
    expect(authorityEntries[0]?.entry).toMatchObject({
      stage: "composed",
      ordinal: 0,
      finalPosition: 0,
    })
    expect(authorityEntries[0]?.source).toBe(
      authorityEntries[0]?.entry.sourceEvidence[0],
    )
    expect(authorityEntries[0]?.source.evidence).toMatchObject({
      compositionProtocolId: authority.composition!.protocolId,
      compositionEvidenceDigest: authority.composition!.evidenceDigest,
      compositionReviewDigest: authority.composition!.reviewDigest,
      compositionAuthorityRevision: authority.composition!.authorityRevision,
      graphGenerationId: graphId,
      experimentId: "study",
      experimentGeneration: 1,
      studyProtocolDigest: authority.protocolDigest,
    })
    expect(
      platform.composed
        .flatMap((candidate) => candidate.sources)
        .every((source) => !("compositionProtocolId" in source.evidence)),
    ).toBe(true)
    const graphNominations = platform.evidence.filter(
      (entry) =>
        entry.stage === "nominated" &&
        entry.sourceGenerator === "directional-cowatch",
    )
    expect(graphNominations).toHaveLength(12)
    expect(
      graphNominations.every(
        (entry) =>
          entry.sourceEvidence[0]?.evidence.generation === graphId &&
          entry.sourceEvidence[0]?.evidence.bindingDigest === "1".repeat(64),
      ),
    ).toBe(true)
    expect(
      JSON.stringify([
        h.input.semanticNominations,
        h.input.profileNominations,
        h.graph,
      ]),
    ).toBe(originalInputs)
    const compact = candidateTracePayload(
      platform.evidence.map((entry, index) => ({
        ...entry,
        id: `stage-${index}`,
        runId: "run",
        createdAt: now,
        expiresAt: until,
      })),
    )
    expect(
      JSON.stringify(compact).match(/"compositionProtocolId"/g),
    ).toHaveLength(1)
    expect(compact.stages).toHaveLength(platform.evidence.length)
  })

  it.each([
    "experimentGeneration",
    "compositionReview",
    "graphGeneration",
  ] as const)(
    "discards the union when %s changes between source admission and composition",
    async (change) => {
      const h = setup()
      const changed =
        change === "experimentGeneration"
          ? { ...authority, experimentGeneration: 2 }
          : change === "compositionReview"
            ? {
                ...authority,
                composition: {
                  ...authority.composition!,
                  reviewDigest: "3".repeat(64),
                },
              }
            : {
                ...authority,
                cowatch: {
                  ...authority.cowatch!,
                  graphGenerationId: "4".repeat(64),
                },
              }
      vi.mocked(readActiveStudyAuthority)
        .mockResolvedValueOnce(authority)
        .mockResolvedValue(changed)
      expect(await composeDeliveryCowatchTrial(h.prisma, h.input)).toEqual({
        status: "fallback",
        reason: "composition_study_authority_unavailable",
      })
      expect(h.source).toHaveBeenCalledOnce()
      expect(loadViewingModeAffinity).toHaveBeenCalledOnce()
    },
  )

  it("refuses graph nominations from a different generation even when study authority matches", async () => {
    const h = setup()
    h.graph[0] = {
      ...h.graph[0]!,
      source: {
        ...h.graph[0]!.source,
        evidence: {
          ...h.graph[0]!.source.evidence,
          generation: "9".repeat(64),
        },
      },
    }
    expect(await composeDeliveryCowatchTrial(h.prisma, h.input)).toEqual({
      status: "fallback",
      reason: "composition_candidate_graph_mismatch",
    })
  })

  it("returns only fallback after the source consumes the request deadline", async () => {
    const h = setup()
    h.source.mockImplementation(async () => {
      vi.setSystemTime(h.input.deadlineAt + 1)
      return {
        disposition: "candidate",
        nominations: h.graph,
        fallbackReason: null,
        provenance: null,
      }
    })
    expect(await composeDeliveryCowatchTrial(h.prisma, h.input)).toEqual({
      status: "fallback",
      reason: "trial_deadline",
    })
    expect(loadViewingModeAffinity).not.toHaveBeenCalled()
  })

  it("does not expose source candidates when its authority has already changed", async () => {
    const h = setup()
    vi.mocked(readActiveStudyAuthority).mockResolvedValue(null)
    expect(await composeDeliveryCowatchTrial(h.prisma, h.input)).toEqual({
      status: "fallback",
      reason: "cowatch_active_authority_unavailable",
    })
    expect(loadViewingModeAffinity).not.toHaveBeenCalled()
  })
})
