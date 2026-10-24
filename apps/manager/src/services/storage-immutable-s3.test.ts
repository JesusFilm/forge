import { beforeEach, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({
  bytes: null as Buffer | null,
  requests: [] as Record<string, unknown>[],
  ambiguous: false,
}))
vi.mock("@/config/env", () => ({
  env: {
    RAILWAY_S3_BUCKET: "fixture",
    RAILWAY_S3_ACCESS_KEY_ID: "fixture",
    RAILWAY_S3_SECRET_ACCESS_KEY: "fixture",
  },
}))
vi.mock("@aws-sdk/client-s3", () => ({
  PutObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  GetObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  S3Client: class {
    async send(command: { input: Record<string, unknown> }) {
      state.requests.push(command.input)
      if (command.input.Body) {
        expect(command.input.IfNoneMatch).toBe("*")
        if (state.bytes) throw new Error("PreconditionFailed")
        state.bytes = Buffer.from(command.input.Body as Uint8Array)
        if (state.ambiguous) throw new Error("response lost")
        return {}
      }
      return {
        Body: {
          transformToByteArray: async () => state.bytes,
          transformToWebStream: () =>
            new ReadableStream({
              start(controller) {
                controller.enqueue(state.bytes)
                controller.close()
              },
            }),
        },
      }
    }
  },
}))
beforeEach(() => {
  state.bytes = null
  state.requests = []
  state.ambiguous = false
  vi.resetModules()
})
it("conditionally writes and verifies a matching retry; different bytes cannot overwrite", async () => {
  const { writeImmutableArtifact } = await import("./storage")
  const options = {
    assetId: "asset",
    artifactType: "review",
    ext: "vtt",
    body: "original",
  }
  await writeImmutableArtifact(options)
  await writeImmutableArtifact(options)
  await expect(
    writeImmutableArtifact({ ...options, body: "changed!" }),
  ).rejects.toThrow("identity conflict")
  await expect(
    writeImmutableArtifact({ ...options, body: "short" }),
  ).rejects.toThrow("byte limit")
  expect(state.bytes?.toString()).toBe("original")
})
it("verifies an ambiguous successful S3 write instead of replacing it", async () => {
  state.ambiguous = true
  const { writeImmutableArtifact } = await import("./storage")
  await expect(
    writeImmutableArtifact({
      assetId: "asset",
      artifactType: "review",
      ext: "vtt",
      body: "original",
    }),
  ).resolves.toBe("asset/review.vtt")
  expect(state.requests).toHaveLength(2)
})
