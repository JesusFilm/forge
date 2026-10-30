import { expect, it, vi } from "vitest"
import { libraryArtwork } from "./studio-library-artwork"

it("looks up only admitted search results and fails artwork softly", async () => {
  const videos = vi.fn(async () => [
    {
      documentId: "film",
      variants: [{ muxVideo: { playbackId: "Playback123" } }],
    },
  ])
  const sign = vi.fn(async () => "signed-thumbnail")
  const result = await libraryArtwork([{ videoId: "film" }], videos, sign)
  expect(videos).toHaveBeenCalledExactlyOnceWith(["film"])
  expect(result.film).toBe(
    "https://image.mux.com/Playback123/thumbnail.webp?token=signed-thumbnail",
  )
  expect(await libraryArtwork([], videos, sign)).toEqual({})
  expect(videos).toHaveBeenCalledTimes(1)
  expect(await libraryArtwork([{ videoId: "missing" }], videos, sign)).toEqual({
    missing: undefined,
  })
  const failed = await libraryArtwork(
    [{ videoId: "film" }],
    videos,
    async () => {
      throw new TypeError("Signing unavailable")
    },
  )
  expect(failed).toEqual({
    film: "https://image.mux.com/Playback123/thumbnail.webp?width=320&time=0",
  })
})

it("prefers supplied catalog thumbnails without sampling or signing a Mux frame", async () => {
  const sign = vi.fn(async () => "token")
  const videos = vi.fn(async () => [
    {
      documentId: "film",
      imageUrl: "https://images.example/catalog-thumbnail.jpg",
      variants: [{ muxVideo: { playbackId: "Playback123" } }],
    },
  ])
  expect(await libraryArtwork([{ videoId: "film" }], videos, sign)).toEqual({
    film: "https://images.example/catalog-thumbnail.jpg",
  })
  expect(sign).not.toHaveBeenCalled()
})

it("adds a delivery variant to raw catalog image URLs and rejects unsafe URLs", async () => {
  const sign = vi.fn(async () => "token")
  const video = {
    documentId: "film",
    imageUrl: "https://imagedelivery.net/account/image",
    variants: [{ muxVideo: { playbackId: "Playback123" } }],
  }
  expect(
    await libraryArtwork([{ videoId: "film" }], async () => [video], sign),
  ).toEqual({ film: "https://imagedelivery.net/account/image/public" })
  for (const imageUrl of [
    "javascript:alert(1)",
    "https://user:password@example.com/image",
    "invalid",
  ]) {
    const result = await libraryArtwork(
      [{ videoId: "film" }],
      async () => [{ ...video, imageUrl }],
      sign,
    )
    expect(result.film).toBe(
      "https://image.mux.com/Playback123/thumbnail.webp?token=token",
    )
  }
})
