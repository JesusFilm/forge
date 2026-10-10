import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { S3Client } from "@aws-sdk/client-s3"
import { LocalFilesystem } from "@mastra/core/workspace"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createDevotionalWorkspaceMediaStore,
  devotionalWorkspaceArtifactKey,
  devotionalWorkspaceManifestKey,
} from "./media-store"

const roots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function setup(options?: { fetchImpl?: typeof fetch }) {
  const root = await mkdtemp(join(tmpdir(), "devotional-media-store-"))
  roots.push(root)
  const filesystem = new LocalFilesystem({
    id: "test",
    basePath: root,
    contained: true,
    readOnly: false,
  })
  await filesystem.init()
  const presign = vi.fn(async (_client, command, _options?: unknown) => {
    const input = command.input as { Key?: string }
    return `https://bucket.example/${input.Key}?signed=redacted`
  })
  const send = vi.fn(async (_command: unknown) => ({ ETag: '"etag-1"' }))
  const store = createDevotionalWorkspaceMediaStore({
    filesystem,
    s3: {
      client: { send } as unknown as S3Client,
      bucket: "devotional",
      prefix: "workspace",
    },
    presign: presign as never,
    fetchImpl: options?.fetchImpl,
  })
  return { filesystem, presign, send, store }
}

const attempt = {
  workspaceGeneration: 7,
  attemptId: "attempt_7",
  runId: "run_7",
}

describe("devotional Workspace media store", () => {
  it("writes immutable input bytes and mints a method-specific read grant", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"))
    const { presign, store } = await setup()
    const ref = await store.writeImmutableArtifact({
      key: devotionalWorkspaceArtifactKey({
        attempt,
        area: "run-input",
        digest: "a".repeat(64),
        fileName: "input.json",
      }).replace(
        "a".repeat(64),
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      ),
      body: "test",
      contentType: "application/json",
      attempt,
    })
    const grant = await store.createReadGrant(ref)

    expect(grant.ref).toEqual(ref)
    expect(grant.expiresAt).toBe("2026-08-01T13:25:00.000Z")
    expect(grant.url).toContain("?signed=redacted")
    expect(presign.mock.calls[0]?.[1].constructor.name).toBe("GetObjectCommand")
    expect(presign.mock.calls[0]?.[1].input).toEqual({
      Bucket: "devotional",
      Key: `workspace/${ref.key}`,
    })
    expect(presign.mock.calls[0]?.[2]).toEqual({ expiresIn: 5_100 })
  })

  it("verifies a temporary Worker upload before moving it to a content-addressed output", async () => {
    const { filesystem, presign, store } = await setup()
    const grant = await store.createUploadGrant({
      attempt,
      uploadId: "upload_1",
      fileName: "portrait.mp4",
    })
    const body = Buffer.from("rendered-video")
    await filesystem.writeFile(grant.key, body, { recursive: true })
    const digest =
      "5c7102036ad65a84771fe6a5292bec988e56e4fd2eb84ccb122b4d2f3ea40dbb"

    const ref = await store.finalizeUpload({
      grant,
      digest,
      size: body.byteLength,
      attempt,
      fileName: "portrait.mp4",
    })

    expect(ref.key).toBe(
      devotionalWorkspaceArtifactKey({
        attempt,
        area: "attempt-output",
        digest,
        fileName: "portrait.mp4",
      }),
    )
    await expect(filesystem.exists(grant.key)).resolves.toBe(false)
    await expect(store.verifyArtifact(ref)).resolves.toBeUndefined()
    expect(presign.mock.calls[0]?.[1].constructor.name).toBe("PutObjectCommand")
    expect(presign.mock.calls[0]?.[1].input).toEqual({
      Bucket: "devotional",
      Key: `workspace/${grant.key}`,
      ContentType: "video/mp4",
    })
    expect(presign.mock.calls[0]?.[2]).toEqual({ expiresIn: 5_100 })
  })

  it("treats a destination-created move error as an idempotent finalization", async () => {
    const { filesystem, store } = await setup()
    const grant = await store.createUploadGrant({
      attempt,
      uploadId: "upload_race",
      fileName: "portrait.mp4",
    })
    const body = Buffer.from("rendered-video")
    await filesystem.writeFile(grant.key, body, { recursive: true })
    const moveFile = filesystem.moveFile.bind(filesystem)
    vi.spyOn(filesystem, "moveFile").mockImplementationOnce(async (...args) => {
      await moveFile(...args)
      throw new Error("simulated competing finalizer")
    })

    await expect(
      store.finalizeUpload({
        grant,
        digest:
          "5c7102036ad65a84771fe6a5292bec988e56e4fd2eb84ccb122b4d2f3ea40dbb",
        size: body.byteLength,
        attempt,
        fileName: "portrait.mp4",
      }),
    ).resolves.toMatchObject({ size: body.byteLength })
  })

  it("binds playback to the object version that passed verification", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(new Uint8Array([1, 2]), { status: 206 }),
    )
    const { filesystem, presign, send, store } = await setup({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const body = Buffer.from("rendered-video")
    const digest =
      "5c7102036ad65a84771fe6a5292bec988e56e4fd2eb84ccb122b4d2f3ea40dbb"
    const key = devotionalWorkspaceArtifactKey({
      attempt,
      area: "attempt-output",
      digest,
      fileName: "portrait.mp4",
    })
    await filesystem.writeFile(key, body, { recursive: true })
    const readFile = vi.spyOn(filesystem, "readFile")
    const ref = {
      schemaVersion: "2" as const,
      key,
      digest,
      size: body.byteLength,
      contentType: "video/mp4",
      etag: '"etag-1"',
      attempt,
    }

    await expect(store.fetchArtifact(ref, "bytes=0-1")).resolves.toMatchObject({
      status: 206,
    })
    expect(
      (send.mock.calls[0]?.[0] as { constructor: { name: string } }).constructor
        .name,
    ).toBe("HeadObjectCommand")
    expect(presign.mock.calls.at(-1)?.[1].input).toMatchObject({
      IfMatch: '"etag-1"',
      Range: "bytes=0-1",
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { "if-match": '"etag-1"', range: "bytes=0-1" },
      }),
    )
    expect(readFile).not.toHaveBeenCalled()
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 412 }))
    await expect(store.fetchArtifact(ref, "bytes=0-1")).rejects.toThrow(
      /artifact changed/u,
    )
  })

  it("reattaches to a completed attempt only after verifying its outputs", async () => {
    const { filesystem, store } = await setup()
    const writeVideo = async (
      body: string,
      fileName: "portrait.mp4" | "wide.mp4",
    ) => {
      const bodyDigest = createHash("sha256").update(body).digest("hex")
      return store.writeImmutableArtifact({
        key: devotionalWorkspaceArtifactKey({
          attempt,
          area: "attempt-output",
          digest: bodyDigest,
          fileName,
        }),
        body,
        contentType: "video/mp4",
        attempt,
      })
    }
    const portrait = await writeVideo("portrait-video", "portrait.mp4")
    const wide = await writeVideo("wide-video", "wide.mp4")
    const manifestBody = JSON.stringify({
      schemaVersion: "2",
      kind: "attempt-output",
      attempt,
      artifacts: [
        {
          artifactType: "devotional-output-portrait-v1",
          ext: "mp4",
          ref: portrait,
        },
        {
          artifactType: "devotional-output-wide-v1",
          ext: "mp4",
          ref: wide,
        },
      ],
    })
    await store.writeImmutableArtifact({
      key: devotionalWorkspaceManifestKey({
        attempt,
        area: "attempt-output",
      }),
      body: manifestBody,
      contentType: "application/json",
      attempt,
    })

    await expect(store.readAttemptOutput(attempt)).resolves.toMatchObject({
      manifestRef: {
        digest: createHash("sha256").update(manifestBody).digest("hex"),
      },
      manifest: { kind: "attempt-output" },
    })

    await filesystem.writeFile(portrait.key, "tampered", { overwrite: true })
    await expect(store.readAttemptOutput(attempt)).rejects.toMatchObject({
      code: "integrity_failed",
      message: expect.stringMatching(/artifact (?:size|digest) changed/u),
    })
  })

  it("rejects an upload whose claimed digest does not match Workspace bytes", async () => {
    const { filesystem, store } = await setup()
    const grant = await store.createUploadGrant({
      attempt,
      uploadId: "upload_2",
      fileName: "wide.mp4",
    })
    await filesystem.writeFile(grant.key, "mutated", { recursive: true })

    await expect(
      store.finalizeUpload({
        grant,
        digest: "a".repeat(64),
        size: 7,
        attempt,
        fileName: "wide.mp4",
      }),
    ).rejects.toThrow(/digest changed/u)
  })

  it("rejects canonical writes outside the current attempt or digest path", async () => {
    const { store } = await setup()

    await expect(
      store.writeImmutableArtifact({
        key: "runs/g7/another-attempt/run-input/not-content-addressed/input.json",
        body: "test",
        contentType: "application/json",
        attempt,
      }),
    ).rejects.toThrow(/not canonical/u)
  })
})
