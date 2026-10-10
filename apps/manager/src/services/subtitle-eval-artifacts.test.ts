import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  readVerifiedSubtitleEvalArtifact,
  createLocalSubtitleEvalArtifactBackend,
  createS3SubtitleEvalArtifactBackend,
  resolveSubtitleEvalArtifactStorageMode,
  SubtitleEvalArtifactCollisionError,
  type SubtitleEvalArtifactBackend,
  writeImmutableSubtitleEvalArtifact,
} from "./subtitle-eval-artifacts"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  )
})

function memoryBackend(): SubtitleEvalArtifactBackend & {
  objects: Map<string, Uint8Array>
} {
  const objects = new Map<string, Uint8Array>()
  return {
    objects,
    async putIfAbsent(key, bytes) {
      if (objects.has(key)) return "exists"
      objects.set(key, bytes.slice())
      return "created"
    },
    async read(key) {
      const bytes = objects.get(key)
      if (!bytes) throw new Error("missing")
      return bytes.slice()
    },
  }
}

describe("subtitle evaluation immutable artifacts", () => {
  it("replays the same digest without overwriting", async () => {
    const backend = memoryBackend()
    const first = await writeImmutableSubtitleEvalArtifact(
      { kind: "candidate", body: "WEBVTT\n", mediaType: "text/vtt" },
      backend,
    )
    const replay = await writeImmutableSubtitleEvalArtifact(
      { kind: "candidate", body: "WEBVTT\n", mediaType: "text/vtt" },
      backend,
    )
    expect(first.replayed).toBe(false)
    expect(replay).toMatchObject({ objectKey: first.objectKey, replayed: true })
    expect(backend.objects).toHaveLength(1)
  })

  it("detects a corrupt existing object at the digest key", async () => {
    const backend = memoryBackend()
    const first = await writeImmutableSubtitleEvalArtifact(
      { kind: "candidate", body: "WEBVTT\n", mediaType: "text/vtt" },
      backend,
    )
    backend.objects.set(first.objectKey, new TextEncoder().encode("changed"))
    await expect(
      writeImmutableSubtitleEvalArtifact(
        { kind: "candidate", body: "WEBVTT\n", mediaType: "text/vtt" },
        backend,
      ),
    ).rejects.toBeInstanceOf(SubtitleEvalArtifactCollisionError)
  })

  it("verifies digest and length again on reads", async () => {
    const backend = memoryBackend()
    const stored = await writeImmutableSubtitleEvalArtifact(
      { kind: "reference", body: "WEBVTT\n", mediaType: "text/vtt" },
      backend,
    )
    await expect(
      readVerifiedSubtitleEvalArtifact(stored, backend),
    ).resolves.toEqual(new TextEncoder().encode("WEBVTT\n"))
    await expect(
      readVerifiedSubtitleEvalArtifact(
        { ...stored, sha256: "0".repeat(64) },
        backend,
      ),
    ).rejects.toBeInstanceOf(SubtitleEvalArtifactCollisionError)
  })

  it("bounds local reads from one opened file handle", async () => {
    const root = await mkdtemp(join(tmpdir(), "subtitle-eval-artifacts-"))
    temporaryRoots.push(root)
    const backend = createLocalSubtitleEvalArtifactBackend(root)
    const body = new TextEncoder().encode("12345678")
    const stored = await writeImmutableSubtitleEvalArtifact(
      { kind: "candidate", body, mediaType: "text/vtt" },
      backend,
    )

    await expect(backend.read(stored.objectKey, 8)).resolves.toEqual(body)
    await expect(backend.read(stored.objectKey, 7)).rejects.toBeInstanceOf(
      SubtitleEvalArtifactCollisionError,
    )
  })

  it("publishes one complete local object under concurrent no-overwrite writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "subtitle-eval-artifacts-"))
    temporaryRoots.push(root)
    const backend = createLocalSubtitleEvalArtifactBackend(root)
    const key = `subtitle-eval/v1/candidate/${"0".repeat(64)}.vtt`
    const first = new Uint8Array(512 * 1024).fill(1)
    const second = new Uint8Array(512 * 1024).fill(2)

    const states = await Promise.all([
      backend.putIfAbsent(key, first, "text/vtt"),
      backend.putIfAbsent(key, second, "text/vtt"),
    ])
    const stored = await backend.read(key, first.byteLength)

    expect(states.sort()).toEqual(["created", "exists"])
    expect(
      stored.every((value) => value === 1) ||
        stored.every((value) => value === 2),
    ).toBe(true)
  })

  it("does not let an interrupted temporary write poison the final digest key", async () => {
    const root = await mkdtemp(join(tmpdir(), "subtitle-eval-artifacts-"))
    temporaryRoots.push(root)
    const backend = createLocalSubtitleEvalArtifactBackend(root)
    const key = `subtitle-eval/v1/candidate/${"1".repeat(64)}.vtt`
    const parent = join(root, "subtitle-eval", "v1", "candidate")
    await mkdir(parent, { recursive: true })
    await writeFile(join(root, `${key}.interrupted.tmp`), "partial")

    const body = new TextEncoder().encode("complete")
    await expect(backend.putIfAbsent(key, body, "text/vtt")).resolves.toBe(
      "created",
    )
    await expect(backend.read(key, body.byteLength)).resolves.toEqual(body)
  })

  it("fails closed for missing or partial production S3 configuration", () => {
    expect(() =>
      resolveSubtitleEvalArtifactStorageMode({ nodeEnv: "production" }),
    ).toThrow(/required in production/i)
    expect(() =>
      resolveSubtitleEvalArtifactStorageMode({
        nodeEnv: "production",
        endpoint: "https://objects.example.test",
        region: "auto",
        bucket: "subtitle-eval",
      }),
    ).toThrow(/incomplete/i)
    expect(
      resolveSubtitleEvalArtifactStorageMode({ nodeEnv: "development" }),
    ).toBe("local")
    expect(
      resolveSubtitleEvalArtifactStorageMode({
        nodeEnv: "development",
        region: "auto",
      }),
    ).toBe("local")
    expect(
      resolveSubtitleEvalArtifactStorageMode({
        nodeEnv: "production",
        endpoint: "https://objects.example.test",
        region: "auto",
        bucket: "subtitle-eval",
        accessKeyId: "access",
        secretAccessKey: "secret",
      }),
    ).toBe("s3")
    expect(() =>
      resolveSubtitleEvalArtifactStorageMode({
        nodeEnv: "production",
        region: "auto",
        bucket: "subtitle-eval",
        accessKeyId: "access",
        secretAccessKey: "secret",
      }),
    ).toThrow(/incomplete/i)
  })

  it("bounds streamed S3 reads without trusting ContentLength", async () => {
    const destroyed = vi.fn()
    const streamBody = (chunks: Uint8Array[]) => ({
      destroy: destroyed,
      async *[Symbol.asyncIterator]() {
        yield* chunks
      },
    })
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Body: streamBody([new Uint8Array(8)]) })
      .mockResolvedValueOnce({
        Body: streamBody([new Uint8Array(8), new Uint8Array(1)]),
      })
    const backend = createS3SubtitleEvalArtifactBackend({
      bucket: "test",
      client: { send },
    })
    const key = `subtitle-eval/v1/candidate/${"0".repeat(64)}.vtt`

    await expect(backend.read(key, 8)).resolves.toHaveLength(8)
    await expect(backend.read(key, 8)).rejects.toBeInstanceOf(
      SubtitleEvalArtifactCollisionError,
    )
    expect(destroyed).toHaveBeenCalled()
  })

  it("fails closed for non-iterable S3 bodies", async () => {
    const transformToByteArray = vi.fn(async () => new Uint8Array(9))
    const backend = createS3SubtitleEvalArtifactBackend({
      bucket: "test",
      client: {
        send: vi.fn(async () => ({ Body: { transformToByteArray } })),
      },
    })
    const key = `subtitle-eval/v1/candidate/${"0".repeat(64)}.vtt`

    await expect(backend.read(key, 8)).rejects.toBeInstanceOf(
      SubtitleEvalArtifactCollisionError,
    )
    expect(transformToByteArray).not.toHaveBeenCalled()
  })
})
