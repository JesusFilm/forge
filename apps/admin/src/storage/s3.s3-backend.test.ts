/**
 * S3-backend tests for storage/s3.ts.
 *
 * Runs in a separate file so the env-driven `useS3 = Boolean(env.RAILWAY_S3_BUCKET)`
 * flag can be flipped on at module import time without affecting the
 * local-fallback tests in s3.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { s3Send, PutObjectCommand, GetObjectCommand } = vi.hoisted(() => ({
  s3Send: vi.fn(),
  PutObjectCommand: vi.fn().mockImplementation((input: unknown) => ({
    __command: "PutObject",
    input,
  })),
  GetObjectCommand: vi.fn().mockImplementation((input: unknown) => ({
    __command: "GetObject",
    input,
  })),
}))

class StubS3Client {
  constructor(public readonly config: unknown) {}
  send(...args: unknown[]) {
    return s3Send(...args)
  }
}

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: StubS3Client,
  PutObjectCommand,
  GetObjectCommand,
}))

vi.mock("@smithy/node-http-handler", () => ({
  NodeHttpHandler: class {
    constructor(public readonly config: unknown) {}
  },
}))

// Set env before importing the module under test — `useS3` is computed at
// import time and cached at module scope.
process.env.RAILWAY_S3_BUCKET = "test-bucket"
process.env.RAILWAY_S3_ENDPOINT = "https://s3.example.com"
process.env.RAILWAY_S3_REGION = "auto"
process.env.RAILWAY_S3_ACCESS_KEY_ID = "AKIA_TEST"
process.env.RAILWAY_S3_SECRET_ACCESS_KEY = "secret"

const { writeObject, readObject } = await import("./s3")

describe("storage — object-key API (S3 backend)", () => {
  beforeEach(() => {
    s3Send.mockReset()
    PutObjectCommand.mockClear()
    GetObjectCommand.mockClear()
  })

  afterEach(() => {
    s3Send.mockReset()
  })

  it("writeObject issues a PutObjectCommand with the expected bucket, key, body, and content-type", async () => {
    s3Send.mockResolvedValueOnce({})

    const key = await writeObject(
      "admin-migrations/core-id-mapping.json",
      '{"ok":true}',
      "application/json",
    )

    expect(key).toBe("admin-migrations/core-id-mapping.json")
    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: "test-bucket",
      Key: "admin-migrations/core-id-mapping.json",
      Body: '{"ok":true}',
      ContentType: "application/json",
    })
    expect(s3Send).toHaveBeenCalledTimes(1)
  })

  it("readObject issues a GetObjectCommand and returns the response body as bytes", async () => {
    const bodyBytes = new TextEncoder().encode('{"rows":[]}')
    s3Send.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => bodyBytes },
    })

    const bytes = await readObject("admin-migrations/core-id-mapping.json")

    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: "test-bucket",
      Key: "admin-migrations/core-id-mapping.json",
    })
    expect(new TextDecoder().decode(bytes)).toBe('{"rows":[]}')
  })

  it("readObject throws a clear error when the response Body is missing", async () => {
    s3Send.mockResolvedValueOnce({})

    await expect(readObject("admin-migrations/empty.json")).rejects.toThrow(
      "Empty body for admin-migrations/empty.json",
    )
  })
})
