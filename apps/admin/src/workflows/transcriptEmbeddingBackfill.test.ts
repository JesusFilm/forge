import { beforeEach, describe, expect, it, vi } from "vitest"
import type { EmbeddingsResult } from "@/services/manager-artifacts.service"
import type {
  BackfillOutcome,
  BackfillTarget,
} from "./transcriptEmbeddingBackfill"

// Concurrency must be set BEFORE the workflow is imported below so the
// p-limit instance reads the override. vi.mock hoists ahead of the
// dynamic imports.
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
    ]),
  })),
}))

vi.mock("@/services/transcript-embedding.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/transcript-embedding.service")
    >()
  return {
    ...actual, // keep the real TranscriptIndexError class reachable
    indexEditionTranscript: vi.fn(async () => ({
      editionId: "edition-stub",
      language: "en",
      chunksIndexed: 3,
      embeddingsWritten: 3,
      chunksPruned: 0,
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
    })),
  }
})

// Stage 2: the workflow loads the embeddings artifact at the
// (video, edition) GROUP level (once per group, not per language).
// Default-resolve to a non-empty artifact so tests that don't care
// about the load path can ignore it. Keep `ManagerArtifactError`
// reachable so the artifact_missing classification path stays
// exercisable without re-deriving the class.
// `satisfies` (per project convention) preserves literal-narrowing on
// nested fields while still enforcing the type contract.
const STUB_ARTIFACT = {
  model: "openai/text-embedding-3-small",
  dimensions: 1536,
  chunks: [
    {
      chunkId: "stub-0",
      text: "stub chunk text",
      embedding: new Array(1536).fill(0.01) as number[],
      metadata: { tokenCount: 5, startTime: 0, endTime: 1 },
    },
  ],
  averagedEmbedding: new Array(1536).fill(0) as number[],
  metadata: {
    totalChunks: 1,
    totalTokens: 5,
    chunkingStrategy: {
      type: "segment-aware",
      maxChunkTokens: 500,
      overlapTokens: 100,
    },
    embeddingDimensions: 1536,
    generatedAt: "2026-04-22T00:00:00.000Z",
  },
} satisfies EmbeddingsResult

vi.mock("@/services/manager-artifacts.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/manager-artifacts.service")
    >()
  return {
    ...actual,
    readEmbeddingsArtifact: vi.fn(async () => STUB_ARTIFACT),
  }
})

const { prisma } = await import("@/db/client")
const { indexEditionTranscript, TranscriptIndexError } =
  await import("@/services/transcript-embedding.service")
const { ManagerArtifactError, readEmbeddingsArtifact } =
  await import("@/services/manager-artifacts.service")
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
    vi.mocked(indexEditionTranscript).mockClear()
    vi.mocked(readEmbeddingsArtifact).mockReset()
    vi.mocked(readEmbeddingsArtifact).mockResolvedValue(STUB_ARTIFACT)
  })

  it("enumerates (video, edition) pairs and indexes one transcript per target", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "es"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(2)
    expect(report.succeeded).toBe(2)
    expect(report.skipped).toBe(0)
    expect(report.failed).toBe(0)
    expect(indexEditionTranscript).toHaveBeenCalledTimes(2)
    expect(indexEditionTranscript).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        editionId: "e-a",
        videoId: "v-a",
        coreId: "core-a",
        cmsVideoId: 1,
        language: "en",
      }),
    )
    expect(indexEditionTranscript).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        editionId: "e-b",
        videoId: "v-b",
        coreId: "core-b",
        cmsVideoId: 2,
        language: "es",
      }),
    )
  })

  it("Stage 2: ONE s3.getObject per (video, edition) group across N languages (NOT per language)", async () => {
    // Five languages for a single (video, edition) group → exactly ONE
    // S3 read at the group level. R2 reuses vectors verbatim from the
    // artifact, so cutting redundant fetches is the entire point of
    // Stage 2 for R2.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-a", "e-a", "core-a", "fr"),
      row("v-a", "e-a", "core-a", "de"),
      row("v-a", "e-a", "core-a", "pt"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(5)
    expect(report.succeeded).toBe(5)
    // ONE artifact load for the whole group.
    expect(readEmbeddingsArtifact).toHaveBeenCalledTimes(1)
    // The cmsVideoId is passed to readEmbeddingsArtifact as a string.
    expect(readEmbeddingsArtifact).toHaveBeenCalledWith("1")
    // Indexer is still called per-language (5×) — but each call
    // receives the pre-loaded artifact, so the SERVICE skips its own
    // S3 read.
    expect(indexEditionTranscript).toHaveBeenCalledTimes(5)
    for (const call of vi.mocked(indexEditionTranscript).mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({ loadedArtifact: STUB_ARTIFACT }),
      )
    }
  })

  it("Stage 2: TWO groups produce TWO s3.getObject calls (one per group)", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-b", "e-b", "core-b", "en"),
      row("v-b", "e-b", "core-b", "fr"),
    ])

    await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(readEmbeddingsArtifact).toHaveBeenCalledTimes(2)
    const calledWith = vi
      .mocked(readEmbeddingsArtifact)
      .mock.calls.map((c) => c[0])
      .sort()
    expect(calledWith).toEqual(["1", "2"])
  })

  it("produces one target per (edition, language) pair for multi-language editions", async () => {
    // A single edition exposed in three languages (one primary, one
    // dubbed, one subtitled) should produce three distinct targets,
    // not one. The SQL enumeration returns one row per triple; the
    // workflow indexes each.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-a", "e-a", "core-a", "fr"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(3)
    expect(indexEditionTranscript).toHaveBeenCalledTimes(3)
    const languagesCalled = vi
      .mocked(indexEditionTranscript)
      .mock.calls.map((c) => (c[1] as { language: string }).language)
      .sort()
    expect(languagesCalled).toEqual(["en", "es", "fr"])
  })

  it("applies the coreIds filter", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: ["core-b"],
    })

    expect(report.totalTargets).toBe(1)
    expect(indexEditionTranscript).toHaveBeenCalledTimes(1)
    expect(indexEditionTranscript).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ coreId: "core-b" }),
    )
  })

  it("languages filter is a strict inclusion list — no hardcoded fallback defaults apply", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "es"),
      row("v-b", "e-b", "core-b", "en"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      languages: ["en"],
    })

    expect(report.totalTargets).toBe(1)
    expect(indexEditionTranscript).toHaveBeenCalledTimes(1)
    expect(indexEditionTranscript).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ coreId: "core-b", language: "en" }),
    )
  })

  it("applies the languages filter to narrow which targets get indexed", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "es"),
      row("v-c", "e-c", "core-a", "fr"), // same coreId as v-a
    ])

    // Mapping only knows core-a and core-b; v-c survives because
    // core-a is mapped. After the language filter, only en + es stay.
    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      languages: ["en", "es"],
    })

    expect(report.totalTargets).toBe(2)
    expect(report.languageFilter).toEqual(["en", "es"])
    expect(indexEditionTranscript).toHaveBeenCalledTimes(2)
    const calls = vi
      .mocked(indexEditionTranscript)
      .mock.calls.map((c) => (c[1] as { language: string }).language)
    expect(calls.sort()).toEqual(["en", "es"])
  })

  it("skips targets whose coreId is absent from the mapping", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-z", "e-z", "unmapped-core-z", "en"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(1)
    expect(indexEditionTranscript).toHaveBeenCalledTimes(1)
  })

  it("Stage 2: a group-level artifact_missing cascades to skipped outcomes for every language in the group", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-a", "e-a", "core-a", "fr"),
    ])
    vi.mocked(readEmbeddingsArtifact).mockRejectedValueOnce(
      new ManagerArtifactError(
        "artifact_missing",
        "embeddings artifact not found for assetId=1",
      ),
    )

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(3)
    expect(report.succeeded).toBe(0)
    expect(report.skipped).toBe(3)
    expect(report.failed).toBe(0)
    // Explicit length guard: a regression that emitted ONE group-level
    // outcome instead of cascading per-language would still satisfy the
    // skipped-status loop body, so pin it.
    expect(report.outcomes).toHaveLength(3)
    for (const outcome of report.outcomes) {
      expect(outcome.status).toBe("skipped")
      if (outcome.status === "skipped") {
        expect(outcome.reason).toBe("artifact_missing")
      }
    }
    expect(indexEditionTranscript).not.toHaveBeenCalled()
  })

  it("Stage 2: a group-level non-missing artifact error cascades to failed outcomes for every language in the group", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
    ])
    vi.mocked(readEmbeddingsArtifact).mockRejectedValueOnce(
      new ManagerArtifactError(
        "artifact_invalid",
        "embeddings artifact failed schema validation",
      ),
    )

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.failed).toBe(2)
    expect(report.skipped).toBe(0)
    expect(report.outcomes).toHaveLength(2)
    for (const outcome of report.outcomes) {
      expect(outcome.status).toBe("failed")
    }
    expect(indexEditionTranscript).not.toHaveBeenCalled()
  })

  it("converts artifact_missing errors thrown by the indexer to skipped outcomes (defense-in-depth)", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
    ])
    vi.mocked(indexEditionTranscript).mockRejectedValueOnce(
      new ManagerArtifactError(
        "artifact_missing",
        "embeddings artifact not found for assetId=1",
      ),
    )

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.succeeded).toBe(0)
    expect(report.skipped).toBe(1)
    expect(report.failed).toBe(0)
    expect(report.outcomes[0]?.status).toBe("skipped")
  })

  it("does not demote unrelated errors mentioning 'not found' to skipped", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
    ])
    vi.mocked(indexEditionTranscript).mockRejectedValueOnce(
      new Error("Record to update not found."),
    )

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(0)
  })

  it("classifies TranscriptIndexError dimension_mismatch as failed", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
    ])
    // Use the real TranscriptIndexError so a future refactor that
    // switches the workflow to branch by `instanceof` stays covered.
    vi.mocked(indexEditionTranscript).mockRejectedValueOnce(
      new TranscriptIndexError(
        "dimension_mismatch",
        "artifact reports dimensions=768",
      ),
    )

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(0)
    const outcome = report.outcomes[0]
    expect(outcome?.status).toBe("failed")
    if (outcome?.status === "failed") {
      expect(outcome.reason).toContain("dimensions=768")
    }
  })

  it("records failed outcomes but keeps processing other targets", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
    ])
    vi.mocked(indexEditionTranscript)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        editionId: "e-b",
        language: "en",
        chunksIndexed: 2,
        embeddingsWritten: 2,
        chunksPruned: 0,
        model: "openai/text-embedding-3-small",
        dimensions: 1536,
      })

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.succeeded).toBe(1)
    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(0)
  })

  it("treats coreIds: [] as omitted (runs all mapped targets)", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: [],
    })

    expect(report.totalTargets).toBe(2)
  })

  it("treats languages: [] as omitted (no filter applied)", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "fr"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      languages: [],
    })

    expect(report.totalTargets).toBe(1)
    expect(report.languageFilter).toBeNull()
  })

  it("returns an empty report when the DB has no editions", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([])
    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })
    expect(report.totalTargets).toBe(0)
    expect(report.outcomes).toEqual([])
    expect(indexEditionTranscript).not.toHaveBeenCalled()
    expect(readEmbeddingsArtifact).not.toHaveBeenCalled()
  })
})

// feat-119 PR1 — `missingArtifacts` projection. Mirror of the R1
// dedup-by-assetId / sort-ascending / failed-excluded / kind-stamp
// tests in sceneEmbeddingBackfill.test.ts. Only difference: the kind
// literal is `"transcript"`.
describe("runTranscriptEmbeddingBackfill — missingArtifacts projection", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    ;(prisma as unknown as PrismaStub).$queryRaw.mockReset()
    vi.mocked(indexEditionTranscript).mockReset()
    vi.mocked(readEmbeddingsArtifact).mockReset()
    vi.mocked(readEmbeddingsArtifact).mockResolvedValue(STUB_ARTIFACT)
    vi.mocked(indexEditionTranscript).mockResolvedValue({
      editionId: "edition-stub",
      language: "en",
      chunksIndexed: 1,
      embeddingsWritten: 1,
      chunksPruned: 0,
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
    })
  })

  it("dedupes by assetId — 3 languages of one missing group produce ONE missingArtifacts entry", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-a", "e-a", "core-a", "fr"),
    ])
    vi.mocked(readEmbeddingsArtifact).mockRejectedValueOnce(
      new ManagerArtifactError(
        "artifact_missing",
        "embeddings artifact not found for assetId=1",
      ),
    )

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.skipped).toBe(3)
    expect(report.missingArtifacts).toHaveLength(1)
    expect(report.missingArtifacts[0]).toEqual({
      assetId: 1,
      coreId: "core-a",
      kind: "transcript",
    })
  })

  it("sorts ascending by assetId — two distinct missing groups yield two entries in numeric order", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-b", "e-b", "core-b", "en"),
      row("v-a", "e-a", "core-a", "en"),
    ])
    vi.mocked(readEmbeddingsArtifact).mockRejectedValue(
      new ManagerArtifactError(
        "artifact_missing",
        "embeddings artifact not found",
      ),
    )

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.missingArtifacts.map((m) => m.assetId)).toEqual([1, 2])
    expect(report.missingArtifacts[0]?.coreId).toBe("core-a")
    expect(report.missingArtifacts[1]?.coreId).toBe("core-b")
  })

  it("returns an empty array when every target succeeds (NOT undefined)", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.succeeded).toBe(1)
    expect(report.missingArtifacts).toEqual([])
    expect(Array.isArray(report.missingArtifacts)).toBe(true)
  })

  it("excludes failed outcomes — only `skipped { artifact_missing }` enters the list", async () => {
    // assetId-keyed mock decouples this test from group invocation
    // order. See R1 sibling test for full rationale.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
    ])
    vi.mocked(readEmbeddingsArtifact).mockImplementation(
      async (assetId: string) => {
        if (assetId === "1") {
          throw new ManagerArtifactError(
            "artifact_invalid",
            "embeddings artifact failed schema validation",
          )
        }
        if (assetId === "2") {
          throw new ManagerArtifactError(
            "artifact_missing",
            "embeddings artifact not found",
          )
        }
        return STUB_ARTIFACT
      },
    )

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(1)
    expect(report.missingArtifacts).toHaveLength(1)
    expect(report.missingArtifacts[0]?.assetId).toBe(2)
    expect(report.missingArtifacts[0]?.coreId).toBe("core-b")
    expect(report.missingArtifacts[0]?.kind).toBe("transcript")
  })

  it("mixed run: one missing group + one present group → one missingArtifacts entry, succeeded > 0", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-b", "e-b", "core-b", "en"),
    ])
    vi.mocked(readEmbeddingsArtifact).mockImplementation(
      async (assetId: string) => {
        if (assetId === "2") {
          throw new ManagerArtifactError(
            "artifact_missing",
            "embeddings artifact not found",
          )
        }
        return STUB_ARTIFACT
      },
    )

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.succeeded).toBeGreaterThan(0)
    expect(report.skipped).toBeGreaterThan(0)
    expect(report.missingArtifacts).toHaveLength(1)
    expect(report.missingArtifacts[0]?.assetId).toBe(2)
    expect(report.missingArtifacts[0]?.coreId).toBe("core-b")
  })
})

describe("runTranscriptEmbeddingBackfill — bounded parallelism", () => {
  beforeEach(() => {
    // Restore any `vi.spyOn(_internals, ...)` from a prior test so
    // the next test sees the real `stepIndexEditionTranscript`.
    vi.restoreAllMocks()
    ;(prisma as unknown as PrismaStub).$queryRaw.mockReset()
    vi.mocked(indexEditionTranscript).mockReset()
    vi.mocked(readEmbeddingsArtifact).mockReset()
    vi.mocked(readEmbeddingsArtifact).mockResolvedValue(STUB_ARTIFACT)
  })

  it("isolates a per-target indexer error: errors caught inside stepIndexEditionTranscript → outcome stays `failed`, siblings continue", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
      row("v-c", "e-c", "core-a", "es"),
    ])

    const ok = (lang: string) => ({
      editionId: `e-${lang}`,
      language: lang,
      chunksIndexed: 1,
      embeddingsWritten: 1,
      chunksPruned: 0,
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
    })

    vi.mocked(indexEditionTranscript)
      .mockResolvedValueOnce(ok("en"))
      .mockRejectedValueOnce(new Error("kaboom"))
      .mockResolvedValueOnce(ok("es"))

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(3)
    expect(report.succeeded).toBe(2)
    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(0)
    expect(indexEditionTranscript).toHaveBeenCalledTimes(3)
  })

  it("uses Promise.allSettled (not Promise.all) — a step-level rejection is recorded as a synthetic failed outcome (cascaded to every language in the affected group)", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
      row("v-c", "e-c", "core-a", "es"),
    ])

    // Use the real BackfillTarget / BackfillOutcome types so a future
    // field added to BackfillOutcome.succeeded surfaces as a compile
    // error here instead of being silently absent under `as never`.
    const okOutcome = (target: BackfillTarget): BackfillOutcome => ({
      status: "succeeded",
      target,
      language: target.language,
      chunksIndexed: 1,
      embeddingsWritten: 1,
      chunksPruned: 0,
      durationMs: 5,
    })

    vi.spyOn(_internals, "stepIndexEditionTranscript").mockImplementation(
      async (target) => {
        if (target.coreId === "core-b") {
          throw new Error("step plumbing fault")
        }
        return okOutcome(target)
      },
    )

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(3)
    expect(report.succeeded).toBe(2)
    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(0)
    const failedOutcome = report.outcomes.find((o) => o.status === "failed")
    expect(failedOutcome).toBeDefined()
    if (failedOutcome?.status === "failed") {
      expect(failedOutcome.target.coreId).toBe("core-b")
      expect(failedOutcome.reason).toBe("step plumbing fault")
      expect(failedOutcome.durationMs).toBeGreaterThanOrEqual(0)
    }
  })

  it("dispatches (video, edition) groups sequentially — never more than one indexer call in-flight", async () => {
    // Post-2026-05-17 hotfix: the workflow body uses sequential
    // `for…of` over groups (was `pLimit + Promise.allSettled`).
    // See R1 sibling test for the full rationale and
    // docs/solutions/runtime-errors/useworkflow-bounded-parallelism-duplicate-step-created-20260517.md.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
      row("v-c", "e-c", "core-a", "es"),
    ])

    let inFlight = 0
    let observedMaxInFlight = 0

    vi.mocked(indexEditionTranscript).mockImplementation(
      async (_prisma, args) => {
        inFlight += 1
        observedMaxInFlight = Math.max(observedMaxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 15))
        inFlight -= 1
        return {
          editionId: args.editionId,
          language: args.language,
          chunksIndexed: 1,
          embeddingsWritten: 1,
          chunksPruned: 0,
          model: "openai/text-embedding-3-small",
          dimensions: 1536,
        }
      },
    )

    await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(observedMaxInFlight).toBe(1)
    expect(indexEditionTranscript).toHaveBeenCalledTimes(3)
  })
})

describe("runTranscriptEmbeddingBackfill — start log", () => {
  beforeEach(() => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockReset()
    vi.mocked(indexEditionTranscript).mockClear()
    vi.mocked(readEmbeddingsArtifact).mockReset()
    vi.mocked(readEmbeddingsArtifact).mockResolvedValue(STUB_ARTIFACT)
  })

  it("emits a structured start log with workflow, event, mappingGeneratedAt, totalTargets, groupCount, languageFilter", async () => {
    // Operators rely on log-grep dashboards (per CLAUDE.md operational
    // runbook). Pin the start-log shape so a future refactor can't
    // silently drop a field. `groupCount` is the Stage 2 addition that
    // surfaces the artifact-fetch fan-in.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-b", "e-b", "core-b", "en"),
    ])

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    let calls: unknown[][] = []
    try {
      await runTranscriptEmbeddingBackfill({
        mappingS3Key: "admin-migrations/core-id-mapping.json",
        languages: ["en", "es"],
      })
      // Snapshot calls BEFORE mockRestore — restore clears mock.calls.
      calls = logSpy.mock.calls
    } finally {
      logSpy.mockRestore()
    }

    const startPayload = calls
      .map((args) => {
        try {
          return JSON.parse(String(args[0]))
        } catch {
          return null
        }
      })
      .find(
        (p): p is Record<string, unknown> =>
          p != null &&
          p.event === "start" &&
          p.workflow === "transcript-embedding-backfill",
      )

    expect(startPayload).toBeDefined()
    expect(startPayload).toMatchObject({
      workflow: "transcript-embedding-backfill",
      event: "start",
      mappingGeneratedAt: "2026-04-22T00:00:00.000Z",
      totalTargets: 3,
      groupCount: 2,
      languageFilter: ["en", "es"],
    })
  })
})

describe("groupTargetsByVideoEdition", () => {
  it("groups (video, edition, language) targets by (video, edition) preserving target order", () => {
    const targets = [
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
      {
        videoId: "v-a",
        videoEditionId: "e-a",
        coreId: "core-a",
        cmsVideoId: 1,
        language: "fr",
      },
    ]
    const groups = _internals.groupTargetsByVideoEdition(targets)
    expect(groups).toHaveLength(2)
    expect(groups[0]?.cmsVideoId).toBe(1)
    expect(groups[0]?.targets.map((t) => t.language)).toEqual([
      "en",
      "es",
      "fr",
    ])
    expect(groups[1]?.cmsVideoId).toBe(2)
    expect(groups[1]?.targets.map((t) => t.language)).toEqual(["en"])
  })
})

describe("_internals.stepReport", () => {
  it("aggregates mixed outcomes correctly", () => {
    const target = {
      videoId: "v",
      videoEditionId: "e",
      coreId: "core",
      cmsVideoId: 1,
      language: "en",
    }
    const report = _internals.stepReport({
      mappingGeneratedAt: "2026-04-22T00:00:00.000Z",
      targets: 3,
      languageFilter: null,
      outcomes: [
        {
          status: "succeeded",
          target,
          language: "en",
          chunksIndexed: 3,
          embeddingsWritten: 3,
          chunksPruned: 0,
          durationMs: 100,
        },
        {
          status: "failed",
          target,
          language: "en",
          reason: "boom",
          durationMs: 50,
        },
        {
          status: "skipped",
          target,
          language: "en",
          reason: "artifact_missing",
          durationMs: 5,
        },
      ],
    })
    expect(report.succeeded).toBe(1)
    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(1)
  })
})
