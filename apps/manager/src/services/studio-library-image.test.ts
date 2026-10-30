import { createHash } from "node:crypto"
import { afterEach, expect, it, vi } from "vitest"
import { videoLibraryThumbnail } from "./studio-library-thumbnail"
vi.mock("./studio-library-thumbnail", () => ({
  videoLibraryThumbnail: vi.fn(),
}))
import { libraryImage } from "./studio-library-image"
import type { StudioBrokerClient } from "./studio-broker"

const bytes = Buffer.from("retained image bytes")
const reference = {
  assetId: "image",
  versionId: "version",
  digest: createHash("sha256").update(bytes).digest("hex"),
}
const asset = {
  reference,
  mediaAssetId: "media",
  filename: "image.png",
  mimeType: "image/png",
  byteSize: bytes.length,
  role: "background",
  provenance: { status: "unknown", recorded: {} },
  narration: null,
  voice: null,
  actor: { kind: "human", id: "operator" },
}
afterEach(() => vi.unstubAllGlobals())

it("authorizes retained images and verifies transferred bytes before returning them", async () => {
  const call = vi.fn<StudioBrokerClient>(async (action) =>
    action === "asset"
      ? asset
      : { path: `/api/shorts/assets/transfer/${"a".repeat(64)}` },
  )
  const fetcher = vi.fn(async () => new Response(bytes))
  vi.stubGlobal("fetch", fetcher)
  const result = await libraryImage(call, reference)
  expect(result).toEqual({ type: "image/png", bytes, durationMs: undefined })
  expect(call.mock.calls.map(([action]) => action)).toEqual([
    "asset",
    "asset-read",
  ])
  fetcher.mockResolvedValueOnce(new Response("changed bytes"))
  await expect(libraryImage(call, reference)).rejects.toThrow("digest")
})

it("does not transfer unauthorized, non-image or oversized assets", async () => {
  const fetcher = vi.fn()
  vi.stubGlobal("fetch", fetcher)
  const denied = vi.fn<StudioBrokerClient>(async () => {
    throw new Error("Forbidden")
  })
  await expect(libraryImage(denied, reference)).rejects.toThrow("Forbidden")
  for (const changes of [
    { mimeType: "audio/mpeg" },
    { byteSize: 16 * 1024 * 1024 + 1 },
  ]) {
    const call = vi.fn<StudioBrokerClient>(async () => ({
      ...asset,
      ...changes,
    }))
    await expect(libraryImage(call, reference)).rejects.toThrow()
    expect(call.mock.calls.map(([action]) => action)).toEqual(["asset"])
  }
  expect(fetcher).not.toHaveBeenCalled()
})

it("makes a video still from verified bytes and authorizes even cached thumbnails", async () => {
  const still = Buffer.from("jpeg still")
  vi.mocked(videoLibraryThumbnail).mockResolvedValueOnce({
    bytes: still,
    durationMs: 125000,
  })
  const call = vi.fn<StudioBrokerClient>(async (action) =>
    action === "asset"
      ? { ...asset, mimeType: "video/mp4" }
      : { path: `/api/shorts/assets/transfer/${"a".repeat(64)}` },
  )
  const fetcher = vi.fn(async () => new Response(bytes))
  vi.stubGlobal("fetch", fetcher)
  expect(await libraryImage(call, reference)).toEqual({
    type: "image/jpeg",
    bytes: still,
    durationMs: 125000,
  })
  expect(videoLibraryThumbnail).toHaveBeenCalledWith(bytes, undefined)
  expect(await libraryImage(call, reference)).toEqual({
    type: "image/jpeg",
    bytes: still,
    durationMs: 125000,
  })
  expect(fetcher).toHaveBeenCalledOnce()
  expect(call.mock.calls.map(([action]) => action)).toEqual([
    "asset",
    "asset-read",
    "asset",
  ])
  call.mockRejectedValueOnce(new Error("Forbidden"))
  await expect(libraryImage(call, reference)).rejects.toThrow("Forbidden")
})
