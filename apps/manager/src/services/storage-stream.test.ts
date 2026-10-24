// Real-contract tests for the streaming storage read (local backend): the
// media route tests mock storage, so this file proves the actual byte-window
// math against real files (root CLAUDE.md: mocked tests prove branch shape,
// real fixtures prove the production contract).

import { rm } from "node:fs/promises"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// Force the local backend regardless of the host environment.
vi.mock("@/config/env", () => ({
  env: {} as Record<string, string | undefined>,
}))

const {
  ArtifactNotFoundError,
  ArtifactRangeNotSatisfiableError,
  openArtifactStream,
  statArtifact,
  writeArtifact,
} = await import("@/services/storage")

const ASSET_ID = `shorts-stream-test-${Date.now()}`
const ARTIFACT_TYPE = "shorts-clip-v1"
const EXT = "mp4"

// 0..255 repeated — byte value equals offset % 256, so window assertions are
// self-describing.
const CONTENT = new Uint8Array(1000).map((_, index) => index % 256)

async function readAll(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

beforeAll(async () => {
  await writeArtifact({
    assetId: ASSET_ID,
    artifactType: ARTIFACT_TYPE,
    ext: EXT,
    body: CONTENT,
    contentType: "video/mp4",
  })
})

afterAll(async () => {
  await rm(join(process.cwd(), ".tmp", "artifacts", ASSET_ID), {
    recursive: true,
    force: true,
  })
})

describe("statArtifact (local backend)", () => {
  it("returns the object size", async () => {
    await expect(
      statArtifact(ASSET_ID, ARTIFACT_TYPE, EXT),
    ).resolves.toMatchObject({
      size: 1000,
    })
  })

  it("throws the typed not-found error for missing artifacts", async () => {
    await expect(
      statArtifact(ASSET_ID, "shorts-output-v1", EXT),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError)
  })
})

describe("openArtifactStream (local backend)", () => {
  it("streams the full object without a range", async () => {
    const stream = await openArtifactStream({
      assetId: ASSET_ID,
      artifactType: ARTIFACT_TYPE,
      ext: EXT,
    })

    expect(stream.totalSize).toBe(1000)
    expect(stream.contentLength).toBe(1000)
    expect(stream.rangeStart).toBe(0)
    expect(stream.rangeEnd).toBe(999)

    const bytes = await readAll(stream.body)
    expect(bytes).toEqual(CONTENT)
  })

  it("streams a bounded window (inclusive offsets)", async () => {
    const stream = await openArtifactStream({
      assetId: ASSET_ID,
      artifactType: ARTIFACT_TYPE,
      ext: EXT,
      range: { start: 10, end: 19 },
    })

    expect(stream.contentLength).toBe(10)
    expect(stream.rangeStart).toBe(10)
    expect(stream.rangeEnd).toBe(19)
    expect(await readAll(stream.body)).toEqual(CONTENT.slice(10, 20))
  })

  it("streams an open-ended window to the end", async () => {
    const stream = await openArtifactStream({
      assetId: ASSET_ID,
      artifactType: ARTIFACT_TYPE,
      ext: EXT,
      range: { start: 990 },
    })

    expect(stream.contentLength).toBe(10)
    expect(stream.rangeEnd).toBe(999)
    expect(await readAll(stream.body)).toEqual(CONTENT.slice(990))
  })

  it("streams a suffix window (last n bytes)", async () => {
    const stream = await openArtifactStream({
      assetId: ASSET_ID,
      artifactType: ARTIFACT_TYPE,
      ext: EXT,
      range: { suffix: 25 },
    })

    expect(stream.contentLength).toBe(25)
    expect(stream.rangeStart).toBe(975)
    expect(stream.rangeEnd).toBe(999)
    expect(await readAll(stream.body)).toEqual(CONTENT.slice(975))
  })

  it("clamps a suffix longer than the object to the full object", async () => {
    const stream = await openArtifactStream({
      assetId: ASSET_ID,
      artifactType: ARTIFACT_TYPE,
      ext: EXT,
      range: { suffix: 5000 },
    })

    expect(stream.contentLength).toBe(1000)
    expect(stream.rangeStart).toBe(0)
  })

  it("clamps an end beyond the object to the last byte", async () => {
    const stream = await openArtifactStream({
      assetId: ASSET_ID,
      artifactType: ARTIFACT_TYPE,
      ext: EXT,
      range: { start: 900, end: 5000 },
    })

    expect(stream.contentLength).toBe(100)
    expect(stream.rangeEnd).toBe(999)
  })

  it("throws the typed 416 error (carrying the size) for out-of-bounds starts", async () => {
    const error = await openArtifactStream({
      assetId: ASSET_ID,
      artifactType: ARTIFACT_TYPE,
      ext: EXT,
      range: { start: 1000 },
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ArtifactRangeNotSatisfiableError)
    expect(
      (error as InstanceType<typeof ArtifactRangeNotSatisfiableError>)
        .totalSize,
    ).toBe(1000)
  })

  it("treats a zero-length suffix as unsatisfiable", async () => {
    await expect(
      openArtifactStream({
        assetId: ASSET_ID,
        artifactType: ARTIFACT_TYPE,
        ext: EXT,
        range: { suffix: 0 },
      }),
    ).rejects.toBeInstanceOf(ArtifactRangeNotSatisfiableError)
  })

  it("throws the typed not-found error for missing artifacts", async () => {
    await expect(
      openArtifactStream({
        assetId: ASSET_ID,
        artifactType: "shorts-output-v1",
        ext: EXT,
      }),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError)
  })
})
