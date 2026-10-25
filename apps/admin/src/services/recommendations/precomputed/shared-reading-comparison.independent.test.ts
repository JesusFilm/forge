import type { PrismaClient } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  importDigest,
  sharedManifestSchema,
  type StoredSharedChoice,
} from "./shared-reading-import-contract"

const storage = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }))
vi.mock("@/storage/s3", () => ({
  readObject: storage.read,
  writeObject: storage.write,
}))
vi.mock("@/auth/mastra-ingest-bearer", () => ({
  isValidMastraRecommendationIngestBearer: (header: string | null) =>
    header === "Bearer independent-test-key",
}))
vi.mock("../delivery-retriever", () => ({
  getSemanticDeliveryRecommendations: vi.fn(async () => []),
}))
vi.mock("../curated-fallback", () => ({
  retrieveCuratedFallback: vi.fn(async () => []),
}))
import {
  loadPrecomputedRecommendationComparison,
  submitPrecomputedRecommendation,
} from "./contract"
import { sharedImportKey } from "./shared-reading-import"

const hash = "a".repeat(64)
const reviewer = { id: "private-reviewer", role: "ADMIN" } as const
function fixture(promptVersion = "shared-reading-v1") {
  const manifest = sharedManifestSchema.parse({
    version: "shared-reading-v1",
    scope: "private_pilot",
    modelId: "gpt-6-astra",
    inputCutoff: "2026-10-19T00:00:00Z",
    corpusFileSha256: hash,
    corpusDigest: hash,
    referenceDigest: hash,
    eligibleVideoIds: [
      "canonical-source",
      "participating-source",
      ...Array.from({ length: 8 }, (_, i) => `target-${i}`),
    ],
    sources: ["canonical-source", "participating-source"].map(
      (sourceVideoId) => ({
        sourceVideoId,
        payloadDigest: hash,
        fewerThanFiveReason: null,
      }),
    ),
    calls: [{ origin: hash, payloadDigest: hash, rowDigest: hash }],
    provenance: {},
  })
  const inputDigest = importDigest(manifest)
  storage.read.mockResolvedValue(Buffer.from(JSON.stringify(manifest)))
  const payload: StoredSharedChoice[] = Array.from({ length: 8 }, (_, i) => ({
    targetVideoId: `target-${i}`,
    kind: "direct",
    rank: i + 1,
    relationship: "shared-reading",
    reasonEnglish: `Exact directional explanation ${i}`,
    addedViewingValueEnglish: `Exact added viewing value ${i}`,
    evidence: { basis: "metadata", fields: ["description"] },
    sharedReading: {
      version: "shared-reading-v1",
      sourceVideoId: "participating-source",
      corpusDigest: hash,
      sourceEvidence: {
        basis: "transcript",
        passages: [
          {
            chunkId: "private-subtitle",
            excerpt: "Exact original source text",
          },
        ],
      },
      targetEvidence: {
        basis: "metadata",
        fields: [{ field: "description", value: `Exact target metadata ${i}` }],
      },
      sourceReferences: [
        {
          chunkId: "private-subtitle",
          transcriptId: "original-edition",
          language: "en",
        },
      ],
      targetReferences: [],
      privateSourceArtifactKey: "private/source.json",
    },
  }))
  const generation = {
    id: "private-generation",
    protocolVersion: 1,
    status: "complete",
    modelId: "gpt-6-astra",
    promptVersion,
    inputDigest,
    sourceSetDigest: hash,
    expectedSourceCount: 2,
    inputCutoff: new Date("2026-10-19T00:00:00Z"),
    inputMode: "content_only",
    inputSnapshotMode: "preflight_failed",
    historicalProvenance: null,
    failureCode: null,
  }
  const source = {
    status: "complete",
    payload,
    acceptedCount: 8,
    failureCode: null,
  }
  const db = {
    recommendationPrecomputedGeneration: {
      findUnique: vi.fn(async () => generation),
    },
    recommendationPrecomputedSource: { findUnique: vi.fn(async () => source) },
    recommendationPrecomputedModelCall: {
      findMany: vi.fn(async () => [
        { inputTokens: 123, outputTokens: 4, cachedInputTokens: 10 },
        { inputTokens: null, outputTokens: null, cachedInputTokens: null },
      ]),
    },
    video: {
      findMany: vi.fn(async () =>
        payload.map((choice) => ({
          id: choice.targetVideoId,
          slug: choice.targetVideoId,
          deletedAt: null,
          restrictViewPlatforms: [],
          locales: [{ locale: "en", title: choice.targetVideoId }],
          dubs: [{ muxVideo: { playbackId: "playback" } }],
          images: [],
        })),
      ),
    },
  }
  // Deliberately read-only Prisma boundary: any unprovided query/write fails the test.
  return {
    prisma: db as unknown as PrismaClient,
    db,
    manifest,
    inputDigest,
    payload,
  }
}
const input = {
  generationId: "private-generation",
  sourceVideoId: "participating-source",
  audioLanguageSlug: "english",
  reviewer,
}

beforeEach(() => {
  vi.clearAllMocks()
  storage.write.mockRejectedValue(new Error("Review must never write"))
})
describe("independent actual private comparison contract", () => {
  it("returns verified pilot provenance, every saved card and shared usage for a noncanonical participating source", async () => {
    const f = fixture()
    const result = await loadPrecomputedRecommendationComparison(
      f.prisma,
      input,
    )
    expect(result.state).toBe("ready")
    if (result.state !== "ready") throw new Error("Expected ready comparison")
    expect(result.generation.privateImport).toEqual({
      scope: "private_pilot",
      declaredSourceCount: 2,
      eligibleTargetCount: 10,
      fewerThanFiveReason: null,
      manifestKey: sharedImportKey(input.generationId, f.inputDigest),
    })
    expect(result.experimental.map((choice) => choice.targetVideoId)).toEqual(
      f.payload.map((choice) => choice.targetVideoId),
    )
    for (const [i, choice] of result.experimental.entries())
      expect(choice).toMatchObject(f.payload[i])
    expect(result.usage).toEqual({
      callCount: 2,
      unknownUsageCallCount: 1,
      inputTokens: 123,
      outputTokens: 4,
      cachedInputTokens: 10,
    })
    expect(
      f.db.recommendationPrecomputedModelCall.findMany,
    ).toHaveBeenCalledWith({
      where: { generationId: input.generationId },
      select: {
        inputTokens: true,
        outputTokens: true,
        cachedInputTokens: true,
      },
    })
    expect(storage.read.mock.calls).toEqual([
      [sharedImportKey(input.generationId, f.inputDigest)],
    ])
    expect(storage.write).not.toHaveBeenCalled()
  })
  it("keeps legacy comparison/status behavior and does not load private-import objects", async () => {
    const f = fixture("legacy-preview-v1")
    const comparison = await loadPrecomputedRecommendationComparison(
      f.prisma,
      input,
    )
    expect(comparison.state).toBe("ready")
    if (comparison.state !== "ready")
      throw new Error("Expected ready comparison")
    expect(comparison.experimental).toHaveLength(6)
    expect(comparison.generation).not.toHaveProperty("privateImport")
    const status = await submitPrecomputedRecommendation(
      f.prisma,
      {
        action: "status",
        generationId: input.generationId,
        sourceVideoId: input.sourceVideoId,
      },
      "Bearer independent-test-key",
    )
    expect(status).toMatchObject({
      state: "complete",
      promptVersion: "legacy-preview-v1",
      source: { status: "complete", acceptedCount: 8 },
      usage: { callCount: 2, unknownUsageCallCount: 1, inputTokens: 123 },
    })
    expect(status).not.toHaveProperty("privateImport")
    expect(storage.read).not.toHaveBeenCalled()
    expect(storage.write).not.toHaveBeenCalled()
  })
  it("fails before reads for an unauthorized review and refuses a changed private manifest", async () => {
    const f = fixture()
    await expect(
      loadPrecomputedRecommendationComparison(f.prisma, {
        ...input,
        reviewer: null,
      }),
    ).rejects.toMatchObject({ code: "unauthorized" })
    expect(
      f.db.recommendationPrecomputedGeneration.findUnique,
    ).not.toHaveBeenCalled()
    expect(storage.read).not.toHaveBeenCalled()
    storage.read.mockResolvedValue(
      Buffer.from(JSON.stringify({ ...f.manifest, scope: "full_catalog" })),
    )
    await expect(
      loadPrecomputedRecommendationComparison(f.prisma, input),
    ).rejects.toMatchObject({ code: "conflict" })
    expect(f.db.video.findMany).not.toHaveBeenCalled()
    expect(storage.write).not.toHaveBeenCalled()
  })
})
