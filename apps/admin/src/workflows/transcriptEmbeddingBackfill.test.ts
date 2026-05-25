import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {
    TRANSCRIPT_EMBEDDING_CONCURRENCY: 2,
  },
}))

vi.mock("@/db/client", () => {
  const mock = {
    $queryRaw: vi.fn(async () => []),
  }
  return { prisma: mock, syncPrisma: mock }
})

vi.mock("@/services/core-id-mapping.service", () => ({
  loadCoreIdMapping: vi.fn(async () => ({
    generatedAt: "2026-04-22T00:00:00.000Z",
    byCoreId: new Map<string, number>([
      ["core-a", 1],
      ["core-b", 2],
      ["core-c", 3],
    ]),
  })),
}))

const STUB_TRANSCRIPT = {
  text: "stub transcript source",
  segments: [{ start: 0, end: 2, text: "stub transcript source" }],
  language: "en",
  resolvedProvider: "mux" as const,
  routingReport: { attempts: [] },
}

vi.mock("@/services/manager-artifacts.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/manager-artifacts.service")
    >()
  return {
    ...actual,
    readTranscriptSourceArtifact: vi.fn(async () => STUB_TRANSCRIPT),
  }
})

vi.mock("@/services/mastra-transcript-embedding-client", () => ({
  launchMastraTranscriptEmbedding: vi.fn(async () => ({
    ok: true,
    status: "created",
    chunks: 1,
    totalTokens: 4,
    model: "openai/text-embedding-3-small",
    provider: "openai",
    dimensions: 1536,
    mastraRunId: "run-1",
    sourceContentHash: "sha256:test",
  })),
}))

const { prisma } = await import("@/db/client")
const { ManagerArtifactError, readTranscriptSourceArtifact } =
  await import("@/services/manager-artifacts.service")
const { launchMastraTranscriptEmbedding } =
  await import("@/services/mastra-transcript-embedding-client")
const { runTranscriptEmbeddingBackfill, _internals } =
  await import("./transcriptEmbeddingBackfill")

type PrismaStub = { $queryRaw: ReturnType<typeof vi.fn> }

function row(
  videoId: string,
  editionId: string,
  coreId: string,
  bcp47: string,
) {
  return {
    video_id: videoId,
    video_edition_id: editionId,
    core_id: coreId,
    bcp47,
  }
}

describe("runTranscriptEmbeddingBackfill", () => {
  beforeEach(() => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockReset()
    vi.mocked(readTranscriptSourceArtifact).mockReset()
    vi.mocked(readTranscriptSourceArtifact).mockResolvedValue(STUB_TRANSCRIPT)
    vi.mocked(launchMastraTranscriptEmbedding).mockReset()
    vi.mocked(launchMastraTranscriptEmbedding).mockResolvedValue({
      ok: true,
      status: "created",
      chunks: 1,
      totalTokens: 4,
      model: "openai/text-embedding-3-small",
      provider: "openai",
      dimensions: 1536,
      mastraRunId: "run-1",
      sourceContentHash: "sha256:test",
    })
  })

  it("enumerates targets and launches Mastra with Admin identifiers", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "es"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(2)
    expect(report.succeeded).toBe(2)
    expect(report.failed).toBe(0)
    expect(readTranscriptSourceArtifact).toHaveBeenCalledTimes(2)
    expect(launchMastraTranscriptEmbedding).toHaveBeenCalledWith({
      target: {
        videoId: "v-a",
        videoEditionId: "e-a",
        coreId: "core-a",
      },
      language: "en",
      cmsVideoId: 1,
      transcript: STUB_TRANSCRIPT,
      mode: "idempotent",
    })
  })

  it("loads transcript source once per (video, edition) group across languages", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-a", "e-a", "core-a", "fr"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(3)
    expect(report.succeeded).toBe(3)
    expect(readTranscriptSourceArtifact).toHaveBeenCalledTimes(1)
    expect(readTranscriptSourceArtifact).toHaveBeenCalledWith("1")
    expect(launchMastraTranscriptEmbedding).toHaveBeenCalledTimes(3)
  })

  it("applies coreId, language, and mode filters", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "es"),
      row("v-c", "e-c", "core-c", "en"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: ["core-a", "core-c"],
      languages: ["en"],
      mode: "force",
    })

    expect(report.totalTargets).toBe(2)
    expect(report.languageFilter).toEqual(["en"])
    expect(launchMastraTranscriptEmbedding).toHaveBeenCalledTimes(2)
    for (const call of vi.mocked(launchMastraTranscriptEmbedding).mock.calls) {
      expect(call[0].mode).toBe("force")
      expect(call[0].language).toBe("en")
    }
  })

  it("skips every language in a group when transcript source is missing and emits missingArtifacts once", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
    ])
    vi.mocked(readTranscriptSourceArtifact).mockRejectedValueOnce(
      new ManagerArtifactError(
        "artifact_missing",
        "transcript artifact not found for assetId=1",
      ),
    )

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.succeeded).toBe(0)
    expect(report.skipped).toBe(2)
    expect(report.failed).toBe(0)
    expect(launchMastraTranscriptEmbedding).not.toHaveBeenCalled()
    expect(report.missingArtifacts).toEqual([
      { assetId: 1, coreId: "core-a", kind: "transcript" },
    ])
  })

  it("classifies invalid transcript source and Mastra product failures as failed outcomes", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
    ])
    vi.mocked(readTranscriptSourceArtifact).mockImplementation(
      async (assetId: string) => {
        if (assetId === "1") {
          throw new ManagerArtifactError(
            "artifact_invalid",
            "transcript artifact failed schema validation",
          )
        }
        return STUB_TRANSCRIPT
      },
    )
    vi.mocked(launchMastraTranscriptEmbedding).mockResolvedValueOnce({
      ok: false,
      reason: "admin_ingest_rejected",
      retryable: false,
      mastraRunId: "run-2",
      adminStatus: "rejected",
      adminReason: "existing_transcript_differs",
    })

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.failed).toBe(2)
    expect(report.skipped).toBe(0)
    expect(report.missingArtifacts).toEqual([])
  })

  it("keeps processing sibling targets when one Mastra launch fails", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
    ])
    vi.mocked(launchMastraTranscriptEmbedding)
      .mockResolvedValueOnce({
        ok: false,
        reason: "network_error",
        retryable: true,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: "unchanged",
        chunks: 1,
        totalTokens: 4,
        model: "openai/text-embedding-3-small",
        provider: "openai",
        dimensions: 1536,
        mastraRunId: "run-3",
        sourceContentHash: "sha256:test",
      })

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.succeeded).toBe(1)
    expect(report.failed).toBe(1)
    const success = report.outcomes.find(
      (outcome) => outcome.status === "succeeded",
    )
    expect(success).toMatchObject({
      status: "succeeded",
      chunksIndexed: 1,
      embeddingsWritten: 0,
    })
  })

  it("caps concurrent in-flight groups at TRANSCRIPT_EMBEDDING_CONCURRENCY", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
      row("v-c", "e-c", "core-c", "en"),
    ])

    let inFlight = 0
    let observedMaxInFlight = 0
    vi.mocked(launchMastraTranscriptEmbedding).mockImplementation(async () => {
      inFlight += 1
      observedMaxInFlight = Math.max(observedMaxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 20))
      inFlight -= 1
      return {
        ok: true,
        status: "created",
        chunks: 1,
        totalTokens: 4,
        model: "openai/text-embedding-3-small",
        provider: "openai",
        dimensions: 1536,
        mastraRunId: "run-1",
        sourceContentHash: "sha256:test",
      }
    })

    await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(observedMaxInFlight).toBe(2)
  })

  it("returns an empty report when the DB has no editions", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(0)
    expect(report.outcomes).toEqual([])
    expect(readTranscriptSourceArtifact).not.toHaveBeenCalled()
    expect(launchMastraTranscriptEmbedding).not.toHaveBeenCalled()
  })
})

describe("groupTargetsByVideoEdition", () => {
  it("groups targets by (video, edition) preserving language order", () => {
    const groups = _internals.groupTargetsByVideoEdition([
      {
        videoId: "v-a",
        videoEditionId: "e-a",
        coreId: "core-a",
        cmsVideoId: 1,
        language: "en",
      },
      {
        videoId: "v-a",
        videoEditionId: "e-a",
        coreId: "core-a",
        cmsVideoId: 1,
        language: "es",
      },
      {
        videoId: "v-b",
        videoEditionId: "e-b",
        coreId: "core-b",
        cmsVideoId: 2,
        language: "en",
      },
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0]?.targets.map((target) => target.language)).toEqual([
      "en",
      "es",
    ])
    expect(groups[1]?.targets.map((target) => target.language)).toEqual(["en"])
  })
})
