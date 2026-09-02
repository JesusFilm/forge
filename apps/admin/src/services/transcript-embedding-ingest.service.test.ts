import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID,
  ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
  ACTIVE_CONTENT_QUERY_EMBEDDING_MODEL,
  ACTIVE_CONTENT_QUERY_EMBEDDING_PROVIDER,
  CONTENT_EMBEDDING_CONTRACT_POINTER_ID,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
} from "./content-embedding-contract"

const { writeTranscriptEmbeddingPayloadMock } = vi.hoisted(() => ({
  writeTranscriptEmbeddingPayloadMock: vi.fn(),
}))

vi.mock("@/services/transcript-embedding.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/transcript-embedding.service")
    >()
  return {
    ...actual,
    writeTranscriptEmbeddingPayload: writeTranscriptEmbeddingPayloadMock,
    writeTranscriptEmbeddingPayloadInTransaction:
      writeTranscriptEmbeddingPayloadMock,
  }
})

const { ingestTranscriptEmbeddings, _internals } =
  await import("@/services/transcript-embedding-ingest.service")

function activeContractRow() {
  return {
    pointerId: CONTENT_EMBEDDING_CONTRACT_POINTER_ID,
    contractId: ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID,
    queryProvider: ACTIVE_CONTENT_QUERY_EMBEDDING_PROVIDER,
    queryModel: ACTIVE_CONTENT_QUERY_EMBEDDING_MODEL,
    queryNativeDimensions: ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
    queryDimensions: ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
    queryTransformVersion: null,
    storageProvider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
    storageModel: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
    storageNativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
    storageDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
    storageTransformVersion: null,
  }
}

function buildPrisma() {
  const queryRaw = vi.fn(
    async (
      strings: TemplateStringsArray,
      ..._args: unknown[]
    ): Promise<unknown[]> => {
      const sql = strings.join(" ")
      if (sql.includes("FROM content_embedding_contract_pointer")) {
        return [activeContractRow()]
      }
      return []
    },
  )
  const executeRaw = vi.fn(async (..._args: unknown[]): Promise<number> => 0)
  const findVideo = vi.fn(
    async (): Promise<{ id: string; coreId: string } | null> => ({
      id: "video-1",
      coreId: "core-1",
    }),
  )
  const findEdition = vi.fn(
    async (): Promise<{ id: string } | null> => ({ id: "edition-1" }),
  )
  const prisma: {
    video: { findFirst: typeof findVideo }
    videoEdition: { findFirst: typeof findEdition }
    $executeRaw: typeof executeRaw
    $queryRaw: typeof queryRaw
    $transaction: ReturnType<typeof vi.fn>
  } = {
    video: {
      findFirst: findVideo,
    },
    videoEdition: {
      findFirst: findEdition,
    },
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
    $transaction: vi.fn(),
  }
  prisma.$transaction.mockImplementation(
    async <T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T> => fn(prisma),
  )
  return prisma
}

function mockExistingTranscriptState(
  prisma: ReturnType<typeof buildPrisma>,
  input: {
    existing: Record<string, unknown> | null
    healthyChunks?: number
  },
) {
  vi.mocked(prisma.$queryRaw).mockImplementation(
    async (strings: TemplateStringsArray): Promise<unknown[]> => {
      const sql = strings.join(" ")
      if (sql.includes("FROM content_embedding_contract_pointer")) {
        return [activeContractRow()]
      }
      if (sql.includes("FROM video_transcript_chunk")) {
        return [{ count: input.healthyChunks ?? 0 }]
      }
      if (sql.includes("FROM video_transcript")) {
        return input.existing == null ? [] : [input.existing]
      }
      return []
    },
  )
}

function payload(overrides?: Record<string, unknown>) {
  const body = {
    target: {
      admin: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        coreId: "core-1",
      },
    },
    language: "en",
    source: {
      text: "Jesus teaches beside the lake.",
      segments: [{ start: 0, end: 2, text: "Jesus teaches beside the lake." }],
      artifactKey: "42/transcript.json",
      provider: "mux",
      generatedAt: "2026-05-25T00:00:00.000Z",
    },
    model: {
      name: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
      provider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
      dimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
      nativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
    },
    chunking: {
      type: "segment-aware",
      maxChunkTokens: 500,
      overlapTokens: 100,
      version: "mastra-v1",
    },
    generation: {
      mode: "idempotent",
      generatedAt: "2026-05-25T00:01:00.000Z",
      mastraRunId: "run-1",
    },
    chunks: [
      {
        chunkIndex: 0,
        chunkId: "chunk-0",
        text: "Jesus teaches beside the lake.",
        tokenCount: 6,
        startSeconds: 0,
        endSeconds: 2,
        embedding: new Array(ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS).fill(
          0.01,
        ),
      },
    ],
    ...overrides,
  }
  const source = body.source as Record<string, unknown>
  source.contentHash ??= hashFor(body)
  return body
}

function hashFor(body: ReturnType<typeof payload>): string {
  const source = body.source as {
    text?: string
    segments?: unknown
    kind?: string
    artifactKey?: string
    languageId?: string
    languageSlug?: string
    subtitleId?: string
    format?: string
    url?: string
    provider?: string
    generatedAt?: string
  }
  const hasV2SourceMetadata =
    source.kind != null ||
    source.languageId != null ||
    source.languageSlug != null ||
    source.subtitleId != null ||
    source.format != null ||
    source.url != null

  return _internals.sha256Json({
    text: source.text ?? null,
    segments: source.segments ?? null,
    ...(hasV2SourceMetadata
      ? {
          source: {
            kind: source.kind ?? null,
            artifactKey: source.artifactKey ?? null,
            languageId: source.languageId ?? null,
            languageSlug: source.languageSlug ?? null,
            subtitleId: source.subtitleId ?? null,
            format: source.format ?? null,
            url: source.url ?? null,
            provider: source.provider ?? null,
            generatedAt: source.generatedAt ?? null,
          },
        }
      : {}),
    chunks: (
      body.chunks as Array<{
        chunkIndex: number
        text: string
        startSeconds?: number
        endSeconds?: number
        rawSourceText?: string
        embeddingInputText?: string
        feltNeeds?: string[]
        bibleVerses?: string[]
        contentSummary?: string
        tone?: string
        demographics?: string[]
        spiritualContext?: string[]
        extractionMetadata?: Record<string, unknown>
      }>
    ).map((chunk) => {
      const base = {
        index: chunk.chunkIndex,
        text: chunk.text,
        startSeconds: chunk.startSeconds ?? null,
        endSeconds: chunk.endSeconds ?? null,
      }
      const hasEnrichedFields =
        chunk.rawSourceText != null ||
        chunk.embeddingInputText != null ||
        (chunk.feltNeeds?.length ?? 0) > 0 ||
        (chunk.bibleVerses?.length ?? 0) > 0 ||
        chunk.contentSummary != null ||
        chunk.tone != null ||
        (chunk.demographics?.length ?? 0) > 0 ||
        (chunk.spiritualContext?.length ?? 0) > 0 ||
        chunk.extractionMetadata != null

      return hasEnrichedFields
        ? {
            ...base,
            rawSourceText: chunk.rawSourceText ?? null,
            embeddingInputText: chunk.embeddingInputText ?? null,
            feltNeeds: chunk.feltNeeds ?? [],
            bibleVerses: chunk.bibleVerses ?? [],
            contentSummary: chunk.contentSummary ?? null,
            tone: chunk.tone ?? null,
            demographics: chunk.demographics ?? [],
            spiritualContext: chunk.spiritualContext ?? [],
            extractionMetadata: chunk.extractionMetadata ?? null,
          }
        : base
    }),
  })
}

describe("ingestTranscriptEmbeddings", () => {
  beforeEach(() => {
    writeTranscriptEmbeddingPayloadMock.mockReset()
    writeTranscriptEmbeddingPayloadMock.mockResolvedValue({
      chunksIndexed: 1,
      embeddingsWritten: 1,
    })
  })

  it("writes a valid Mastra-shaped payload into the transcript vector writer", async () => {
    const prisma = buildPrisma()

    const result = await ingestTranscriptEmbeddings(prisma as never, payload())

    expect(result).toMatchObject({
      status: "created",
      target: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        language: "en",
      },
      chunks: 1,
      dimensions: 1536,
      mastraRunId: "run-1",
    })
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 30_000,
    })
    expect(writeTranscriptEmbeddingPayloadMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        editionId: "edition-1",
        videoId: "video-1",
        language: "en",
        chunks: expect.arrayContaining([
          expect.objectContaining({ chunkIndex: 0, chunkId: "chunk-0" }),
        ]),
        provenance: expect.objectContaining({
          embeddingProvider: "jesus-film-ai-gateway",
          embeddingNativeDimensions:
            ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
          embeddingTransformVersion: undefined,
          sourceArtifactKey: "42/transcript.json",
          generationMode: "idempotent",
          mastraRunId: "run-1",
          chunkingVersion: "mastra-v1",
        }),
      }),
    )
  })

  it("accepts and forwards v2 enriched transcript chunk fields", async () => {
    const prisma = buildPrisma()
    const body = payload({
      source: {
        text: "Jesus teaches beside the lake.",
        segments: [
          { start: 0, end: 2, text: "Jesus teaches beside the lake." },
        ],
        artifactKey: "admin-video-subtitle/sub-1.vtt",
        kind: "subtitle",
        languageId: "lang-en",
        languageSlug: "english",
        subtitleId: "sub-1",
        format: "vtt",
        url: "https://api-media-core.jesusfilm.org/subtitles/en.vtt",
        provider: "admin-subtitle",
        generatedAt: "2026-05-25T00:00:00.000Z",
      },
      chunks: [
        {
          chunkIndex: 0,
          chunkId: "chunk-0",
          text: "Jesus teaches beside the lake.",
          rawSourceText: "Jesus teaches beside the lake.",
          embeddingInputText:
            "Time range: 00:00-00:02\nFelt needs: Hope\nSummary: Jesus teaches beside the lake.\nTranscript: Jesus teaches beside the lake.",
          feltNeeds: ["Hope"],
          bibleVerses: ["John 3:16"],
          contentSummary: "Jesus teaches beside the lake.",
          tone: "gentle",
          demographics: ["seekers"],
          spiritualContext: ["teaching"],
          extractionMetadata: { extractor: "deterministic-test" },
          tokenCount: 24,
          startSeconds: 0,
          endSeconds: 2,
          embedding: new Array(
            ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
          ).fill(0.01),
        },
      ],
    })

    const result = await ingestTranscriptEmbeddings(prisma as never, body)

    expect(result.status).toBe("created")
    expect(writeTranscriptEmbeddingPayloadMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        chunks: [
          expect.objectContaining({
            rawSourceText: "Jesus teaches beside the lake.",
            embeddingInputText: expect.stringContaining("Time range:"),
            feltNeeds: ["Hope"],
            bibleVerses: ["John 3:16"],
            contentSummary: "Jesus teaches beside the lake.",
            tone: "gentle",
            demographics: ["seekers"],
            spiritualContext: ["teaching"],
            extractionMetadata: { extractor: "deterministic-test" },
          }),
        ],
        provenance: expect.objectContaining({
          sourceArtifactKey: "admin-video-subtitle/sub-1.vtt",
          sourceKind: "subtitle",
          sourceLanguageId: "lang-en",
          sourceLanguageSlug: "english",
          sourceSubtitleId: "sub-1",
          sourceFormat: "vtt",
          sourceUrl: "https://api-media-core.jesusfilm.org/subtitles/en.vtt",
          sourceProvider: "admin-subtitle",
        }),
      }),
    )
  })

  it("rejects unsupported felt-needs values", async () => {
    const prisma = buildPrisma()
    const body = payload({
      chunks: [
        {
          chunkIndex: 0,
          chunkId: "chunk-0",
          text: "Jesus teaches beside the lake.",
          tokenCount: 6,
          startSeconds: 0,
          endSeconds: 2,
          feltNeeds: ["Belonging"],
          embedding: new Array(1536).fill(0.01),
        },
      ],
    })

    await expect(
      ingestTranscriptEmbeddings(prisma as never, body),
    ).rejects.toMatchObject({
      code: "payload_invalid",
    })
    expect(writeTranscriptEmbeddingPayloadMock).not.toHaveBeenCalled()
  })

  it("includes enriched metadata in v2 source hashes", () => {
    const base = payload({
      source: {
        ...(payload().source as object),
        kind: "subtitle",
        languageId: "lang-en",
      },
    })
    const enriched = payload({
      source: base.source as object,
      chunks: [
        {
          ...((base.chunks as unknown[])[0] as object),
          feltNeeds: ["Hope"],
          embeddingInputText: "Felt needs: Hope\nTranscript: Jesus teaches.",
        },
      ],
    })

    expect(hashFor(base)).not.toEqual(hashFor(enriched))
  })

  it("returns unchanged and skips writes when default mode sees healthy matching provenance", async () => {
    const prisma = buildPrisma()
    const body = payload()
    const hash = hashFor(body)
    mockExistingTranscriptState(prisma, {
      existing: {
        id: "transcript-1",
        sourceContentHash: hash,
        model: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
        dimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        embeddingProvider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
        embeddingNativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        embeddingTransformVersion: null,
        chunkingType: "segment-aware",
        maxChunkTokens: 500,
        overlapTokens: 100,
        totalChunks: 1,
        totalTokens: 6,
      },
      healthyChunks: 1,
    })

    const bodyWithHash = payload({
      source: {
        ...(payload().source as object),
        contentHash: hash,
      },
    })

    const result = await ingestTranscriptEmbeddings(
      prisma as never,
      bodyWithHash,
    )

    expect(result.status).toBe("unchanged")
    expect(writeTranscriptEmbeddingPayloadMock).not.toHaveBeenCalled()
  })

  it("rejects equal-dimension legacy OpenAI payloads when the provider tuple differs", async () => {
    const prisma = buildPrisma()
    await expect(
      ingestTranscriptEmbeddings(
        prisma as never,
        payload({
          model: {
            name: "openai/text-embedding-3-small",
            provider: "openai",
            dimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
            nativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "contract_mismatch" })
    expect(writeTranscriptEmbeddingPayloadMock).not.toHaveBeenCalled()
  })

  it("repair mode rewrites when provenance matches but chunks are missing", async () => {
    const prisma = buildPrisma()
    const base = payload()
    const hash = hashFor(base)
    const body = payload({
      generation: {
        mode: "repair",
        generatedAt: "2026-05-25T00:01:00.000Z",
        mastraRunId: "run-repair",
      },
      source: {
        ...(payload().source as object),
        contentHash: hash,
      },
    })
    mockExistingTranscriptState(prisma, {
      existing: {
        id: "transcript-1",
        sourceContentHash: hash,
        model: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
        dimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        embeddingProvider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
        embeddingNativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        embeddingTransformVersion: null,
        chunkingType: "segment-aware",
        maxChunkTokens: 500,
        overlapTokens: 100,
        totalChunks: 1,
        totalTokens: 6,
      },
      healthyChunks: 0,
    })

    const result = await ingestTranscriptEmbeddings(prisma as never, body)

    expect(result.status).toBe("repaired")
    expect(writeTranscriptEmbeddingPayloadMock).toHaveBeenCalledTimes(1)
  })

  it("repair mode leaves healthy matching chunks unchanged", async () => {
    const prisma = buildPrisma()
    const base = payload()
    const hash = hashFor(base)
    const body = payload({
      generation: {
        mode: "repair",
        generatedAt: "2026-05-25T00:01:00.000Z",
        mastraRunId: "run-repair-healthy",
      },
      source: {
        ...(payload().source as object),
        contentHash: hash,
      },
    })
    mockExistingTranscriptState(prisma, {
      existing: {
        id: "transcript-1",
        sourceContentHash: hash,
        model: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
        dimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        embeddingProvider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
        embeddingNativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        embeddingTransformVersion: null,
        chunkingType: "segment-aware",
        maxChunkTokens: 500,
        overlapTokens: 100,
        totalChunks: 1,
        totalTokens: 6,
      },
      healthyChunks: 1,
    })

    const result = await ingestTranscriptEmbeddings(prisma as never, body)

    expect(result.status).toBe("unchanged")
    expect(writeTranscriptEmbeddingPayloadMock).not.toHaveBeenCalled()
  })

  it("retries serializable transcript writes before surfacing write_failed", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const prisma = buildPrisma()
    const serializationFailure = Object.assign(
      new Error("Transaction failed due to a write conflict or a deadlock"),
      {
        name: "PrismaClientKnownRequestError",
        code: "P2034",
      },
    )
    writeTranscriptEmbeddingPayloadMock
      .mockRejectedValueOnce(serializationFailure)
      .mockResolvedValueOnce(undefined)

    const result = await ingestTranscriptEmbeddings(prisma as never, payload())

    expect(result.status).toBe("created")
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(writeTranscriptEmbeddingPayloadMock).toHaveBeenCalledTimes(2)
    expect(
      warnSpy.mock.calls.some(([message]) =>
        String(message).includes(
          "transcript_embedding_ingest_transaction_retry",
        ),
      ),
    ).toBe(true)
    warnSpy.mockRestore()
  })

  it("detects retryable Prisma transaction codes before nested causes", () => {
    const retryableWithCause = Object.assign(
      new Error("Transaction failed due to a write conflict or a deadlock"),
      {
        name: "PrismaClientKnownRequestError",
        code: "P2034",
        cause: new Error("nested non-retryable wrapper"),
      },
    )

    expect(
      _internals.isRetryableTranscriptIngestTransactionError(
        retryableWithCause,
      ),
    ).toBe(true)
  })

  it("force mode rewrites even when existing provenance and chunks are healthy", async () => {
    const prisma = buildPrisma()
    const base = payload()
    const hash = hashFor(base)
    const body = payload({
      generation: {
        mode: "force",
        generatedAt: "2026-05-25T00:01:00.000Z",
        mastraRunId: "run-force",
      },
      source: {
        ...(payload().source as object),
        contentHash: hash,
      },
    })
    mockExistingTranscriptState(prisma, {
      existing: {
        id: "transcript-1",
        sourceContentHash: hash,
        model: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
        dimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        embeddingProvider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
        embeddingNativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        embeddingTransformVersion: null,
        chunkingType: "segment-aware",
        maxChunkTokens: 500,
        overlapTokens: 100,
        totalChunks: 1,
        totalTokens: 6,
      },
      healthyChunks: 1,
    })

    const result = await ingestTranscriptEmbeddings(prisma as never, body)

    expect(result.status).toBe("forced")
    expect(writeTranscriptEmbeddingPayloadMock).toHaveBeenCalledTimes(1)
  })

  it("model-upgrade mode rewrites matching healthy chunks with model-upgraded status", async () => {
    const prisma = buildPrisma()
    const base = payload()
    const hash = hashFor(base)
    const body = payload({
      generation: {
        mode: "model-upgrade",
        generatedAt: "2026-05-25T00:01:00.000Z",
        mastraRunId: "run-model-upgrade",
      },
      source: {
        ...(payload().source as object),
        contentHash: hash,
      },
    })
    mockExistingTranscriptState(prisma, {
      existing: {
        id: "transcript-1",
        sourceContentHash: hash,
        model: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
        dimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        embeddingProvider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
        embeddingNativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        embeddingTransformVersion: null,
        chunkingType: "segment-aware",
        maxChunkTokens: 500,
        overlapTokens: 100,
        totalChunks: 1,
        totalTokens: 6,
      },
      healthyChunks: 1,
    })

    const result = await ingestTranscriptEmbeddings(prisma as never, body)

    expect(result.status).toBe("model_upgraded")
    expect(writeTranscriptEmbeddingPayloadMock).toHaveBeenCalledTimes(1)
  })

  it("rejects default idempotent mode when an existing transcript differs", async () => {
    const prisma = buildPrisma()
    mockExistingTranscriptState(prisma, {
      existing: {
        id: "transcript-1",
        sourceContentHash: "sha256:old",
        model: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
        dimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        embeddingProvider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
        embeddingNativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        embeddingTransformVersion: null,
        chunkingType: "segment-aware",
        maxChunkTokens: 500,
        overlapTokens: 100,
        totalChunks: 1,
        totalTokens: 6,
      },
    })

    const result = await ingestTranscriptEmbeddings(prisma as never, payload())

    expect(result).toMatchObject({
      status: "rejected",
      reason: "existing_transcript_differs",
    })
    expect(writeTranscriptEmbeddingPayloadMock).not.toHaveBeenCalled()
  })

  it("rejects dimension drift by failing the contract match before writing", async () => {
    const prisma = buildPrisma()
    await expect(
      ingestTranscriptEmbeddings(
        prisma as never,
        payload({
          model: {
            name: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
            provider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
            dimensions: 768,
            nativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "contract_mismatch" })
    expect(writeTranscriptEmbeddingPayloadMock).not.toHaveBeenCalled()
  })

  it("rejects admin targets whose edition does not belong to the video", async () => {
    const prisma = buildPrisma()
    prisma.videoEdition.findFirst.mockResolvedValueOnce(null)

    await expect(
      ingestTranscriptEmbeddings(prisma as never, payload()),
    ).rejects.toMatchObject({ code: "target_not_found" })

    expect(prisma.videoEdition.findFirst).toHaveBeenCalledWith({
      where: {
        id: "edition-1",
        dubs: { some: { videoId: "video-1", deletedAt: null } },
        deletedAt: null,
      },
      select: { id: true },
    })
    expect(writeTranscriptEmbeddingPayloadMock).not.toHaveBeenCalled()
  })

  it("rejects admin targets whose coreId does not match the resolved video", async () => {
    const prisma = buildPrisma()
    prisma.video.findFirst.mockResolvedValueOnce({
      id: "video-1",
      coreId: "core-actual",
    })

    await expect(
      ingestTranscriptEmbeddings(prisma as never, payload()),
    ).rejects.toMatchObject({ code: "target_not_found" })
    expect(writeTranscriptEmbeddingPayloadMock).not.toHaveBeenCalled()
  })

  it("rejects invalid transcript segment and chunk timing before writing", async () => {
    const prisma = buildPrisma()

    await expect(
      ingestTranscriptEmbeddings(
        prisma as never,
        payload({
          source: {
            ...(payload().source as object),
            segments: [{ start: 10, end: 2, text: "time drift" }],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "payload_invalid" })

    await expect(
      ingestTranscriptEmbeddings(
        prisma as never,
        payload({
          chunks: [
            {
              ...(payload().chunks[0] as object),
              startSeconds: 10,
              endSeconds: 2,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "chunk_invalid" })
    expect(writeTranscriptEmbeddingPayloadMock).not.toHaveBeenCalled()
  })

  it("rejects ambiguous external targets before writing", async () => {
    const prisma = buildPrisma()
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { videoId: "video-1", videoEditionId: "edition-1", coreId: "core-1" },
      { videoId: "video-2", videoEditionId: "edition-2", coreId: "core-2" },
    ])

    await expect(
      ingestTranscriptEmbeddings(
        prisma as never,
        payload({
          target: { external: { assetId: "42", muxAssetId: "mux-1" } },
        }),
      ),
    ).rejects.toMatchObject({ code: "target_ambiguous" })
    expect(writeTranscriptEmbeddingPayloadMock).not.toHaveBeenCalled()
  })

  it("constrains external target resolution with Admin video id when provided", async () => {
    const prisma = buildPrisma()
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { videoId: "video-1", videoEditionId: "edition-1", coreId: "core-1" },
    ])

    await ingestTranscriptEmbeddings(
      prisma as never,
      payload({
        target: {
          external: {
            assetId: "42",
            muxAssetId: "mux-1",
            adminVideoId: "video-1",
          },
        },
      }),
    )

    const resolveTargetCall = vi.mocked(prisma.$queryRaw).mock.calls[0] ?? []
    expect(resolveTargetCall).toEqual(expect.arrayContaining(["mux-1"]))
    expect(resolveTargetCall).toEqual(expect.arrayContaining(["video-1"]))
  })

  it("rejects external target assetId drift before resolving a target", async () => {
    const prisma = buildPrisma()

    await expect(
      ingestTranscriptEmbeddings(
        prisma as never,
        payload({
          target: { external: { assetId: "other", muxAssetId: "mux-1" } },
        }),
      ),
    ).rejects.toMatchObject({ code: "payload_invalid" })

    expect(prisma.$queryRaw).not.toHaveBeenCalled()
    expect(writeTranscriptEmbeddingPayloadMock).not.toHaveBeenCalled()
  })

  it("rejects invalid provenance timestamps before writing", async () => {
    const prisma = buildPrisma()

    await expect(
      ingestTranscriptEmbeddings(
        prisma as never,
        payload({
          generation: {
            mode: "idempotent",
            generatedAt: "not-a-date",
            mastraRunId: "run-bad-date",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "payload_invalid" })

    expect(prisma.$queryRaw).not.toHaveBeenCalled()
    expect(writeTranscriptEmbeddingPayloadMock).not.toHaveBeenCalled()
  })
})
