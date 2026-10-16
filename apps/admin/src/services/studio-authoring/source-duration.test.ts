import { describe, expect, it } from "vitest"
import { descriptorDurationMs } from "./source-duration"

const base = "https://api-media-core.jesusfilm.org/film/master.m3u8"
const master =
  "#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=480x270\npreview.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\nexport.m3u8"
const playlist = (tail: number) =>
  [
    "#EXTM3U",
    ...Array.from({ length: 85 }, (_, i) => `#EXTINF:5,\n${i}.ts`),
    `#EXTINF:${tail},\ntail.ts`,
    "#EXT-X-ENDLIST",
  ].join("\n")
function download(preview: string, exported = preview) {
  return async (url: string) =>
    new TextEncoder().encode(
      url === base ? master : url.endsWith("preview.m3u8") ? preview : exported,
    )
}

describe("descriptor media duration", () => {
  it("bounds the production fractional tail by available footage rather than the longer catalog", async () => {
    expect(
      await descriptorDurationMs(
        { hlsUrl: base, exportHeight: 1080, durationMs: 426197 },
        download(playlist(1.16667)),
      ),
    ).toBe(426166)
  })
  it.each([
    [1, 1.16667],
    [1.16667, 1],
  ])(
    "uses the shorter preview/export rendition (%s, %s)",
    async (preview, exported) => {
      expect(
        await descriptorDurationMs(
          { hlsUrl: base, exportHeight: 1080, durationMs: 426197 },
          download(playlist(preview), playlist(exported)),
        ),
      ).toBe(426000)
    },
  )
  it("keeps a shorter catalog bound", async () => {
    expect(
      await descriptorDurationMs(
        { hlsUrl: base, exportHeight: 1080, durationMs: 420000 },
        download(playlist(1.16667)),
      ),
    ).toBe(420000)
  })
  it("requires a complete supported VOD and exact export rendition", async () => {
    const catalog = { hlsUrl: base, exportHeight: 1080, durationMs: 426197 }
    await expect(
      descriptorDurationMs(
        catalog,
        download(playlist(1).replace("#EXT-X-ENDLIST", "")),
      ),
    ).rejects.toThrow()
    await expect(
      descriptorDurationMs(
        catalog,
        download(playlist(1) + "\n#EXT-X-KEY:METHOD=AES-128"),
      ),
    ).rejects.toThrow()
    await expect(
      descriptorDurationMs(
        { ...catalog, exportHeight: 720 },
        download(playlist(1)),
      ),
    ).rejects.toThrow()
  })
})
