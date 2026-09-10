import { nativeAndroidSessionOwnsPlayback } from "./nativeAndroidSession"

const sessionVideo = { documentId: "jesus-id", variants: [{ id: "arabic" }] }
const urls = {
  activeVariantHls: "https://stream.mux.com/arabic.m3u8",
  currentUrl: "https://stream.mux.com/english.m3u8",
}

it("attaches late-hydrated language menus to the playing video identity", () => {
  expect(
    nativeAndroidSessionOwnsPlayback({
      videoId: "jesus-id",
      sessionVideo,
      ...urls,
    }),
  ).toBe(true)
})

it("rejects an unrelated or absent session", () => {
  expect(
    nativeAndroidSessionOwnsPlayback({
      videoId: "other",
      sessionVideo,
      ...urls,
    }),
  ).toBe(false)
  expect(
    nativeAndroidSessionOwnsPlayback({
      videoId: "jesus-id",
      sessionVideo: null,
      ...urls,
    }),
  ).toBe(false)
})

it("keeps identity-free playback behind the original source match", () => {
  expect(nativeAndroidSessionOwnsPlayback({ sessionVideo, ...urls })).toBe(
    false,
  )
  expect(
    nativeAndroidSessionOwnsPlayback({
      sessionVideo,
      ...urls,
      currentUrl: urls.activeVariantHls,
    }),
  ).toBe(true)
})
