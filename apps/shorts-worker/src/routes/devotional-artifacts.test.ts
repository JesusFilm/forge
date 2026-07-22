import type { IncomingMessage } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { afterEach, describe, expect, it } from "vitest"
import {
  DEVOTIONAL_INPUT_ARTIFACT_TYPE,
  DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
} from "../devotional-render.js"
import { createHandleRequest } from "../server.js"
import { createStorage } from "../storage.js"

class TestResponse extends Writable {
  statusCode = 200
  headers: Record<string, string> = {}
  body = Buffer.alloc(0)

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: () => void,
  ): void {
    this.body = Buffer.concat([this.body, Buffer.from(chunk)])
    callback()
  }

  writeHead(statusCode: number, headers: Record<string, string>): this {
    this.statusCode = statusCode
    this.headers = headers
    return this
  }
}

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  )
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "devotional-artifacts-route-"))
  roots.push(root)
  const storage = createStorage({ localRootDir: root })
  const handler = createHandleRequest({
    artifactStorage: storage,
    auth: { apiKeysCsv: "test-key", nodeEnv: "production" },
  })
  return { storage, handler }
}

async function dispatch(
  handler: ReturnType<typeof createHandleRequest>,
  options: {
    method: string
    url: string
    body?: Buffer | string
    headers?: Record<string, string>
  },
) {
  const request = Object.assign(
    Readable.from(options.body == null ? [] : [Buffer.from(options.body)]),
    {
      method: options.method,
      url: options.url,
      headers: options.headers ?? {},
    },
  ) as unknown as IncomingMessage
  const response = new TestResponse()
  await handler(request, response as never)
  return response
}

const validInput = {
  schemaVersion: "1",
  headerDate: "Monday · July 21",
  media: {
    mediaId: "1_jf-0-0",
    clipStartSec: 10,
    clipLengthSec: 15,
  },
  cards: [
    { kind: "cover", title: "Come and see", narrationId: "cover" },
    { kind: "video" },
  ],
}

describe("devotional artifact upload", () => {
  it("requires auth and validates the JSON input before persisting", async () => {
    const { storage, handler } = await setup()
    const path = `/devotional-inputs/run-1/${DEVOTIONAL_INPUT_ARTIFACT_TYPE}.json`
    const unauthorized = await dispatch(handler, {
      method: "PUT",
      url: path,
      body: JSON.stringify(validInput),
      headers: { "content-type": "application/json" },
    })
    expect(unauthorized.statusCode).toBe(401)

    const invalid = await dispatch(handler, {
      method: "PUT",
      url: path,
      body: JSON.stringify({ ...validInput, media: { mediaId: "../bad" } }),
      headers: {
        authorization: "Bearer test-key",
        "content-type": "application/json",
      },
    })
    expect(invalid.statusCode).toBe(400)

    const accepted = await dispatch(handler, {
      method: "PUT",
      url: path,
      body: JSON.stringify(validInput),
      headers: {
        authorization: "Bearer test-key",
        "content-type": "application/json",
      },
    })
    expect(accepted.statusCode).toBe(201)
    await expect(
      storage.artifactExists("run-1", DEVOTIONAL_INPUT_ARTIFACT_TYPE, "json"),
    ).resolves.toBe(true)
  })

  it("rejects traversal, unapproved artifact types, and oversized bodies", async () => {
    const { handler } = await setup()
    const headers = {
      authorization: "Bearer test-key",
      "content-type": "audio/mpeg",
    }
    for (const url of [
      "/devotional-inputs/%2e%2e/devotional-music-v1.mp3",
      "/devotional-inputs/run-1/%2e%2e.mp3",
      "/devotional-inputs/run-1/shorts-clip-v1.mp4",
    ]) {
      const response = await dispatch(handler, {
        method: "PUT",
        url,
        body: "x",
        headers,
      })
      expect([400, 404]).toContain(response.statusCode)
    }
    const oversized = await dispatch(handler, {
      method: "PUT",
      url: "/devotional-inputs/run-1/devotional-narration-cover-v1.mp3",
      body: "x",
      headers: { ...headers, "content-length": String(26 * 1024 * 1024) },
    })
    expect(oversized.statusCode).toBe(413)
  })
})

describe("devotional artifact streaming", () => {
  it("streams only authenticated portrait/wide outputs", async () => {
    const { storage, handler } = await setup()
    await storage.writeArtifact({
      assetId: "output-1",
      artifactType: DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
      ext: "mp4",
      body: Buffer.from("video-bytes"),
    })
    const path = `/artifacts/output-1/${DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE}.mp4`
    expect(
      (await dispatch(handler, { method: "GET", url: path })).statusCode,
    ).toBe(401)
    const response = await dispatch(handler, {
      method: "GET",
      url: path,
      headers: { authorization: "Bearer test-key" },
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers["Content-Type"]).toBe("video/mp4")
    expect(response.body.toString()).toBe("video-bytes")

    const range = await dispatch(handler, {
      method: "GET",
      url: path,
      headers: {
        authorization: "Bearer test-key",
        range: "bytes=6-10",
      },
    })
    expect(range.statusCode).toBe(206)
    expect(range.headers["Content-Range"]).toBe("bytes 6-10/11")
    expect(range.body.toString()).toBe("bytes")
  })

  it("does not expose input artifacts or traversal paths", async () => {
    const { handler } = await setup()
    for (const url of [
      `/artifacts/input-1/${DEVOTIONAL_INPUT_ARTIFACT_TYPE}.json`,
      `/artifacts/%2e%2e/${DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE}.mp4`,
      `/artifacts/output-1/%2e%2e.mp4`,
    ]) {
      const response = await dispatch(handler, {
        method: "GET",
        url,
        headers: { authorization: "Bearer test-key" },
      })
      expect(response.statusCode).toBe(404)
    }
  })
})
