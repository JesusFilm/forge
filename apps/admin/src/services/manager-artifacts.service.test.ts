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
  type MockInstance,
} from "vitest"
import * as s3 from "@/storage/s3"
import {
  ManagerArtifactError,
  readEmbeddingsArtifact,
  readSceneAnalysisArtifact,
  readTranscriptSourceArtifact,
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

describe("readTranscriptSourceArtifact", () => {
  let readArtifactSpy: MockInstance<typeof s3.readManagerArtifact>

  beforeEach(() => {
    readArtifactSpy = vi.spyOn(s3, "readManagerArtifact")
  })

  afterEach(() => {
    readArtifactSpy.mockRestore()
  })

  it("returns transcript text and timed segments from transcript.json", async () => {
    readArtifactSpy.mockResolvedValueOnce(
      stubArtifactBytes({
        text: "hello transcript",
        segments: [{ start: 0, end: 2, text: "hello transcript" }],
        language: "en",
        resolvedProvider: "mux",
        routingReport: { attempts: [] },
      }),
    )

    const result = await readTranscriptSourceArtifact("42")

    expect(result).toMatchObject({
      text: "hello transcript",
      language: "en",
      resolvedProvider: "mux",
      segments: [{ start: 0, end: 2, text: "hello transcript" }],
    })
    expect(readArtifactSpy).toHaveBeenCalledWith("42", "transcript", "json")
  })

  it("throws artifact_missing when transcript.json is absent", async () => {
    readArtifactSpy.mockRejectedValueOnce(
      Object.assign(new Error("The specified key does not exist."), {
        name: "NoSuchKey",
      }),
    )

    await expect(readTranscriptSourceArtifact("42")).rejects.toMatchObject({
      name: "ManagerArtifactError",
      code: "artifact_missing",
    })
  })

  it("throws artifact_invalid without echoing transcript text for malformed shape", async () => {
    const secret = "SENSITIVE_TRANSCRIPT_MARKER"
    readArtifactSpy.mockResolvedValueOnce(
      stubArtifactBytes({
        text: secret,
        segments: [{ start: "bad", end: 2, text: secret }],
        language: "en",
      }),
    )
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const error = await readTranscriptSourceArtifact("42").catch((e) => e)
      expect((error as Error).message).not.toContain(secret)
      expect((error as { code: string }).code).toBe("artifact_invalid")
    } finally {
      errorSpy.mockRestore()
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
  // Spy on readManagerArtifact so these tests don't rely on the
  // shared `.tmp/artifacts/` directory (which `src/storage/s3.test.ts`
  // wipes in its own afterEach, racing with any file-based fixture).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let readArtifactSpy: any

  beforeEach(() => {
    readArtifactSpy = vi.spyOn(s3, "readManagerArtifact")
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

  // Updated to throw the REAL AWS SDK v3 error shape (`name: "NoSuchKey"`)
  // — generic `new Error("NoSuchKey: ...")` would pass via the regex
  // backstop while leaving the typed branch untested. See
  // docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md.
  it("throws artifact_missing when the underlying storage reports NoSuchKey", async () => {
    readArtifactSpy.mockRejectedValueOnce(
      Object.assign(new Error("The specified key does not exist."), {
        name: "NoSuchKey",
      }),
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

  // Misclassification guard. The S3 production fail-fast in
  // `src/storage/s3.ts::assertManagerArtifactsConfiguredForProduction`
  // throws "MANAGER_ARTIFACTS_S3_BUCKET is not set ..." synchronously
  // inside the async readManagerArtifact. The classifier regex in
  // readEmbeddingsArtifact / readSceneAnalysisArtifact
  // (`/not found|missing|no such key|ENOENT|NoSuchKey/i`) must NOT
  // match this string — otherwise a misconfigured prod deploy would
  // silently classify every target as `artifact_missing` (skipped),
  // hiding the config error as "manager hasn't produced this yet."
  // Lock in the classifier behavior against that exact message.
  it("classifies the prod-guard error string as artifact_read_failed (not artifact_missing)", async () => {
    readArtifactSpy.mockRejectedValueOnce(
      new Error(
        "MANAGER_ARTIFACTS_S3_BUCKET is not set — admin cannot read manager artifacts via local fallback in production",
      ),
    )
    const error = await readEmbeddingsArtifact("1").catch((e) => e)
    expect((error as { code: string }).code).toBe("artifact_read_failed")
  })

  it("classifies the missing-credentials error string as artifact_read_failed (not artifact_missing)", async () => {
    readArtifactSpy.mockRejectedValueOnce(
      new Error(
        "MANAGER_ARTIFACTS_S3_ACCESS_KEY_ID and MANAGER_ARTIFACTS_S3_SECRET_ACCESS_KEY are required when MANAGER_ARTIFACTS_S3_BUCKET is set",
      ),
    )
    const error = await readEmbeddingsArtifact("1").catch((e) => e)
    expect((error as { code: string }).code).toBe("artifact_read_failed")
  })
})

// -----------------------------------------------------------------------------
// Classifier coverage — exercises `isArtifactMissing` against the full set of
// error shapes that can reach the readSceneAnalysisArtifact / readEmbeddingsArtifact
// catch blocks in production. Tests use the spy pattern (NOT file fixtures) so
// each test injects an EXACT error shape — including the typed AWS SDK v3
// shapes that the regex-only classifier would have missed.
//
// Per docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md:
// these tests must throw the REAL typed shape, not generic `new Error("NoSuchKey: ...")`.
// -----------------------------------------------------------------------------

type ClassifierCase = {
  readonly label: string
  readonly factory: () => unknown
  readonly expectedCode:
    | "artifact_missing"
    | "artifact_invalid"
    | "artifact_read_failed"
}

const CLASSIFIER_CASES: readonly ClassifierCase[] = [
  {
    label: "AWS SDK v3 typed GET miss (name: 'NoSuchKey')",
    factory: () =>
      Object.assign(new Error("The specified key does not exist."), {
        name: "NoSuchKey",
      }),
    expectedCode: "artifact_missing",
  },
  {
    label:
      "AWS SDK v3 typed GET miss with regex-incompatible message — proves Tier 1 (typed name) fires INDEPENDENTLY of the regex backstop",
    // The default AWS textual rendering matches `does not exist` in the
    // regex backstop — so a regression that deletes the typed-name
    // branch entirely would still pass the case above. This case uses
    // a message that the regex CANNOT match, so the test fails iff the
    // typed branch is broken. See the testing-1 finding from PR1
    // /ce:review for the trap.
    factory: () =>
      Object.assign(new Error("Server returned HTTP 500"), {
        name: "NoSuchKey",
      }),
    expectedCode: "artifact_missing",
  },
  {
    label: "AWS SDK v3 typed HEAD miss (name: 'NotFound')",
    factory: () => Object.assign(new Error("Not Found"), { name: "NotFound" }),
    expectedCode: "artifact_missing",
  },
  {
    label:
      "AWS SDK v3 typed HEAD miss with regex-incompatible message — Tier 1 independence",
    factory: () => Object.assign(new Error("HTTP 404"), { name: "NotFound" }),
    expectedCode: "artifact_missing",
  },
  {
    label: "Legacy AWS Code-shape (Code: 'NoSuchKey')",
    // Some older AWS SDK paths and some S3-compatible providers
    // surface the error code on `Code` rather than `name`. Keep the
    // legacy branch covered until we're confident no producer in
    // our stack emits this. Note the message here is regex-
    // incompatible — proves Tier 2 fires independently.
    factory: () =>
      Object.assign(new Error("Some legacy SDK message"), {
        Code: "NoSuchKey",
      }),
    expectedCode: "artifact_missing",
  },
  {
    label:
      "Local fallback ENOENT (Node fs error, classified via regex backstop)",
    factory: () =>
      Object.assign(new Error("ENOENT: no such file or directory"), {
        code: "ENOENT",
      }),
    expectedCode: "artifact_missing",
  },
  {
    label:
      "Plain Error with 'does not exist' (no typed shape) — regex backstop fires",
    // An untyped error from a hypothetical alt-storage backend emitting
    // S3-textual phrasing without `name`/`Code` should still classify
    // as missing via the regex backstop. Proves Tier 3 fires when
    // Tier 1 and Tier 2 don't.
    factory: () => new Error("object 'foo' does not exist at key /bar"),
    expectedCode: "artifact_missing",
  },
  {
    label: "Unrelated transport error — connection reset",
    factory: () => new Error("connection reset by peer"),
    expectedCode: "artifact_read_failed",
  },
  {
    label:
      "Unrelated error mentioning 'missing field' must NOT mis-classify (dropped 'missing' token)",
    // Tightness probe: a bug message that uses the bare word "missing"
    // (e.g., "missing field 'foo'") is unrelated to artifact-presence.
    // The legacy regex `/missing/i` matched this — meaning a real bug
    // got silently demoted to `skipped { artifact_missing }`. The
    // tightened regex drops the bare `missing` token, so this case
    // correctly classifies as `artifact_read_failed` and surfaces in
    // the report as a real failure for the operator to investigate.
    factory: () => new Error("missing field 'foo' in api response"),
    expectedCode: "artifact_read_failed",
  },
  {
    label:
      "Plain Error with bare 'no such key' (no typed shape, dropped regex token) — must NOT mis-classify",
    // Regression-pin: the legacy regex matched `no such key` (lowercase
    // bare phrase). The typed branches above cover AWS SDK verbatim,
    // so this token was dropped from the regex. A non-typed-shape
    // emitter that says "no such key" in its message is no longer
    // demoted to skipped — it surfaces as a real failure. If a future
    // alt-storage backend emerges that emits this phrasing without a
    // typed `name`/`Code`, this test will fail and we'll re-evaluate.
    factory: () => new Error("s3-compatible: no such key in bucket"),
    expectedCode: "artifact_read_failed",
  },
] as const

describe("isArtifactMissing classifier (R1: readSceneAnalysisArtifact)", () => {
  let readArtifactSpy: MockInstance<typeof s3.readManagerArtifact>

  beforeEach(() => {
    readArtifactSpy = vi.spyOn(s3, "readManagerArtifact")
  })

  afterEach(() => {
    readArtifactSpy.mockRestore()
  })

  for (const c of CLASSIFIER_CASES) {
    it(`classifies ${c.label} as ${c.expectedCode}`, async () => {
      readArtifactSpy.mockRejectedValueOnce(c.factory())
      const error = await readSceneAnalysisArtifact("1").catch((e) => e)
      expect(error).toBeInstanceOf(ManagerArtifactError)
      expect((error as ManagerArtifactError).code).toBe(c.expectedCode)
    })
  }
})

describe("isArtifactMissing classifier (R2: readEmbeddingsArtifact)", () => {
  let readArtifactSpy: MockInstance<typeof s3.readManagerArtifact>

  beforeEach(() => {
    readArtifactSpy = vi.spyOn(s3, "readManagerArtifact")
  })

  afterEach(() => {
    readArtifactSpy.mockRestore()
  })

  for (const c of CLASSIFIER_CASES) {
    it(`classifies ${c.label} as ${c.expectedCode}`, async () => {
      readArtifactSpy.mockRejectedValueOnce(c.factory())
      const error = await readEmbeddingsArtifact("1").catch((e) => e)
      expect(error).toBeInstanceOf(ManagerArtifactError)
      expect((error as ManagerArtifactError).code).toBe(c.expectedCode)
    })
  }
})
