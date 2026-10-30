import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import type { PrismaClient } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  importDigest,
  physicalCallRow,
  sharedManifestSchema,
  sharedSourceSchema,
  validatePhysicalCall,
  validateSharedSource,
  type ImportedPhysicalCall,
} from "./shared-reading-import-contract"

const artifacts = vi.hoisted(() => new Map<string, string>())
vi.mock("@/auth/mastra-ingest-bearer", () => ({
  isValidMastraRecommendationIngestBearer: (header: string | null) =>
    header === "Bearer operator",
}))
vi.mock("@/storage/s3", () => ({
  writeObject: async (key: string, value: string) => {
    artifacts.set(key, value)
    return key
  },
  readObject: async (key: string) => {
    const value = artifacts.get(key)
    if (value === undefined) throw new Error("missing private object")
    return Buffer.from(value)
  },
}))
vi.mock("./contract", () => ({
  PrecomputedRecommendationError: class extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message)
    }
  },
}))
import {
  sharedChoices,
  submitSharedReadingImport,
} from "./shared-reading-import"
const hash = "a".repeat(64)
const source = () =>
  sharedSourceSchema.parse({
    sourceVideoId: "source",
    recommendations: [
      {
        sourceVideoId: "source",
        targetVideoId: "target",
        rank: 1,
        connection: "Full precise explanation. ".repeat(40),
        watchingValue: "Full additional value. ".repeat(40),
        sourceEvidence: {
          basis: "transcript",
          passages: Array.from({ length: 5 }, (_, i) => ({
            chunkId: "subtitle-source",
            excerpt: "Original quote " + i + ". ".repeat(150),
          })),
        },
        targetEvidence: {
          basis: "metadata",
          fields: [
            {
              field: "description",
              value: "Exact untrimmed <script>metadata</script> & value",
            },
          ],
        },
      },
    ],
    fewerThanFiveReason: "Only one supported result in this fixture.",
    witnesses: [
      {
        videoId: "source",
        coreId: "source",
        slug: "source",
        metadata: {
          title: "Source",
          description: "Source description",
          keywords: [],
          bibleCitations: [],
        },
        chunks: [
          {
            id: "subtitle-source",
            transcriptId: "edition-original",
            language: "en",
            text: Array.from(
              { length: 5 },
              (_, i) => "Original quote " + i + ". ".repeat(150),
            ).join("\n"),
          },
        ],
      },
      {
        videoId: "target",
        coreId: "target",
        slug: "target",
        metadata: {
          title: "Source — distinct related chapter",
          description: "Exact untrimmed <script>metadata</script> & value",
          keywords: [],
          bibleCitations: [],
        },
        chunks: [],
      },
    ],
    provenance: { originalResult: "immutable-artifact" },
  })
const call = (): ImportedPhysicalCall => {
  const receiptJson = JSON.stringify(
    {
      origin: hash,
      requestDigest: hash,
      reserved: true,
      consumptionUnknown: false,
      status: "failed",
      modelId: "gpt-6-astra",
      usage: {
        inputTokens: 123,
        outputTokens: 4,
        cachedInputTokens: 10,
        reasoningTokens: 2,
      },
      finishedAt: "2026-10-19T00:01:00Z",
    },
    null,
    2,
  )
  return {
    origin: hash,
    sourceVideoId: "source",
    sourceVideoIds: ["source"],
    stage: "shared_read",
    status: "failed",
    modelId: "gpt-6-astra",
    requestDigest: hash,
    responseDigest: null,
    receiptDigest: createHash("sha256").update(receiptJson).digest("hex"),
    inputTokens: 123,
    outputTokens: 4,
    cachedInputTokens: 10,
    reasoningTokens: 2,
    startedAt: "2026-10-19T00:00:00Z",
    finishedAt: "2026-10-19T00:01:00Z",
    originalRunDirectory: "/immutable/run",
    originalAttemptPath: "calls/g0000-r0000/a0000",
    originalManifestDigest: hash,
    reservationDigest: hash,
    receiptJson,
  }
}
function manifest() {
  const s = source(),
    c = call()
  return sharedManifestSchema.parse({
    version: "shared-reading-v1",
    scope: "private_pilot",
    modelId: "gpt-6-astra",
    inputCutoff: "2026-10-19T00:00:00Z",
    corpusFileSha256: hash,
    corpusDigest: hash,
    referenceDigest: hash,
    eligibleVideoIds: ["source", "target"],
    sources: [
      {
        sourceVideoId: "source",
        payloadDigest: importDigest(s),
        fewerThanFiveReason: s.fewerThanFiveReason,
      },
    ],
    calls: [
      {
        origin: c.origin,
        payloadDigest: importDigest(c),
        rowDigest: importDigest(physicalCallRow(c)),
      },
    ],
    provenance: {},
  })
}
function database() {
  const generation = {
    id: "private-pilot",
    protocolVersion: 1,
    promptVersion: "shared-reading-v1",
    inputDigest: importDigest(manifest()),
    inputMode: "content_only",
    inputSnapshotMode: "preflight_failed",
    modelId: "gpt-6-astra",
    executionBackend: "codex_chatgpt_subscription",
    sourceSetDigest: importDigest(["source"]),
    inputCutoff: new Date("2026-10-19T00:00:00Z"),
    expectedSourceCount: 1,
    status: "incomplete",
    completedAt: null as Date | null,
  }
  const sourceRows: Array<{
    generationId: string
    sourceVideoId: string
    submissionDigest: string
    status: string
    acceptedCount: number
    payload: unknown
  }> = []
  const callRows: Array<
    Omit<ReturnType<typeof physicalCallRow>, "startedAt" | "finishedAt"> & {
      generationId: string
      startedAt: Date
      finishedAt: Date
    }
  > = []
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: generation.id }]),
    recommendationPrecomputedGenerationRetentionProof: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    recommendationPrecomputedGeneration: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUniqueOrThrow: vi.fn(async () => generation),
      findUnique: vi.fn(async () => generation),
      update: vi.fn(
        async ({ data }: { data: { status: string; completedAt: Date } }) => {
          generation.status = data.status
          generation.completedAt = data.completedAt
          return generation
        },
      ),
    },
    recommendationPrecomputedSource: {
      findUnique: vi.fn(async () => sourceRows[0] ?? null),
      create: vi.fn(async ({ data }: { data: (typeof sourceRows)[number] }) => {
        sourceRows.push(data)
        return data
      }),
      findMany: vi.fn(async () => sourceRows),
    },
    recommendationPrecomputedModelCall: {
      findUnique: vi.fn(async () => callRows[0] ?? null),
      create: vi.fn(async ({ data }: { data: (typeof callRows)[number] }) => {
        callRows.push(data)
        return data
      }),
      findMany: vi.fn(async () => callRows),
    },
    video: {
      findMany: vi.fn(async () =>
        source().witnesses.map((w) => ({
          id: w.videoId,
          coreId: w.coreId,
          slug: w.slug,
        })),
      ),
    },
  }
  // Partial in-memory Prisma boundary: only methods exercised by this service.
  const db = {
    ...tx,
    $transaction: async (callback: (input: typeof tx) => Promise<unknown>) =>
      callback(tx),
  } as unknown as PrismaClient
  return { db, tx, generation, sourceRows, callRows }
}
beforeEach(() => artifacts.clear())
describe("private versioned shared-reading import", () => {
  it("preserves both evidence sides, long values, all passages and private transcript provenance", () => {
    const s = source(),
      m = manifest()
    validateSharedSource(s, m)
    const saved = sharedChoices(s, m, "private/source.json")[0]
    expect(saved.reasonEnglish).toBe(s.recommendations[0].connection)
    expect(saved.sharedReading.sourceEvidence).toEqual(
      s.recommendations[0].sourceEvidence,
    )
    expect(saved.sharedReading.sourceReferences).toHaveLength(5)
    expect(saved.sharedReading.sourceReferences[0]).toEqual({
      chunkId: "subtitle-source",
      transcriptId: "edition-original",
      language: "en",
    })
    expect(saved.sharedReading.targetEvidence).toEqual(
      s.recommendations[0].targetEvidence,
    )
  })
  it("requires bearer before parsing, storage or database access", async () => {
    const { db, tx } = database()
    await expect(
      submitSharedReadingImport(db, null, null),
    ).rejects.toMatchObject({ code: "unauthorized" })
    expect(artifacts.size).toBe(0)
    expect(tx.$queryRaw).not.toHaveBeenCalled()
  })
  it("starts and replays with the backend permitted by migration0142", async () => {
    const migration = readFileSync(
      new URL(
        "../../../../prisma/migrations/0142_precomputed_subscription_attempts/migration.sql",
        import.meta.url,
      ),
      "utf8",
    )
    const allowedBackend = migration.match(
      /ADD CONSTRAINT precomputed_generation_execution_backend_check\s+CHECK \(execution_backend IS NULL OR execution_backend = '([^']+)'\)/,
    )?.[1]
    expect(allowedBackend).toBe("codex_chatgpt_subscription")
    const { db, tx, generation } = database()
    let inserted = false
    tx.recommendationPrecomputedGeneration.createMany.mockImplementation(
      async ({ data, skipDuplicates }) => {
        expect(skipDuplicates).toBe(true)
        expect(data).toHaveLength(1)
        // Exercise the real migration's accepted value at the Prisma boundary.
        // Native PostgreSQL lifecycle/concurrency coverage is a separate check.
        expect(data[0].executionBackend).toBe(allowedBackend)
        const count = inserted ? 0 : 1
        inserted = true
        return { count }
      },
    )
    const input = {
      action: "shared_reading_start",
      generationId: generation.id,
      manifest: manifest(),
    }
    await expect(
      submitSharedReadingImport(db, input, "Bearer operator"),
    ).resolves.toMatchObject({ replay: false })
    const originalArtifacts = [...artifacts.entries()]
    await expect(
      submitSharedReadingImport(db, input, "Bearer operator"),
    ).resolves.toMatchObject({ replay: true })
    expect([...artifacts.entries()]).toEqual(originalArtifacts)
    expect(generation.inputDigest).toBe(importDigest(input.manifest))
    expect(tx.recommendationPrecomputedSource.create).not.toHaveBeenCalled()
    expect(tx.recommendationPrecomputedModelCall.create).not.toHaveBeenCalled()
    generation.executionBackend = "codex_subscription"
    await expect(
      submitSharedReadingImport(db, input, "Bearer operator"),
    ).rejects.toMatchObject({ code: "conflict" })
  })
  it("commits only after all exact source and unique physical-origin commitments; replay is idempotent", async () => {
    const { db, generation, sourceRows, callRows } = database(),
      m = manifest(),
      inputDigest = importDigest(m),
      generationId = generation.id
    await submitSharedReadingImport(
      db,
      { action: "shared_reading_start", generationId, manifest: m },
      "Bearer operator",
    )
    const complete = {
      action: "shared_reading_complete",
      generationId,
      inputDigest,
    }
    await expect(
      submitSharedReadingImport(db, complete, "Bearer operator"),
    ).rejects.toMatchObject({ code: "conflict" })
    for (const action of [
      {
        action: "shared_reading_source",
        generationId,
        inputDigest,
        source: source(),
      },
      {
        action: "shared_reading_call",
        generationId,
        inputDigest,
        call: call(),
      },
    ]) {
      await submitSharedReadingImport(db, action, "Bearer operator")
      await expect(
        submitSharedReadingImport(db, action, "Bearer operator"),
      ).resolves.toMatchObject({ replay: true })
    }
    expect(sourceRows).toHaveLength(1)
    expect(callRows).toHaveLength(1)
    expect(callRows[0]).toMatchObject({
      status: "failed",
      inputTokens: 123,
      outputTokens: 4,
    })
    await expect(
      submitSharedReadingImport(db, complete, "Bearer operator"),
    ).resolves.toMatchObject({ state: "complete", scope: "private_pilot" })
    await expect(
      submitSharedReadingImport(db, complete, "Bearer operator"),
    ).resolves.toMatchObject({ replay: true })
  })
  it("keeps unknown receipt consumption unresolved and rejects byte/usage mismatches", () => {
    const c = call()
    expect(() => validatePhysicalCall(c, manifest())).not.toThrow()
    const unknownJson = c.receiptJson.replace(
      '"consumptionUnknown": false',
      '"consumptionUnknown": true',
    )
    expect(() =>
      validatePhysicalCall(
        {
          ...c,
          receiptJson: unknownJson,
          receiptDigest: createHash("sha256").update(unknownJson).digest("hex"),
        },
        manifest(),
      ),
    ).toThrow()
    expect(() =>
      validatePhysicalCall({ ...c, inputTokens: 0 }, manifest()),
    ).toThrow()
    expect(() =>
      validatePhysicalCall(
        { ...c, receiptJson: c.receiptJson + " " },
        manifest(),
      ),
    ).toThrow()
  })
  it("has order-independent wire commitments without changing original receipt bytes", () => {
    expect(importDigest({ b: 1, a: { z: 1, c: 2 } })).toBe(
      importDigest({ a: { c: 2, z: 1 }, b: 1 }),
    )
    expect(importDigest([1, 2])).not.toBe(importDigest([2, 1]))
  })
})
