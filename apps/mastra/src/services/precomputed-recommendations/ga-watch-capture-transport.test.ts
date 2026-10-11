import { createHash } from "node:crypto"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { createAdminGaCaptureTransport } from "./ga-watch-capture-transport"

function downloadInput(directory: string, artifactBytes = 4) {
  return {
    generationId: "generation-one",
    generationInputDigest: "1".repeat(64),
    artifactSha256: "a".repeat(64),
    artifactBytes,
    directory,
  }
}

function responseWithBody(
  chunks: Uint8Array[],
  headers: Record<string, string>,
) {
  const cancel = vi.fn()
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === chunks.length) controller.close()
      else controller.enqueue(chunks[index++]!)
    },
    cancel,
  })
  return { response: new Response(body, { headers }), cancel }
}

describe("Admin GA capture transport", () => {
  it("cancels a download when its response exceeds the declared bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-capture-download-"))
    try {
      const { response, cancel } = responseWithBody(
        [new Uint8Array(5), new Uint8Array(100)],
        {
          "content-type": "application/vnd.forge.ga-capture-v1",
          "content-length": "4",
          "x-forge-artifact-sha256": "a".repeat(64),
        },
      )
      const transport = createAdminGaCaptureTransport({
        endpoint: { url: "https://admin.example.test/private", key: "test" },
        fetchImpl: vi.fn(async () => response) as typeof fetch,
      })
      await expect(
        transport.download(downloadInput(directory)),
      ).rejects.toMatchObject({
        code: "analytics_incomplete",
      })
      expect(cancel).toHaveBeenCalledOnce()
      expect(await readdir(directory)).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("cancels a download whose headers fail validation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-capture-download-"))
    try {
      const { response, cancel } = responseWithBody([new Uint8Array(4)], {
        "content-type": "application/octet-stream",
        "content-length": "4",
      })
      const transport = createAdminGaCaptureTransport({
        endpoint: { url: "https://admin.example.test/private", key: "test" },
        fetchImpl: vi.fn(async () => response) as typeof fetch,
      })
      await expect(
        transport.download(downloadInput(directory)),
      ).rejects.toMatchObject({
        code: "analytics_incomplete",
      })
      expect(cancel).toHaveBeenCalledOnce()
      expect(await readdir(directory)).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("bounds and cancels an oversized upload acknowledgement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-capture-upload-"))
    try {
      const path = join(directory, "artifact.bin")
      const bytes = Buffer.from("test")
      await writeFile(path, bytes)
      const cancel = vi.fn()
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(16_385))
          },
          cancel,
        }),
        { headers: { "content-type": "application/json" } },
      )
      const transport = createAdminGaCaptureTransport({
        endpoint: { url: "https://admin.example.test/private", key: "test" },
        fetchImpl: vi.fn(async () => response) as typeof fetch,
      })
      await expect(
        transport.upload({
          generationId: "generation-one",
          generationInputDigest: "1".repeat(64),
          path,
          artifactSha256: createHash("sha256").update(bytes).digest("hex"),
          artifactBytes: bytes.length,
        }),
      ).rejects.toMatchObject({ code: "analytics_unavailable" })
      expect(cancel).toHaveBeenCalledOnce()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
