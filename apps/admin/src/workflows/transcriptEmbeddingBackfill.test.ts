import { readFile } from "node:fs/promises"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {
    TRANSCRIPT_EMBEDDING_CONCURRENCY: 2,
  },
}))

vi.mock("@/db/client", () => {
  const mock = {
    $queryRaw: vi.fn(async () => []),
    videoSubtitle: {
      findMany: vi.fn(async () => []),
    },
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
const { env } = await import("@/config/env")
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
  overrides: Partial<{
    languageId: string
    languageSlug: string | null
    hasSubtitle: boolean
    hasDub: boolean
    isPrimaryLanguage: boolean
  }> = {},
) {
  return {
    video_id: videoId,
    video_edition_id: editionId,
    core_id: coreId,
    language_id: overrides.languageId ?? `lang-${bcp47}`,
    bcp47,
    slug: overrides.languageSlug ?? bcp47,
    has_subtitle: overrides.hasSubtitle ?? false,
    has_dub: overrides.hasDub ?? false,
    is_primary_language: overrides.isPrimaryLanguage ?? true,
  }
}

function target(
  videoId: string,
  editionId: string,
  coreId: string,
  cmsVideoId: number,
  language: string,
) {
  return {
    videoId,
    videoEditionId: editionId,
    coreId,
    cmsVideoId,
    language,
    languageId: `lang-${language}`,
    languageSlug: language,
    hasSubtitle: false,
    hasDub: false,
    isPrimaryLanguage: true,
  }
}

describe("runTranscriptEmbeddingBackfill", () => {
  beforeEach(() => {
    ;(
      env as unknown as { TRANSCRIPT_EMBEDDING_CONCURRENCY: unknown }
    ).TRANSCRIPT_EMBEDDING_CONCURRENCY = 2
    ;(prisma as unknown as PrismaStub).$queryRaw.mockReset()
    ;(
      prisma as unknown as {
        videoSubtitle: { findMany: ReturnType<typeof vi.fn> }
      }
    ).videoSubtitle.findMany.mockReset()
    ;(
      prisma as unknown as {
        videoSubtitle: { findMany: ReturnType<typeof vi.fn> }
      }
    ).videoSubtitle.findMany.mockResolvedValue([])
    vi.unstubAllGlobals()
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
      transcript: {
        text: STUB_TRANSCRIPT.text,
        segments: STUB_TRANSCRIPT.segments,
        artifactKey: "1/transcript.json",
        kind: "manager-transcript",
        languageId: "lang-en",
        languageSlug: "en",
        provider: STUB_TRANSCRIPT.resolvedProvider,
      },
      mode: "idempotent",
    })
  })

  it("uses exact Admin subtitle timed text before Manager transcript fallback", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en", {
        languageId: "lang-en",
        languageSlug: "english",
        hasSubtitle: true,
        hasDub: true,
      }),
    ])
    ;(
      prisma as unknown as {
        videoSubtitle: { findMany: ReturnType<typeof vi.fn> }
      }
    ).videoSubtitle.findMany.mockResolvedValueOnce([
      {
        id: "sub-1",
        languageId: "lang-en",
        primary: true,
        vttSrc: "https://api-media-core.jesusfilm.org/subtitles/en.vtt",
        srtSrc: null,
        syncedAt: new Date("2026-06-01T00:00:00.000Z"),
        updatedAt: new Date("2026-06-02T00:00:00.000Z"),
        language: { bcp47: "en", slug: "english" },
      },
    ])
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(`WEBVTT

00:00:00.000 --> 00:00:02.000
Subtitle transcript text.
`)
      }),
    )

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.succeeded).toBe(1)
    expect(report.outcomes[0]).toMatchObject({
      status: "succeeded",
      sourceKind: "subtitle",
    })
    expect(readTranscriptSourceArtifact).not.toHaveBeenCalled()
    expect(launchMastraTranscriptEmbedding).toHaveBeenCalledWith({
      target: {
        videoId: "v-a",
        videoEditionId: "e-a",
        coreId: "core-a",
      },
      language: "en",
      cmsVideoId: 1,
      transcript: {
        text: "Subtitle transcript text.",
        segments: [{ start: 0, end: 2, text: "Subtitle transcript text." }],
        artifactKey: "admin-video-subtitle/sub-1.vtt",
        kind: "subtitle",
        languageId: "lang-en",
        languageSlug: "english",
        subtitleId: "sub-1",
        format: "vtt",
        url: "https://api-media-core.jesusfilm.org/subtitles/en.vtt",
        provider: "admin-subtitle",
        generatedAt: "2026-06-01T00:00:00.000Z",
      },
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

  it("reports dub-only targets without timed text as source gaps when Manager fallback is absent", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "es", {
        languageId: "lang-es",
        languageSlug: "spanish",
        hasDub: true,
        hasSubtitle: false,
        isPrimaryLanguage: false,
      }),
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

    expect(report.skipped).toBe(1)
    expect(report.sourceGaps).toEqual([
      {
        assetId: 1,
        coreId: "core-a",
        videoId: "v-a",
        videoEditionId: "e-a",
        language: "es",
        languageId: "lang-es",
        languageSlug: "spanish",
        reason: "dub_without_timed_text",
        subtitleReason: "subtitle_missing",
        sourceKind: "transcript",
      },
    ])
    expect(launchMastraTranscriptEmbedding).not.toHaveBeenCalled()
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

  it("uses one external group step so production workflow steps are not nested", async () => {
    const source = await readFile(
      new URL("./transcriptEmbeddingBackfill.ts", import.meta.url),
      "utf8",
    )

    expect(source).toContain("stepProcessTranscriptEmbeddingGroup")
    expect(source).not.toMatch(/\basync function processGroup\b/)
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

  it("accepts raw string concurrency from the workflow runtime env", async () => {
    ;(
      env as unknown as { TRANSCRIPT_EMBEDDING_CONCURRENCY: unknown }
    ).TRANSCRIPT_EMBEDDING_CONCURRENCY = "1"
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

    expect(observedMaxInFlight).toBe(1)
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
      target("v-a", "e-a", "core-a", 1, "en"),
      target("v-a", "e-a", "core-a", 1, "es"),
      target("v-b", "e-b", "core-b", 2, "en"),
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0]?.targets.map((target) => target.language)).toEqual([
      "en",
      "es",
    ])
    expect(groups[1]?.targets.map((target) => target.language)).toEqual(["en"])
  })
})
