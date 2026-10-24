import { afterEach, expect, it, vi } from "vitest"
import { downloadStudioSource } from "./sources"

afterEach(() => vi.unstubAllGlobals())
it("reads bounded Mux rendition manifests without allowing lookalike hosts or redirects", async () => {
  const fetcher = vi.fn(async () => new Response("#EXTM3U"))
  vi.stubGlobal("fetch", fetcher)
  await expect(
    downloadStudioSource(
      "https://manifest-oci-us-ashburn-1-vop1.fastly.mux.com/film.m3u8",
      100,
    ),
  ).resolves.toEqual(Buffer.from("#EXTM3U"))
  expect(fetcher).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({ redirect: "error" }),
  )
  for (const url of [
    "https://mux.com.evil.example/film.m3u8",
    "https://evilmux.com/film.m3u8",
    "http://stream.mux.com/film.m3u8",
    "https://user@stream.mux.com/film.m3u8",
    "https://stream.mux.com:8443/film.m3u8",
  ])
    await expect(downloadStudioSource(url, 100)).rejects.toThrow("INVALID")
  expect(fetcher).toHaveBeenCalledTimes(1)
  await expect(
    downloadStudioSource("https://stream.mux.com/film.m3u8", 1),
  ).rejects.toThrow("INVALID")
})
