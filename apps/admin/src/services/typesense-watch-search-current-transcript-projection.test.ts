import { beforeEach, describe, expect, it, vi } from "vitest"

const resolveWatchSearchRuntimeEnv = vi.hoisted(() => vi.fn())
const freezeCurrentWatchSearchProfile = vi.hoisted(() => vi.fn())
const resolveCurrentWatchSearchTranscriptCompatibility = vi.hoisted(() =>
  vi.fn(),
)

vi.mock("@/config/env", () => ({
  resolveWatchSearchRuntimeEnv,
}))
vi.mock("./typesense-watch-search-profile", () => ({
  freezeCurrentWatchSearchProfile,
}))
vi.mock("./typesense-watch-search-transcript-compatibility", () => ({
  resolveCurrentWatchSearchTranscriptCompatibility,
}))

import {
  resolveCurrentWatchSearchTranscriptProjection,
  resolveCurrentWatchSearchTranscriptProjectionWithFallback,
  WatchSearchCurrentTranscriptProjectionError,
} from "./typesense-watch-search-current-transcript-projection"

describe("current Watch Search transcript projection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveWatchSearchRuntimeEnv.mockReturnValue({
      defaultShadowEnabled: true,
      fleetPrimaryEnabled: false,
      candidateComparisonEnabled: false,
      transcriptProjectionRevision: 17n,
    })
    freezeCurrentWatchSearchProfile.mockResolvedValue({
      binding: { transcript: "watch_search_transcripts_active" },
    })
    resolveCurrentWatchSearchTranscriptCompatibility.mockResolvedValue({
      contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
      transcriptChunkingVersion: "mastra-v1",
    })
  })

  it("returns the stored projection row when it exists", async () => {
    const prisma = {
      watchSearchCurrentTranscriptProjection: {
        findUnique: vi.fn(async () => ({
          transcriptCollection: "watch_search_transcripts_published",
          contentEmbeddingContractId: "semantic-transcript-pgvector-v2",
          transcriptChunkingVersion: "mastra-v2",
          projectionRevision: 23n,
        })),
      },
    }

    await expect(
      resolveCurrentWatchSearchTranscriptProjection(prisma as never),
    ).resolves.toEqual({
      transcriptCollection: "watch_search_transcripts_published",
      contentEmbeddingContractId: "semantic-transcript-pgvector-v2",
      transcriptChunkingVersion: "mastra-v2",
      projectionRevision: 23n,
    })
    expect(resolveCurrentWatchSearchTranscriptCompatibility).not.toHaveBeenCalled()
  })

  it("falls back to the current alias, exact compatibility, and runtime revision before the row exists", async () => {
    const findUnique = vi.fn(async () => null)
    const prisma = {
      watchSearchCurrentTranscriptProjection: { findUnique },
      $queryRaw: vi.fn(),
    }

    await expect(
      resolveCurrentWatchSearchTranscriptProjectionWithFallback({
        prisma: prisma as never,
        typesense: { getAlias: vi.fn() } as never,
      }),
    ).resolves.toEqual({
      transcriptCollection: "watch_search_transcripts_active",
      contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
      transcriptChunkingVersion: "mastra-v1",
      projectionRevision: 17n,
    })
    expect(findUnique).toHaveBeenCalledOnce()
    expect(freezeCurrentWatchSearchProfile).toHaveBeenCalledOnce()
    expect(resolveCurrentWatchSearchTranscriptCompatibility).toHaveBeenCalledWith(
      prisma,
    )
  })

  it("fails closed when neither a stored row nor a runtime revision exists", async () => {
    resolveWatchSearchRuntimeEnv.mockReturnValue({
      defaultShadowEnabled: true,
      fleetPrimaryEnabled: false,
      candidateComparisonEnabled: false,
      transcriptProjectionRevision: undefined,
    })
    const prisma = {
      watchSearchCurrentTranscriptProjection: {
        findUnique: vi.fn(async () => null),
      },
      $queryRaw: vi.fn(),
    }

    await expect(
      resolveCurrentWatchSearchTranscriptProjectionWithFallback({
        prisma: prisma as never,
        currentProfile: {
          binding: { transcript: "watch_search_transcripts_active" },
        },
      }),
    ).rejects.toBeInstanceOf(WatchSearchCurrentTranscriptProjectionError)
    expect(resolveCurrentWatchSearchTranscriptCompatibility).not.toHaveBeenCalled()
  })
})
