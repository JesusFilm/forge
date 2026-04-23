import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import * as s3 from "@/storage/s3"
import {
  ManagerArtifactError,
  readEmbeddingsArtifact,
  readSceneAnalysisArtifact,
  type EmbeddingsResult,
  type SceneAnalysisResult,
} from "./manager-artifacts.service"

// The storage module picks its backend at import time based on
// env.RAILWAY_S3_BUCKET. These tests rely on the local fallback, which
// activates when that env var is unset. `pnpm --filter @forge/admin
// test` runs without Doppler, so the fallback is the default.
const LOCAL_DIR = join(process.cwd(), ".tmp", "artifacts")

async function seedArtifact(assetId: string, body: unknown) {
  const dir = join(LOCAL_DIR, assetId)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, "scene-analysis.json"),
    typeof body === "string" ? body : JSON.stringify(body),
  )
}

async function removeArtifact(assetId: string) {
  await rm(join(LOCAL_DIR, assetId), { recursive: true, force: true })
}

const SEEDED_IDS = [
  "test-asset-valid",
  "test-asset-empty",
  "test-asset-bad-json",
]

const validArtifact: SceneAnalysisResult = {
  scenes: [
    {
      sceneIndex: 0,
      startSeconds: 0,
      endSeconds: 12.5,
      chapterTitle: "Opening",
      description: "A wide shot of a dusty road.",
      themes: ["journey"],
      bibleVerses: [],
      demographics: ["adult"],
      spiritualContext: ["beginnings"],
    },
    {
      sceneIndex: 1,
      startSeconds: 12.5,
      endSeconds: null,
      chapterTitle: null,
      description: "Two figures meet at the crossroads.",
      themes: ["encounter", "providence"],
      bibleVerses: ["Genesis 24:17"],
      demographics: [],
      spiritualContext: [],
    },
  ],
  totalInputTokens: 1234,
  totalOutputTokens: 567,
}

describe("readSceneAnalysisArtifact", () => {
  beforeAll(async () => {
    await seedArtifact("test-asset-valid", validArtifact)
    await seedArtifact("test-asset-empty", { scenes: [] })
    await seedArtifact("test-asset-bad-json", "not-json-at-all")
  })

  afterAll(async () => {
    await Promise.all(SEEDED_IDS.map(removeArtifact))
  })

  it("returns the parsed result for a well-formed artifact", async () => {
    const result = await readSceneAnalysisArtifact("test-asset-valid")
    expect(result.scenes).toHaveLength(2)
    expect(result.scenes[0]?.description).toBe("A wide shot of a dusty road.")
    expect(result.scenes[1]?.endSeconds).toBeNull()
  })

  it("returns an empty scenes array without error when scenes is empty", async () => {
    const result = await readSceneAnalysisArtifact("test-asset-empty")
    expect(result.scenes).toEqual([])
  })

  it("throws artifact_missing when the artifact does not exist", async () => {
    await expect(
      readSceneAnalysisArtifact("never-written-id"),
    ).rejects.toMatchObject({
      name: "ManagerArtifactError",
      code: "artifact_missing",
    })
  })

  it("throws artifact_invalid when the file is not valid JSON", async () => {
    await expect(
      readSceneAnalysisArtifact("test-asset-bad-json"),
    ).rejects.toMatchObject({
      name: "ManagerArtifactError",
      code: "artifact_invalid",
    })
  })

  it("throws artifact_invalid when the payload fails the schema", async () => {
    const assetId = "test-asset-wrong-shape"
    await seedArtifact(assetId, { scenes: [{ sceneIndex: "nope" }] })
    try {
      await expect(readSceneAnalysisArtifact(assetId)).rejects.toBeInstanceOf(
        ManagerArtifactError,
      )
      await expect(readSceneAnalysisArtifact(assetId)).rejects.toMatchObject({
        code: "artifact_invalid",
      })
    } finally {
      await removeArtifact(assetId)
    }
  })
})

const validEmbeddingsArtifact: EmbeddingsResult = {
  model: "openai/text-embedding-3-small",
  dimensions: 1536,
  chunks: [
    {
      chunkId: "chunk-0",
      text: "In the beginning, God created the heavens and the earth.",
      embedding: new Array(1536).fill(0.01),
      metadata: {
        tokenCount: 12,
        startTime: 0,
        endTime: 4.2,
      },
    },
    {
      chunkId: "chunk-1",
      text: "And the Spirit of God moved upon the face of the waters.",
      embedding: new Array(1536).fill(-0.02),
      metadata: {
        tokenCount: 11,
      },
    },
  ],
  averagedEmbedding: new Array(1536).fill(0),
  metadata: {
    totalChunks: 2,
    totalTokens: 23,
    chunkingStrategy: {
      type: "segment-aware",
      maxChunkTokens: 500,
      overlapTokens: 100,
    },
    embeddingDimensions: 1536,
    generatedAt: "2026-04-10T00:00:00.000Z",
  },
}

function stubArtifactBytes(body: unknown): Uint8Array {
  const str = typeof body === "string" ? body : JSON.stringify(body)
  return new TextEncoder().encode(str)
}

describe("readEmbeddingsArtifact", () => {
  // Spy on readArtifact so these tests don't rely on the shared
  // `.tmp/artifacts/` directory (which `src/storage/s3.test.ts`
  // wipes in its own afterEach, racing with any file-based fixture).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let readArtifactSpy: any

  beforeEach(() => {
    readArtifactSpy = vi.spyOn(s3, "readArtifact")
  })

  afterEach(() => {
    readArtifactSpy.mockRestore()
  })

  it("returns the parsed result for a well-formed artifact", async () => {
    readArtifactSpy.mockResolvedValueOnce(
      stubArtifactBytes(validEmbeddingsArtifact),
    )
    const result = await readEmbeddingsArtifact("1")
    expect(result.model).toBe("openai/text-embedding-3-small")
    expect(result.dimensions).toBe(1536)
    expect(result.chunks).toHaveLength(2)
    expect(result.chunks[0]?.chunkId).toBe("chunk-0")
    expect(result.chunks[0]?.embedding).toHaveLength(1536)
    expect(result.metadata.chunkingStrategy.type).toBe("segment-aware")
    // Confirms the reader asked for the right artifact key tuple.
    expect(readArtifactSpy).toHaveBeenCalledWith("1", "embeddings", "json")
  })

  it("returns an empty chunks array without error", async () => {
    readArtifactSpy.mockResolvedValueOnce(
      stubArtifactBytes({
        ...validEmbeddingsArtifact,
        chunks: [],
        metadata: {
          ...validEmbeddingsArtifact.metadata,
          totalChunks: 0,
          totalTokens: 0,
        },
      }),
    )
    const result = await readEmbeddingsArtifact("1")
    expect(result.chunks).toEqual([])
  })

  it("tolerates unknown top-level fields (passthrough)", async () => {
    readArtifactSpy.mockResolvedValueOnce(
      stubArtifactBytes({
        ...validEmbeddingsArtifact,
        artifactKeys: ["embeddings"],
        metadataEmbedding: {
          text: "Title: Genesis",
          embedding: new Array(1536).fill(0),
          fieldsUsed: ["title"],
        },
      }),
    )
    const result = await readEmbeddingsArtifact("1")
    expect(result.chunks).toHaveLength(2)
  })

  it("throws artifact_missing when the underlying storage reports NoSuchKey", async () => {
    readArtifactSpy.mockRejectedValueOnce(
      new Error("NoSuchKey: object not found"),
    )
    await expect(readEmbeddingsArtifact("1")).rejects.toMatchObject({
      name: "ManagerArtifactError",
      code: "artifact_missing",
    })
  })

  it("throws artifact_missing on ENOENT (local fallback)", async () => {
    readArtifactSpy.mockRejectedValueOnce(
      new Error("ENOENT: no such file or directory"),
    )
    await expect(readEmbeddingsArtifact("1")).rejects.toMatchObject({
      code: "artifact_missing",
    })
  })

  it("throws artifact_read_failed on transport errors that aren't missing-key", async () => {
    readArtifactSpy.mockRejectedValueOnce(
      new Error("AccessDenied: 403 from s3"),
    )
    await expect(readEmbeddingsArtifact("1")).rejects.toMatchObject({
      code: "artifact_read_failed",
    })
  })

  it("throws artifact_invalid when the file is not valid JSON", async () => {
    readArtifactSpy.mockResolvedValueOnce(stubArtifactBytes("not-json-at-all"))
    await expect(readEmbeddingsArtifact("1")).rejects.toMatchObject({
      name: "ManagerArtifactError",
      code: "artifact_invalid",
    })
  })

  it("throws artifact_invalid when a chunk is missing embedding", async () => {
    readArtifactSpy.mockResolvedValueOnce(
      stubArtifactBytes({
        ...validEmbeddingsArtifact,
        chunks: [
          {
            chunkId: "chunk-0",
            text: "has no embedding field",
            metadata: { tokenCount: 4 },
          },
        ],
      }),
    )
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await expect(readEmbeddingsArtifact("1")).rejects.toMatchObject({
        code: "artifact_invalid",
      })
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("throws artifact_invalid when dimensions is missing", async () => {
    const withoutDimensions: Partial<EmbeddingsResult> = {
      ...validEmbeddingsArtifact,
    }
    delete (withoutDimensions as Record<string, unknown>).dimensions
    readArtifactSpy.mockResolvedValueOnce(stubArtifactBytes(withoutDimensions))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await expect(readEmbeddingsArtifact("1")).rejects.toMatchObject({
        code: "artifact_invalid",
      })
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("throws artifact_invalid when a chunk has an unknown strict key", async () => {
    readArtifactSpy.mockResolvedValueOnce(
      stubArtifactBytes({
        ...validEmbeddingsArtifact,
        chunks: [
          {
            chunkId: "chunk-0",
            text: "hello",
            embedding: new Array(1536).fill(0),
            metadata: { tokenCount: 1 },
            unexpectedField: true,
          },
        ],
      }),
    )
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await expect(readEmbeddingsArtifact("1")).rejects.toMatchObject({
        code: "artifact_invalid",
      })
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("does not echo the raw artifact content in the thrown error message", async () => {
    const secret = "SENSITIVE_USER_CONTENT_MARKER_9f8e7d"
    readArtifactSpy.mockResolvedValue(
      stubArtifactBytes({
        ...validEmbeddingsArtifact,
        chunks: [
          {
            chunkId: "chunk-0",
            text: secret,
            // malformed embedding shape — triggers schema validation
            embedding: "not-an-array",
            metadata: { tokenCount: 1 },
          },
        ],
      }),
    )
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const error = await readEmbeddingsArtifact("1").catch((e) => e)
      expect((error as Error).message).not.toContain(secret)
      expect((error as { code: string }).code).toBe("artifact_invalid")
    } finally {
      errorSpy.mockRestore()
    }
  })
})
