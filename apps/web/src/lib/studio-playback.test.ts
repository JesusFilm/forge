import { expect, it } from "vitest"
import { isStudioPlaybackUrl, studioPosterFromHls } from "./studio-playback"
it("refuses equivalent Studio paths before optimizer fetch", () => {
  for (const path of [
    "/api/studio/playback/release/poster.webp",
    "/api/studio/playback/release/poster.webp/",
    "/%61pi/studio/playback/release/poster.webp",
    "/api/%73tudio/playback/release/poster.webp",
    "/api/studio/playback%2Frelease%2Fposter.webp",
    "/%2561pi/studio/playback/release/poster.webp",
  ])
    expect(isStudioPlaybackUrl(`https://admin.test${path}`)).toBe(true)
  for (const path of [
    "/api/public/media-assets/asset",
    "/images/core.png",
    "/api/studio/playback-unrelated/image.png",
  ])
    expect(isStudioPlaybackUrl(`https://admin.test${path}`)).toBe(false)
  expect(
    studioPosterFromHls(
      "https://admin.test/api/studio/playback/release/index.m3u8",
    ),
  ).toBe("https://admin.test/api/studio/playback/release/poster.webp")
})
