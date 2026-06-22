import { readFile } from "node:fs/promises"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {
    TRANSCRIPT_EMBEDDING_CONCURRENCY: 2,
  },
}))

vi.mock("workflow", () => ({
  getWorkflowMetadata: vi.fn(() => ({
    workflowName: "test-workflow",
    workflowRunId: "test-run",
    workflowStartedAt: new Date("2026-06-20T00:00:00.000Z"),
    url: "http://test.local/workflow",
  })),
  sleep: vi.fn(async () => undefined),
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
const { getWorkflowMetadata, sleep } = await import("workflow")
const { ManagerArtifactError, readTranscriptSourceArtifact } =
  await import("@/services/manager-artifacts.service")
const { launchMastraTranscriptEmbedding } =
  await import("@/services/mastra-transcript-embedding-client")
const {
  DEFAULT_TRANSCRIPT_EMBEDDING_CONFIRMATION_BATCH_LIMIT,
  runTranscriptEmbeddingBackfill,
  _internals,
} = await import("./transcriptEmbeddingBackfill")

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

function pendingConfirmation(
  language: string,
  overrides: Partial<{
    videoId: string
    editionId: string
    coreId: string
    cmsVideoId: number
    sourceKind: "manager-transcript" | "subtitle"
    mastraRunId: string
    startedAtEpochMs: number
  }> = {},
) {
  return {
    status: "pending-ingest-confirmation" as const,
    target: target(
      overrides.videoId ?? `v-${language}`,
      overrides.editionId ?? `e-${language}`,
      overrides.coreId ?? "core-a",
      overrides.cmsVideoId ?? 1,
      language,
    ),
    language,
    sourceKind: overrides.sourceKind ?? ("manager-transcript" as const),
    mastraRunId: overrides.mastraRunId ?? `run-${language}`,
    startedAtEpochMs: overrides.startedAtEpochMs ?? Date.now(),
  }
}

function transcriptHealthRow(
  overrides: Partial<{
    videoEditionId: string
    language: string
    totalChunks: number
    model: string
    dimensions: number
    embeddingProvider: string | null
    generationMode: string | null
    sourceKind: string | null
    chunksWithEmbedding: number
    chunksWithEmbeddingInputText: number
  }> = {},
) {
  return {
    video_edition_id: overrides.videoEditionId ?? "e-a",
    language: overrides.language ?? "en",
    total_chunks: overrides.totalChunks ?? 2,
    model: overrides.model ?? "embeddings",
    dimensions: overrides.dimensions ?? 1536,
    embedding_provider: Object.hasOwn(overrides, "embeddingProvider")
      ? (overrides.embeddingProvider ?? null)
      : "jesus-film-ai-gateway",
    generation_mode: Object.hasOwn(overrides, "generationMode")
      ? (overrides.generationMode ?? null)
      : "model-upgrade",
    source_kind: Object.hasOwn(overrides, "sourceKind")
      ? (overrides.sourceKind ?? null)
      : "subtitle",
    chunks_with_embedding: overrides.chunksWithEmbedding ?? 2,
    chunks_with_embedding_input_text:
      overrides.chunksWithEmbeddingInputText ?? 2,
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
    vi.mocked(getWorkflowMetadata).mockClear()
    vi.mocked(getWorkflowMetadata).mockReturnValue({
      workflowName: "test-workflow",
      workflowRunId: "test-run",
      workflowStartedAt: new Date("2026-06-20T00:00:00.000Z"),
      url: "http://test.local/workflow",
    })
    vi.mocked(sleep).mockClear()
    vi.mocked(sleep).mockResolvedValue(undefined)
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
    expect(launchMastraTranscriptEmbedding).toHaveBeenCalledWith(
      {
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
      },
      { timeoutMs: 120_000 },
    )
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
    expect(launchMastraTranscriptEmbedding).toHaveBeenCalledWith(
      {
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
      },
      { timeoutMs: 120_000 },
    )
  })

  it("shares Manager transcript source loads inside a target-bounded step batch", async () => {
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

  it("skips already healthy enriched transcript rows during model-upgrade resumes", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw
      .mockResolvedValueOnce([row("v-a", "e-a", "core-a", "en")])
      .mockResolvedValueOnce([transcriptHealthRow()])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      mode: "model-upgrade",
    })

    expect(report.succeeded).toBe(0)
    expect(report.skipped).toBe(1)
    expect(report.failed).toBe(0)
    expect(report.outcomes[0]).toMatchObject({
      status: "skipped",
      language: "en",
      reason: "already_enriched_healthy",
    })
    expect(readTranscriptSourceArtifact).not.toHaveBeenCalled()
    expect(launchMastraTranscriptEmbedding).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: "legacy transcript rows",
      healthRows: [
        transcriptHealthRow({
          generationMode: null,
          sourceKind: null,
          chunksWithEmbeddingInputText: 0,
        }),
      ],
    },
    {
      label: "incomplete chunk rows",
      healthRows: [
        transcriptHealthRow({
          chunksWithEmbedding: 1,
          chunksWithEmbeddingInputText: 1,
        }),
      ],
    },
    {
      label: "rows missing embedding input text",
      healthRows: [
        transcriptHealthRow({
          chunksWithEmbeddingInputText: 1,
        }),
      ],
    },
    {
      label: "missing transcript rows",
      healthRows: [],
    },
    {
      label: "force-generated rows",
      healthRows: [
        transcriptHealthRow({
          generationMode: "force",
        }),
      ],
    },
    {
      label: "idempotent generation rows",
      healthRows: [
        transcriptHealthRow({
          generationMode: "idempotent",
        }),
      ],
    },
    {
      label: "rows with null source kind",
      healthRows: [
        transcriptHealthRow({
          sourceKind: null,
        }),
      ],
    },
    {
      label: "rows with empty source kind",
      healthRows: [
        transcriptHealthRow({
          sourceKind: "",
        }),
      ],
    },
    {
      label: "zero-chunk rows",
      healthRows: [
        transcriptHealthRow({
          totalChunks: 0,
          chunksWithEmbedding: 0,
          chunksWithEmbeddingInputText: 0,
        }),
      ],
    },
    {
      label: "rows with stale model stamps",
      healthRows: [
        transcriptHealthRow({
          model: "openai/text-embedding-future-model",
        }),
      ],
    },
    {
      label: "rows with stale providers",
      healthRows: [
        transcriptHealthRow({
          embeddingProvider: "openai",
        }),
      ],
    },
    {
      label: "rows with null providers",
      healthRows: [
        transcriptHealthRow({
          embeddingProvider: null,
        }),
      ],
    },
    {
      label: "rows with stale dimensions",
      healthRows: [
        transcriptHealthRow({
          dimensions: 3072,
        }),
      ],
    },
  ])(
    "keeps $label eligible in model-upgrade resumes",
    async ({ healthRows }) => {
      ;(prisma as unknown as PrismaStub).$queryRaw
        .mockResolvedValueOnce([row("v-a", "e-a", "core-a", "en")])
        .mockResolvedValueOnce(healthRows)

      const report = await runTranscriptEmbeddingBackfill({
        mappingS3Key: "admin-migrations/core-id-mapping.json",
        mode: "model-upgrade",
      })

      expect(report.succeeded).toBe(1)
      expect(report.skipped).toBe(0)
      expect(report.failed).toBe(0)
      expect(readTranscriptSourceArtifact).toHaveBeenCalledWith("1")
      expect(launchMastraTranscriptEmbedding).toHaveBeenCalledTimes(1)
      expect(
        vi.mocked(launchMastraTranscriptEmbedding).mock.calls[0]?.[0].mode,
      ).toBe("model-upgrade")
    },
  )

  it("batches model-upgrade resume health checks per durable process step", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw
      .mockResolvedValueOnce([
        row("v-a", "e-a", "core-a", "en"),
        row("v-b", "e-b", "core-b", "es"),
        row("v-c", "e-c", "core-c", "fr"),
      ])
      .mockResolvedValueOnce([
        transcriptHealthRow({
          videoEditionId: "e-a",
          language: "en",
        }),
        transcriptHealthRow({
          videoEditionId: "e-b",
          language: "es",
        }),
      ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      mode: "model-upgrade",
    })

    expect(report.skipped).toBe(2)
    expect(report.succeeded).toBe(1)
    expect((prisma as unknown as PrismaStub).$queryRaw).toHaveBeenCalledTimes(2)
    expect(launchMastraTranscriptEmbedding).toHaveBeenCalledTimes(1)
    expect(
      vi.mocked(launchMastraTranscriptEmbedding).mock.calls[0]?.[0],
    ).toMatchObject({
      target: {
        videoEditionId: "e-c",
      },
      language: "fr",
      mode: "model-upgrade",
    })
  })

  it("skips every language in a group when transcript source is missing and emits missingArtifacts once", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
    ])
    vi.mocked(readTranscriptSourceArtifact).mockRejectedValue(
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

  it("confirms timed-out Mastra launches through the later Admin ingest row", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw
      .mockResolvedValueOnce([row("v-a", "e-a", "core-a", "en")])
      .mockResolvedValueOnce([
        {
          total_chunks: 2,
          total_tokens: 24,
          model: "embeddings",
          dimensions: 1536,
          embedding_provider: "jesus-film-ai-gateway",
          source_content_hash: "sha256:confirmed",
          healthy_chunks: 2,
        },
      ])
    vi.mocked(launchMastraTranscriptEmbedding).mockResolvedValueOnce({
      ok: false,
      reason: "network_error",
      retryable: true,
      mastraRunId: "run-timeout-continued",
    })

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.succeeded).toBe(1)
    expect(report.failed).toBe(0)
    expect(report.outcomes[0]).toMatchObject({
      status: "succeeded",
      language: "en",
      chunksIndexed: 2,
      embeddingsWritten: 2,
    })
  })

  it("fails timed-out Mastra launches when no later Admin ingest row appears", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw
      .mockResolvedValueOnce([row("v-a", "e-a", "core-a", "en")])
      .mockResolvedValue([])
    vi.mocked(launchMastraTranscriptEmbedding).mockResolvedValueOnce({
      ok: false,
      reason: "network_error",
      retryable: true,
      mastraRunId: "run-timeout-never-ingested",
    })

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.succeeded).toBe(0)
    expect(report.failed).toBe(1)
    expect(report.outcomes[0]).toMatchObject({
      status: "failed",
      language: "en",
      reason: "network_error",
    })
    expect(sleep).toHaveBeenCalledTimes(240)
  })

  it("checks timed-out Mastra ingest confirmations in bounded rotating slices", async () => {
    const pending = [
      pendingConfirmation("en"),
      pendingConfirmation("es"),
      pendingConfirmation("fr"),
    ]
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValue([])

    const result = await _internals.confirmPendingTranscriptIngestsOnce(
      pending,
      2,
    )

    expect((prisma as unknown as PrismaStub).$queryRaw).toHaveBeenCalledTimes(2)
    expect(result.checkedCount).toBe(2)
    expect(result.outcomes).toEqual([])
    expect(result.pendingConfirmations.map((item) => item.language)).toEqual([
      "fr",
      "en",
      "es",
    ])
  })

  it("removes confirmed Mastra ingests from the bounded pending slice", async () => {
    const pending = [
      pendingConfirmation("en"),
      pendingConfirmation("es"),
      pendingConfirmation("fr"),
    ]
    ;(prisma as unknown as PrismaStub).$queryRaw
      .mockResolvedValueOnce([
        {
          total_chunks: 2,
          total_tokens: 24,
          model: "embeddings",
          dimensions: 1536,
          embedding_provider: "jesus-film-ai-gateway",
          source_content_hash: "sha256:confirmed",
          healthy_chunks: 2,
        },
      ])
      .mockResolvedValueOnce([])

    const result = await _internals.confirmPendingTranscriptIngestsOnce(
      pending,
      2,
    )

    expect(result.checkedCount).toBe(2)
    expect(result.outcomes).toHaveLength(1)
    expect(result.outcomes[0]).toMatchObject({
      status: "succeeded",
      language: "en",
      chunksIndexed: 2,
    })
    expect(result.pendingConfirmations.map((item) => item.language)).toEqual([
      "fr",
      "es",
    ])
  })

  it("fails final pending confirmations through bounded batches", async () => {
    const pending = Array.from({ length: 3 }, (_, i) =>
      pendingConfirmation(`l${i}`, {
        videoId: `v-${i}`,
        editionId: `e-${i}`,
        mastraRunId: `run-${i}`,
      }),
    )

    const outcomes =
      await _internals.failPendingTranscriptEmbeddingIngestsInBatches(
        pending,
        2,
      )

    expect(outcomes).toHaveLength(3)
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "failed",
      "failed",
      "failed",
    ])
    expect(outcomes.map((outcome) => outcome.language)).toEqual([
      "l0",
      "l1",
      "l2",
    ])
    expect(
      _internals
        .batchPendingConfirmations(pending, 2)
        .map((batch) => batch.length),
    ).toEqual([2, 1])
  })

  it("budgets final confirmation slices by full poll cycles", () => {
    expect(_internals.confirmationSliceBudget(3, 2, 240)).toBe(482)
    expect(_internals.confirmationSliceBudget(25, 25, 240)).toBe(241)
    expect(_internals.confirmationSliceBudget(26, 25, 240)).toBe(482)
  })

  it("checks multiple final confirmation slices before the first sleep", async () => {
    const pending = [
      pendingConfirmation("en"),
      pendingConfirmation("es"),
      pendingConfirmation("fr"),
    ]
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValue([
      {
        total_chunks: 2,
        total_tokens: 24,
        model: "embeddings",
        dimensions: 1536,
        embedding_provider: "jesus-film-ai-gateway",
        source_content_hash: "sha256:confirmed",
        healthy_chunks: 2,
      },
    ])

    const outcomes =
      await _internals.waitForPendingTranscriptIngestConfirmations(pending, 2)

    expect(outcomes).toHaveLength(3)
    expect((prisma as unknown as PrismaStub).$queryRaw).toHaveBeenCalledTimes(3)
    expect(sleep).not.toHaveBeenCalled()
  })

  it("reports target-bounded batch sizing through the workflow dispatch path", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce(
      Array.from({ length: 51 }, (_, i) =>
        row(`v-${i}`, `e-${i}`, "core-a", `l${i}`),
      ),
    )
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)

    try {
      const report = await runTranscriptEmbeddingBackfill({
        mappingS3Key: "admin-migrations/core-id-mapping.json",
      })

      const startMessage = logSpy.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes('"event":"start"'))

      expect(report.totalTargets).toBe(51)
      expect(report.succeeded).toBe(51)
      expect(JSON.parse(startMessage ?? "{}")).toMatchObject({
        totalTargets: 51,
        groupCount: 51,
        groupBatchCount: 2,
        stepTargetLimit: 50,
        confirmationBatchLimit:
          DEFAULT_TRANSCRIPT_EMBEDDING_CONFIRMATION_BATCH_LIMIT,
        concurrency: 2,
      })
    } finally {
      logSpy.mockRestore()
    }
  })

  it("uses sequential target-bounded group batch steps so production workflow steps are not parallel-repeated", async () => {
    const source = await readFile(
      new URL("./transcriptEmbeddingBackfill.ts", import.meta.url),
      "utf8",
    )

    expect(source).toMatch(/batchGroupsByTargetLimit\(\s*groups,/)
    expect(source).toMatch(/for \(const groupBatch of groupBatches\)/)
    expect(source).toMatch(
      /stepProcessTranscriptEmbeddingGroups\(\s*remainingBatch,/,
    )
    expect(source).not.toMatch(/\bstepProcessTranscriptEmbeddingGroup\(/)
    expect(source).not.toMatch(/Promise\.allSettled\(\s*groups\.map/)
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

  it("batches groups by target count and shards oversized multilingual groups into single-target entries", () => {
    const groups = _internals.groupTargetsByVideoEdition([
      target("v-a", "e-a", "core-a", 1, "en"),
      target("v-a", "e-a", "core-a", 1, "es"),
      target("v-a", "e-a", "core-a", 1, "fr"),
      target("v-a", "e-a", "core-a", 1, "af"),
      target("v-a", "e-a", "core-a", 1, "am"),
      target("v-a", "e-a", "core-a", 1, "ar"),
      target("v-b", "e-b", "core-b", 2, "en"),
    ])

    const batches = _internals.batchGroupsByTargetLimit(groups, 5)

    expect(batches).toHaveLength(2)
    expect(batches[0]?.map((group) => group.targets.length)).toEqual([
      1, 1, 1, 1, 1,
    ])
    expect(
      batches[0]?.flatMap((group) =>
        group.targets.map((target) => target.language),
      ),
    ).toEqual(["en", "es", "fr", "af", "am"])
    expect(batches[1]?.map((group) => group.targets.length)).toEqual([1, 1])
    expect(
      batches[1]?.flatMap((group) =>
        group.targets.map((target) => target.language),
      ),
    ).toEqual(["ar", "en"])
    expect(batches[1]?.[1]?.videoEditionId).toBe("e-b")
  })
})
