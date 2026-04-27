/**
 * S3-backend tests for `readManagerArtifact` in storage/s3.ts.
 *
 * Lives in a separate file so the env-driven
 * `useManagerArtifactsS3 = Boolean(env.MANAGER_ARTIFACTS_S3_BUCKET)`
 * flag can be flipped on at module import time without affecting the
 * other s3.ts test files (which intentionally test the unset-bucket
 * shape).
 *
 * The key assertion: this helper resolves Bucket/creds from the
 * MANAGER_ARTIFACTS_S3_* env block — NOT from RAILWAY_S3_*. This
 * locks in the two-bucket separation introduced when admin moved its
 * artifact reads off the cms-storage bucket and onto manager's bucket.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { s3Send, GetObjectCommand, capturedClientConfigs } = vi.hoisted(() => ({
  s3Send: vi.fn(),
  GetObjectCommand: vi.fn().mockImplementation((input: unknown) => ({
    __command: "GetObject",
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
}))

vi.mock("@smithy/node-http-handler", () => ({
  NodeHttpHandler: StubNodeHttpHandler,
}))

// Set distinct values on each env block so the test can prove which one
// the helper read. RAILWAY_S3_* would route to "wrong-bucket" if the
// helper accidentally fell through to the primary client.
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

const { readManagerArtifact } = await import("./s3")

describe("storage — readManagerArtifact (S3 backend)", () => {
  beforeEach(() => {
    s3Send.mockReset()
    GetObjectCommand.mockClear()
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
    expect(GetObjectCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: "wrong-bucket" }),
    )
    expect(new TextDecoder().decode(result)).toBe('{"scenes":[]}')
  })

  it("constructs an S3Client with MANAGER_ARTIFACTS_S3_* endpoint, region, and credentials", async () => {
    s3Send.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array() },
    })
    await readManagerArtifact("1502", "embeddings", "json").catch(() => {})

    // The manager-artifacts client is the only S3Client this test file
    // constructs; assert against the most recent capture.
    const config = capturedClientConfigs[capturedClientConfigs.length - 1]
    expect(config?.endpoint).toBe("https://manager.example.com")
    expect(config?.region).toBe("sjc")
    expect(config?.credentials).toEqual({
      accessKeyId: "MANAGER_AKIA",
      secretAccessKey: "manager-secret",
    })
    expect(config?.requestHandler).toBeInstanceOf(StubNodeHttpHandler)
    expect((config!.requestHandler as StubNodeHttpHandler).config).toEqual({
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
})
