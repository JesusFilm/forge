/**
 * S3-backend tests for `readManagerArtifact` in storage/s3.ts.
 *
 * Lives in a separate file so the env-driven
 * `useManagerArtifactsS3 = Boolean(env.MANAGER_ARTIFACTS_S3_BUCKET)`
 * flag can be flipped on at module import time without affecting the
 * other s3.ts test files (which intentionally test the unset-bucket
 * shape).
 *
 * MUST run with vitest's default `isolate: true` worker model — the
 * module-load env mutations below are visible to anything that
 * imports `./s3` from the same worker. Adding a sibling test that
 * shares this file's worker would silently inherit the env state
 * captured at our `await import("./s3")` line.
 *
 * The key assertion: this helper resolves Bucket/creds from the
 * MANAGER_ARTIFACTS_S3_* env block — NOT from RAILWAY_S3_*. This
 * locks in the two-bucket separation introduced when admin moved its
 * artifact reads off the cms-storage bucket and onto manager's bucket.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  s3Send,
  GetObjectCommand,
  ListObjectsV2Command,
  capturedClientConfigs,
} = vi.hoisted(() => ({
  s3Send: vi.fn(),
  GetObjectCommand: vi.fn().mockImplementation((input: unknown) => ({
    __command: "GetObject",
    input,
  })),
  ListObjectsV2Command: vi.fn().mockImplementation((input: unknown) => ({
    __command: "ListObjectsV2",
    input,
  })),
  capturedClientConfigs: [] as Array<Record<string, unknown>>,
}))

class StubS3Client {
  constructor(public readonly config: Record<string, unknown>) {
    capturedClientConfigs.push(config)
  }
  send(...args: unknown[]) {
    return s3Send(...args)
  }
}

class StubNodeHttpHandler {
  constructor(public readonly config: Record<string, unknown>) {}
}

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: StubS3Client,
  PutObjectCommand: vi.fn(),
  GetObjectCommand,
  ListObjectsV2Command,
}))

vi.mock("@smithy/node-http-handler", () => ({
  NodeHttpHandler: StubNodeHttpHandler,
}))

// Set distinct values on each env block so a regression that aliased
// the two clients would route to the WRONG bucket name and fail
// loudly rather than passing because both pointed at the same place.
process.env.RAILWAY_S3_BUCKET = "wrong-bucket"
process.env.RAILWAY_S3_ENDPOINT = "https://wrong.example.com"
process.env.RAILWAY_S3_REGION = "wrong-region"
process.env.RAILWAY_S3_ACCESS_KEY_ID = "WRONG_AKIA"
process.env.RAILWAY_S3_SECRET_ACCESS_KEY = "wrong-secret"

process.env.MANAGER_ARTIFACTS_S3_BUCKET = "manager-bucket"
process.env.MANAGER_ARTIFACTS_S3_ENDPOINT = "https://manager.example.com"
process.env.MANAGER_ARTIFACTS_S3_REGION = "sjc"
process.env.MANAGER_ARTIFACTS_S3_ACCESS_KEY_ID = "MANAGER_AKIA"
process.env.MANAGER_ARTIFACTS_S3_SECRET_ACCESS_KEY = "manager-secret"

const storage = await import("./s3")
const {
  readManagerArtifact,
  readArtifact,
  assertManagerArtifactsReachable,
  assertObjectStorageReachable,
} = storage

describe("storage — readManagerArtifact (S3 backend)", () => {
  beforeEach(() => {
    s3Send.mockReset()
    GetObjectCommand.mockClear()
    ListObjectsV2Command.mockClear()
    // capturedClientConfigs is intentionally NOT reset between tests —
    // the s3 module memoizes both clients at module scope, so only the
    // first test that triggers each lazy init appends a config. Tests
    // below find their target client by endpoint string match rather
    // than positional index, which is robust to test ordering and
    // future additions.
  })

  afterEach(() => {
    s3Send.mockReset()
  })

  it("issues GetObjectCommand against MANAGER_ARTIFACTS_S3_BUCKET (not RAILWAY_S3_BUCKET)", async () => {
    const bytes = new TextEncoder().encode('{"scenes":[]}')
    s3Send.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => bytes },
    })

    const result = await readManagerArtifact("1502", "scene-analysis", "json")

    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: "manager-bucket",
      Key: "1502/scene-analysis.json",
    })
    expect(new TextDecoder().decode(result)).toBe('{"scenes":[]}')
  })

  it("constructs an S3Client with MANAGER_ARTIFACTS_S3_* endpoint, region, and credentials", async () => {
    s3Send.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array() },
    })
    await readManagerArtifact("1502", "embeddings", "json").catch(() => {})

    // Find the manager-artifacts client by endpoint rather than by
    // positional index — robust to test ordering and to the cross-route
    // test below which also constructs the primary client.
    const config = capturedClientConfigs.find(
      (c) => c.endpoint === "https://manager.example.com",
    )
    if (!config) {
      throw new Error(
        "expected the manager-artifacts S3Client to have been constructed by this point",
      )
    }
    expect(config.region).toBe("sjc")
    expect(config.credentials).toEqual({
      accessKeyId: "MANAGER_AKIA",
      secretAccessKey: "manager-secret",
    })
    if (!(config.requestHandler instanceof StubNodeHttpHandler)) {
      throw new Error("expected requestHandler to be a StubNodeHttpHandler")
    }
    expect(config.requestHandler.config).toEqual({
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
    })
  })

  it("throws a clear error when the response Body is missing", async () => {
    s3Send.mockResolvedValueOnce({})

    await expect(
      readManagerArtifact("1502", "scene-analysis", "json"),
    ).rejects.toThrow("Empty body for 1502/scene-analysis.json")
  })

  it("readArtifact and readManagerArtifact route to different buckets when both env blocks are set", async () => {
    // Cross-route lock-in: prove the two helpers don't accidentally
    // alias to the same bucket. A regression that pointed both at
    // RAILWAY_S3_BUCKET (the original bug this PR fixes) would land
    // both calls on Bucket: "wrong-bucket" and fail this test loudly.
    const bytes = new TextEncoder().encode("{}")
    s3Send.mockResolvedValue({
      Body: { transformToByteArray: async () => bytes },
    })

    await readManagerArtifact("1502", "scene-analysis", "json")
    await readArtifact("1502", "scene-analysis", "json")

    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: "manager-bucket",
      Key: "1502/scene-analysis.json",
    })
    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: "wrong-bucket",
      Key: "1502/scene-analysis.json",
    })
  })

  it("does not export getManagerArtifactsS3 or _s3ManagerArtifacts (read-only-by-omission contract)", () => {
    // The "read-only" guarantee on manager's bucket is enforced by code
    // surface only — Railway buckets don't expose separate read-only
    // IAM. If a future PR exports the S3 client factory or the
    // singleton, callers could send PutObjectCommand directly. Lock the
    // surface here.
    const exports = storage as Record<string, unknown>
    expect("readManagerArtifact" in exports).toBe(true)
    expect("assertManagerArtifactsReachable" in exports).toBe(true)
    expect("getManagerArtifactsS3" in exports).toBe(false)
    expect("_s3ManagerArtifacts" in exports).toBe(false)
    expect("writeManagerArtifact" in exports).toBe(false)
  })

  it("throws a clear error when MANAGER_ARTIFACTS_S3_BUCKET is set but credentials are unset", async () => {
    // Misconfiguration scenario: bucket env wired, but creds typo'd or
    // forgotten. The s3 module's lazy-init must reject before any S3
    // request, with a message that names BOTH missing vars.
    //
    // We mutate creds in-place, then force a fresh module instance so
    // useManagerArtifactsS3 + the lazy singleton observe the new state.
    vi.resetModules()
    delete process.env.MANAGER_ARTIFACTS_S3_ACCESS_KEY_ID
    delete process.env.MANAGER_ARTIFACTS_S3_SECRET_ACCESS_KEY
    try {
      const fresh = await import("./s3")
      await expect(
        fresh.readManagerArtifact("1502", "scene-analysis", "json"),
      ).rejects.toThrow(
        /MANAGER_ARTIFACTS_S3_ACCESS_KEY_ID and MANAGER_ARTIFACTS_S3_SECRET_ACCESS_KEY are required/,
      )
    } finally {
      // Restore for any later tests in the same worker (currently none,
      // but defensive against future additions).
      process.env.MANAGER_ARTIFACTS_S3_ACCESS_KEY_ID = "MANAGER_AKIA"
      process.env.MANAGER_ARTIFACTS_S3_SECRET_ACCESS_KEY = "manager-secret"
      vi.resetModules()
    }
  })

  it("probes manager artifact bucket reachability with MANAGER_ARTIFACTS_S3_BUCKET", async () => {
    s3Send.mockResolvedValueOnce({})

    await assertManagerArtifactsReachable()

    expect(ListObjectsV2Command).toHaveBeenCalledTimes(1)
    expect(ListObjectsV2Command).toHaveBeenCalledWith({
      Bucket: "manager-bucket",
      MaxKeys: 1,
    })
    expect(s3Send).toHaveBeenCalledTimes(1)
  })

  it("probes admin object bucket reachability with RAILWAY_S3_BUCKET", async () => {
    s3Send.mockResolvedValueOnce({})

    await assertObjectStorageReachable()

    expect(ListObjectsV2Command).toHaveBeenCalledTimes(1)
    expect(ListObjectsV2Command).toHaveBeenCalledWith({
      Bucket: "wrong-bucket",
      MaxKeys: 1,
    })
    expect(s3Send).toHaveBeenCalledTimes(1)
  })

  it("propagates manager artifact bucket reachability failures", async () => {
    s3Send.mockRejectedValueOnce(new Error("network down"))

    await expect(assertManagerArtifactsReachable()).rejects.toThrow(
      "network down",
    )
    expect(ListObjectsV2Command).toHaveBeenCalledTimes(1)
    expect(s3Send).toHaveBeenCalledTimes(1)
  })
})
