import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sendMock = vi.fn()

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  GetObjectCommand: vi
    .fn()
    .mockImplementation((input: unknown) => ({ __cmd: "GetObject", input })),
}))

vi.mock("@smithy/node-http-handler", () => ({
  NodeHttpHandler: vi.fn().mockImplementation(() => ({})),
}))

const { downloadMapping } = await import("./pull-mapping-from-prod")

describe("pull-mapping-from-prod", () => {
  let workdir: string

  beforeEach(async () => {
    sendMock.mockReset()
    workdir = await mkdtemp(join(tmpdir(), "pull-mapping-test-"))
  })

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true })
  })

  it("downloads bytes from S3 and writes them to the local-fallback path", async () => {
    const payload = Buffer.from('{"hello":"world"}', "utf8")
    sendMock.mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () => new Uint8Array(payload),
      },
      $metadata: { httpStatusCode: 200 },
    })

    const outPath = join(workdir, "mapping.json")
    const bytes = await downloadMapping({
      bucket: "test-bucket",
      key: "admin-migrations/core-id-mapping.json",
      endpoint: "https://example.com",
      region: "auto",
      outPath,
      accessKeyId: "id",
      secretAccessKey: "secret",
    })

    expect(bytes).toBe(payload.byteLength)
    const written = await readFile(outPath)
    expect(written.equals(payload)).toBe(true)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it("creates parent directories on demand", async () => {
    const payload = Buffer.from("body")
    sendMock.mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () => new Uint8Array(payload),
      },
      $metadata: { httpStatusCode: 200 },
    })

    const outPath = join(workdir, "deep", "nested", "mapping.json")
    await downloadMapping({
      bucket: "b",
      key: "k",
      endpoint: "e",
      region: "r",
      outPath,
      accessKeyId: "id",
      secretAccessKey: "secret",
    })

    const written = await readFile(outPath)
    expect(written.equals(payload)).toBe(true)
  })

  it("throws when S3 returns an empty Body", async () => {
    sendMock.mockResolvedValueOnce({
      Body: undefined,
      $metadata: { httpStatusCode: 404 },
    })

    await expect(
      downloadMapping({
        bucket: "b",
        key: "missing.json",
        endpoint: "e",
        region: "r",
        outPath: join(workdir, "out.json"),
        accessKeyId: "id",
        secretAccessKey: "secret",
      }),
    ).rejects.toThrow(/no Body/)
  })

  it("propagates S3 errors", async () => {
    sendMock.mockRejectedValueOnce(new Error("AccessDenied"))

    await expect(
      downloadMapping({
        bucket: "b",
        key: "k",
        endpoint: "e",
        region: "r",
        outPath: join(workdir, "out.json"),
        accessKeyId: "id",
        secretAccessKey: "secret",
      }),
    ).rejects.toThrow("AccessDenied")
  })
})
