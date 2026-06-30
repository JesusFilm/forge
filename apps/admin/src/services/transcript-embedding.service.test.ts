// Unit tests for indexEditionTranscript.
//
// DB interactions are tested against a stub Prisma client that mirrors
// the call surface we use after Stage 3 (feat-117): $transaction +
// videoTranscript.upsert + videoTranscriptChunk.deleteMany +
// tx.$executeRaw (one bulk chunk INSERT). True end-to-end verification
// against a live Postgres with pgvector is out of scope for the unit
// tests; the prod smoke run for Stage 3 covers it.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Principal } from "@/auth/principal"
import {
  EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
  type EmbeddingsResult,
  indexEditionTranscript,
  TranscriptIndexError,
} from "./transcript-embedding.service"

const SYSTEM = { id: null, role: "SYSTEM" } as const satisfies Principal
const ADMIN = { id: "admin-1", role: "ADMIN" } as const satisfies Principal
const VIEWER = { id: "viewer-1", role: "VIEWER" } as const satisfies Principal

type UpsertCall = { where: unknown; create: unknown; update: unknown }

type StubPrismaTx = {
  videoTranscript: { upsert: ReturnType<typeof vi.fn> }
  videoTranscriptChunk: {
    deleteMany: ReturnType<typeof vi.fn>
  }
  $executeRaw: ReturnType<typeof vi.fn>
}

function buildStubPrisma(opts?: {
  prunedCount?: number
  /** Number returned by the bulk chunk INSERT (default 1). */
  executeRawAffected?: number
}) {
  // A brace-free synthetic id so the bulk INSERT's toPgArray brace-rejection
  // doesn't trip on the stub's payload echo. The original test's
  // `transcript-${JSON.stringify(args.where)}` shape carried `{`/`}` through
  // and broke Stage 3's bound `text[]` of transcriptIds.
  const videoTranscriptUpsert = vi.fn(async (_args: UpsertCall) => ({
    id: "transcript-stub-id",
  }))
  const videoTranscriptChunkDeleteMany = vi.fn(async () => ({
    count: opts?.prunedCount ?? 0,
  }))
  const executeRaw = vi.fn(async () => opts?.executeRawAffected ?? 1)

  const tx: StubPrismaTx = {
    videoTranscript: { upsert: videoTranscriptUpsert },
    videoTranscriptChunk: {
      deleteMany: videoTranscriptChunkDeleteMany,
    },
    $executeRaw: executeRaw,
  }

  const prisma = {
    $transaction: vi.fn(
      async (
        fn: (tx: StubPrismaTx) => Promise<void>,
        _opts?: { timeout?: number },
      ) => {
        return fn(tx)
      },
    ),
    ...tx,
  }

  return {
    prisma: prisma as unknown as import("@prisma/client").PrismaClient,
    tx,
    videoTranscriptUpsert,
    videoTranscriptChunkDeleteMany,
    executeRaw,
  }
}

function buildArtifact(
  opts?: Partial<EmbeddingsResult> & { chunkCount?: number },
): EmbeddingsResult {
  const chunkCount = opts?.chunkCount ?? 2
  const chunks = Array.from({ length: chunkCount }, (_, i) => ({
    chunkId: `chunk-${i}`,
    text: `transcript chunk ${i}: spoken content of the video`,
    embedding: new Array(EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS).fill(
      0.01 * (i + 1),
    ),
    metadata: {
      tokenCount: 10 + i,
      startTime: i * 5,
      endTime: (i + 1) * 5,
    },
  }))
  return {
    model: "embeddings",
    dimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
    chunks,
    averagedEmbedding: new Array(EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS).fill(
      0,
    ),
    metadata: {
      totalChunks: chunkCount,
      totalTokens: chunks.reduce((sum, c) => sum + c.metadata.tokenCount, 0),
      chunkingStrategy: {
        type: "segment-aware",
        maxChunkTokens: 500,
        overlapTokens: 100,
      },
      embeddingDimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
      generatedAt: "2026-04-10T00:00:00.000Z",
    },
    ...opts,
  }
}

describe("indexEditionTranscript", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("rejects a null (unauthenticated) principal with forbidden", async () => {
    const { prisma } = buildStubPrisma()
    await expect(
      indexEditionTranscript(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        language: "en",
        user: null,
        loadedArtifact: buildArtifact(),
      }),
    ).rejects.toMatchObject({
      name: "TranscriptIndexError",
      code: "forbidden",
    })
  })

  it("rejects principals that cannot write derived columns", async () => {
    const { prisma } = buildStubPrisma()
    await expect(
      indexEditionTranscript(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        language: "en",
        user: VIEWER,
        loadedArtifact: buildArtifact(),
      }),
    ).rejects.toMatchObject({ code: "forbidden" })
  })

  it("returns zero counts for an empty artifact without touching the DB", async () => {
    const { prisma, videoTranscriptUpsert, executeRaw } = buildStubPrisma()
    // Even though R2 reuses vectors verbatim from the artifact (the embedding
    // provider isn't imported into the transcript indexer at all), spy on
    // the embeddings module to lock the invariant. A regression that
    // accidentally re-introduced a provider call on R2 would fire this
    // assertion long before any other test caught the round-trip.
    const embeddingsModule = await import("@/services/embeddings.service")
    const generateSpy = vi.spyOn(
      embeddingsModule,
      "generateExperienceEmbedding",
    )
    const generateBatchedSpy = vi.spyOn(
      embeddingsModule,
      "generateExperienceEmbeddings",
    )

    const result = await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      loadedArtifact: buildArtifact({ chunkCount: 0 }),
    })
    expect(result.chunksIndexed).toBe(0)
    expect(result.embeddingsWritten).toBe(0)
    expect(videoTranscriptUpsert).not.toHaveBeenCalled()
    expect(executeRaw).not.toHaveBeenCalled()
    expect(generateSpy).not.toHaveBeenCalled()
    expect(generateBatchedSpy).not.toHaveBeenCalled()
  })

  it("rejects an artifact with dimensions != 1536", async () => {
    const { prisma, executeRaw } = buildStubPrisma()
    await expect(
      indexEditionTranscript(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        language: "en",
        user: SYSTEM,
        loadedArtifact: buildArtifact({ dimensions: 768 }),
      }),
    ).rejects.toMatchObject({ code: "dimension_mismatch" })
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it("rejects a chunk whose embedding length disagrees with top-level dimensions", async () => {
    const { prisma, executeRaw } = buildStubPrisma()
    const artifact = buildArtifact({ chunkCount: 1 })
    artifact.chunks[0]!.embedding = new Array(100).fill(0)
    await expect(
      indexEditionTranscript(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        language: "en",
        user: SYSTEM,
        loadedArtifact: artifact,
      }),
    ).rejects.toMatchObject({ code: "dimension_mismatch" })
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it("rejects a chunk with empty (whitespace-only) text", async () => {
    const { prisma } = buildStubPrisma()
    const artifact = buildArtifact({ chunkCount: 1 })
    artifact.chunks[0]!.text = "   "
    await expect(
      indexEditionTranscript(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        language: "en",
        user: SYSTEM,
        loadedArtifact: artifact,
      }),
    ).rejects.toMatchObject({ code: "empty_chunk_text" })
  })

  it("collapses per-target writes to: 1 parent upsert + 1 deleteMany + 1 bulk chunk INSERT (Stage 3)", async () => {
    // Stage 3 (feat-117) contract: per-chunk upsert + per-row UPDATE
    // collapse to ONE bulk INSERT regardless of chunks.length.
    const {
      prisma,
      videoTranscriptUpsert,
      videoTranscriptChunkDeleteMany,
      executeRaw,
    } = buildStubPrisma({ executeRawAffected: 3 })

    const result = await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: ADMIN,
      loadedArtifact: buildArtifact({ chunkCount: 3 }),
      provenance: {
        embeddingProvider: "jesus-film-ai-gateway",
        embeddingNativeDimensions: 4096,
        embeddingTransformVersion: "matryoshka-truncate-1536-v1",
      },
    })

    expect(result).toMatchObject({
      editionId: "edition-1",
      language: "en",
      chunksIndexed: 3,
      embeddingsWritten: 3,
      chunksPruned: 0,
      model: "embeddings",
      dimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
    })
    expect(videoTranscriptUpsert).toHaveBeenCalledTimes(1)
    expect(videoTranscriptChunkDeleteMany).toHaveBeenCalledTimes(1)
    // EXACTLY 1 $executeRaw call: the bulk chunk INSERT.
    expect(executeRaw).toHaveBeenCalledTimes(1)

    // Artifact's own metadata still lands on the parent row.
    expect(videoTranscriptUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          videoEditionId: "edition-1",
          language: "en",
          model: "embeddings",
          dimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
          embeddingProvider: "jesus-film-ai-gateway",
          embeddingNativeDimensions: 4096,
          embeddingTransformVersion: "matryoshka-truncate-1536-v1",
          chunkingType: "segment-aware",
          totalChunks: 3,
        }),
      }),
    )
  })

  it("R2 chunk-INSERT SQL invariants — INSERT INTO video_transcript_chunk + Way A vector cast + ON CONFLICT DO UPDATE + EXCLUDED.embedding", async () => {
    const { prisma, executeRaw } = buildStubPrisma()
    await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      loadedArtifact: buildArtifact({ chunkCount: 2 }),
    })
    expect(executeRaw).toHaveBeenCalledTimes(1)
    const [strings] = executeRaw.mock.calls[0] as unknown as [
      readonly string[],
      ...unknown[],
    ]
    const sql = strings.join("?")
    expect(sql).toContain("INSERT INTO video_transcript_chunk")
    expect(sql).toContain("raw_source_text")
    expect(sql).toContain("embedding_input_text")
    expect(sql).toContain("felt_needs")
    expect(sql).toContain("content_summary")
    expect(sql).toContain("extraction_metadata")
    expect(sql).toContain("unnest(")
    expect(sql).toContain("::text[]")
    // Way A vector cast — per-row at the SELECT seam, NOT
    // `::vector(1536)[]` on the parameter.
    expect(sql).toContain("::vector(1536)")
    expect(sql).not.toMatch(/::vector\(1536\)\[\]/)
    expect(sql).toMatch(
      /ON\s+CONFLICT\s*\(\s*transcript_id\s*,\s*chunk_index\s*\)/i,
    )
    expect(sql).toMatch(/DO\s+UPDATE\s+SET/i)
    expect(sql).toContain("EXCLUDED.embedding")
  })

  it("bind-count regression — chunk INSERT binds a CONSTANT number of params regardless of chunks.length (Stage 3 — feat-117)", async () => {
    // Same regression guard as R1's locale INSERT: each parallel array
    // binds as ONE positional parameter, so the placeholder count is
    // fixed. A regression to per-row binding (one parameter per chunk)
    // would make the bind count grow with N — this test catches it.
    const runWith = async (n: number) => {
      const { prisma, executeRaw } = buildStubPrisma()
      await indexEditionTranscript(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        language: "en",
        user: SYSTEM,
        loadedArtifact: buildArtifact({ chunkCount: n }),
      })
      const call = executeRaw.mock.calls[0] as unknown as [
        readonly string[],
        ...unknown[],
      ]
      return call.length - 1
    }

    const small = await runWith(3)
    const large = await runWith(30)

    expect(small).toBe(large)
  })

  it("does not call the embedding provider (vector reuse)", async () => {
    // Hard guarantee: the embeddings service must NOT be imported by
    // the transcript indexer. A naive port of R1's scene indexer
    // would accidentally pull it in; this test locks the invariant.
    const embeddingsModule = await import("@/services/embeddings.service")
    const spy = vi.spyOn(embeddingsModule, "generateExperienceEmbedding")

    const { prisma } = buildStubPrisma()
    await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      loadedArtifact: buildArtifact({ chunkCount: 2 }),
    })

    expect(spy).not.toHaveBeenCalled()
  })

  it("warns on model-stamp drift with a structured payload and still writes the vectors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { prisma, executeRaw } = buildStubPrisma()

    const result = await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      loadedArtifact: buildArtifact({
        chunkCount: 1,
        model: "openai/text-embedding-future-model",
      }),
    })

    expect(result.chunksIndexed).toBe(1)
    expect(result.embeddingsWritten).toBe(1)
    expect(executeRaw).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const [payload] = warnSpy.mock.calls[0]!
    const parsed = JSON.parse(String(payload))
    expect(parsed).toMatchObject({
      event: "transcript_model_mismatch",
      artifactModel: "openai/text-embedding-future-model",
    })
    expect(parsed.expected).toEqual(
      expect.arrayContaining([
        "openai/text-embedding-3-small",
        "text-embedding-3-small",
        "embeddings",
      ]),
    )
    expect(typeof parsed.note).toBe("string")
  })

  it("prunes chunks scoped to the current transcript with the right notIn range", async () => {
    const { prisma, videoTranscriptChunkDeleteMany, videoTranscriptUpsert } =
      buildStubPrisma({ prunedCount: 5 })
    videoTranscriptUpsert.mockResolvedValueOnce({ id: "transcript-abc" })

    const result = await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      loadedArtifact: buildArtifact({ chunkCount: 2 }),
    })

    expect(result.chunksPruned).toBe(5)
    expect(result.chunksIndexed).toBe(2)
    expect(videoTranscriptChunkDeleteMany).toHaveBeenCalledWith({
      where: {
        transcriptId: "transcript-abc",
        chunkIndex: { notIn: [0, 1] },
      },
    })
  })

  it("refreshes `videoId` on re-index so edition-moves don't strand denormalized rows", async () => {
    const { prisma, videoTranscriptUpsert } = buildStubPrisma()
    await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-moved-to-B",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      loadedArtifact: buildArtifact({ chunkCount: 1 }),
    })
    expect(videoTranscriptUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ videoId: "video-moved-to-B" }),
      }),
    )
  })

  it("vector position stability — chunk[i] vector lands at position i in the bound text[] of vector literals (Stage 3)", async () => {
    // The bulk INSERT binds an ARRAY of vector literals (one per chunk)
    // as ONE positional parameter; the per-row Way A cast at the SELECT
    // seam attaches each vector literal to its parallel-array sibling.
    // Position-stability between chunks[i].embedding and the bound
    // literal[i] is the load-bearing invariant.
    const { prisma, executeRaw } = buildStubPrisma()
    const artifact = buildArtifact({ chunkCount: 2 })
    artifact.chunks[0]!.embedding = new Array(
      EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
    ).fill(0.111)
    artifact.chunks[1]!.embedding = new Array(
      EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
    ).fill(0.222)

    await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      loadedArtifact: artifact,
    })

    const call = executeRaw.mock.calls[0] as unknown as [
      readonly string[],
      ...unknown[],
    ]
    const VECTOR_ARRAY_LITERAL_SHAPE = /^\{".*"\}$/
    const ARRAY_OF_VECTORS = /\[[0-9.,-]+\]/g
    const vectorArrayLiteral = call
      .slice(1)
      .find(
        (v): v is string =>
          typeof v === "string" &&
          VECTOR_ARRAY_LITERAL_SHAPE.test(v) &&
          v.includes("0.111"),
      )
    if (!vectorArrayLiteral) {
      throw new Error("no vector array literal in chunk INSERT bound params")
    }
    const vectors = vectorArrayLiteral.match(ARRAY_OF_VECTORS) ?? []
    expect(vectors.length).toBe(2)
    expect(vectors[0]).toContain("0.111")
    expect(vectors[0]).not.toContain("0.222")
    expect(vectors[1]).toContain("0.222")
    expect(vectors[1]).not.toContain("0.111")
  })

  it('nullable timecode columns bind via the unquoted NULL token, not the quoted string "NULL"', async () => {
    // Bulk INSERT must support chunks where startTime/endTime are
    // null/undefined. The toPgArray nullable extension emits the
    // unquoted NULL token; a regression that quoted "NULL" would
    // round-trip as the literal four-char string and break the
    // `::double precision` cast at the SELECT seam.
    const { prisma, executeRaw } = buildStubPrisma()
    const artifact = buildArtifact({ chunkCount: 1 })
    artifact.chunks[0]!.metadata.startTime = null as unknown as number
    artifact.chunks[0]!.metadata.endTime = null as unknown as number

    await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      loadedArtifact: artifact,
    })
    const call = executeRaw.mock.calls[0] as unknown as [
      readonly string[],
      ...unknown[],
    ]
    // The startSeconds and endSeconds bound params are PG text[] literals
    // with `{NULL}`. Confirm the bound NULL token is unquoted.
    const nullArrays = call
      .slice(1)
      .filter((v): v is string => typeof v === "string" && v === "{NULL}")
    expect(nullArrays.length).toBeGreaterThanOrEqual(2)
  })

  it("is idempotent across repeated invocations against the same artifact", async () => {
    const firstRun = buildStubPrisma()
    const firstResult = await indexEditionTranscript(firstRun.prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      loadedArtifact: buildArtifact({ chunkCount: 3 }),
    })

    const secondRun = buildStubPrisma()
    const secondResult = await indexEditionTranscript(secondRun.prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      loadedArtifact: buildArtifact({ chunkCount: 3 }),
    })

    expect(firstResult.chunksIndexed).toBe(3)
    expect(secondResult.chunksIndexed).toBe(3)
    expect(firstResult.chunksPruned).toBe(0)
    expect(secondResult.chunksPruned).toBe(0)
    // The bound transcriptId/chunkIndex parameter literals are stable
    // run-to-run when the parent transcript id is stable.
    const firstParentWhere = firstRun.videoTranscriptUpsert.mock.calls[0]![0]
    const secondParentWhere = secondRun.videoTranscriptUpsert.mock.calls[0]![0]
    expect((secondParentWhere as { where: unknown }).where).toEqual(
      (firstParentWhere as { where: unknown }).where,
    )
  })

  it("remaps Prisma runtime errors to TranscriptIndexError('storage_failed') without leaking the raw message", async () => {
    const vectorLiteral = `[${new Array(1536).fill(0.42).join(",")}]`
    class FakePrismaError extends Error {
      readonly code = "P2010"
      constructor(message: string) {
        super(message)
        this.name = "PrismaClientKnownRequestError"
      }
    }
    const rawMessage = `Raw query failed. Code: \`P2010\`. Message: \`ERROR: malformed vector literal ${vectorLiteral}\``

    const { prisma } = buildStubPrisma()
    ;(
      prisma.$transaction as unknown as ReturnType<typeof vi.fn>
    ).mockImplementationOnce(async () => {
      throw new FakePrismaError(rawMessage)
    })

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const thrown = await indexEditionTranscript(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        language: "en",
        user: SYSTEM,
        loadedArtifact: buildArtifact({ chunkCount: 1 }),
      }).catch((e) => e)

      expect(thrown).toBeInstanceOf(TranscriptIndexError)
      expect((thrown as { code: string }).code).toBe("storage_failed")
      expect((thrown as Error).message).not.toContain("0.42")
      expect((thrown as Error).message).not.toContain(vectorLiteral)
      expect((thrown as Error).message).toContain("P2010")
      expect(errorSpy).toHaveBeenCalledTimes(1)
      const [payload] = errorSpy.mock.calls[0]!
      const parsed = JSON.parse(String(payload))
      expect(parsed).toMatchObject({
        event: "transcript_index_storage_error",
        code: "P2010",
      })
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("propagates non-Prisma errors unchanged (only Prisma errors get remapped)", async () => {
    const { prisma } = buildStubPrisma()
    const boom = new Error("unrelated failure")
    ;(
      prisma.$transaction as unknown as ReturnType<typeof vi.fn>
    ).mockImplementationOnce(async () => {
      throw boom
    })

    const thrown = await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      loadedArtifact: buildArtifact({ chunkCount: 1 }),
    }).catch((e) => e)

    expect(thrown).toBe(boom)
  })

  it("passes the 30s timeout option to $transaction", async () => {
    const { prisma } = buildStubPrisma()
    await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      loadedArtifact: buildArtifact({ chunkCount: 1 }),
    })
    const txMock = prisma.$transaction as unknown as ReturnType<typeof vi.fn>
    expect(txMock).toHaveBeenCalledTimes(1)
    const [, opts] = txMock.mock.calls[0]!
    expect(opts).toMatchObject({ timeout: 30_000 })
  })
})
