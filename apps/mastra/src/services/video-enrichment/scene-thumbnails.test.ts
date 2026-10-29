import { expect, it, vi } from "vitest"
import { resolveScenePlaybackId } from "./scene-thumbnails"
it("resolves missing playback through the canonical Mux asset without following redirects", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () =>
    Response.json({ data: { playback_ids: [{ id: "playback" }] } }),
  )
  expect(
    await resolveScenePlaybackId(
      { muxAssetId: "mux" },
      { fetchImpl, tokenId: "fixture", tokenSecret: "secret" },
    ),
  ).toBe("playback")
  const [url, init] = fetchImpl.mock.calls[0]!
  expect(String(url)).toBe("https://api.mux.com/video/v1/assets/mux")
  expect(init?.redirect).toBe("error")
  expect(new Headers(init?.headers).get("authorization")).toBe(
    `Basic ${Buffer.from("fixture:secret").toString("base64")}`,
  )
})
it("uses safe supplied playback without a request and rejects missing/oversized replies", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () =>
    Response.json({ data: { playback_ids: [] } }),
  )
  expect(
    await resolveScenePlaybackId(
      { muxAssetId: "mux", playbackId: "playback" },
      { fetchImpl },
    ),
  ).toBe("playback")
  expect(fetchImpl).not.toHaveBeenCalled()
  const options = { fetchImpl, tokenId: "fixture", tokenSecret: "secret" }
  await expect(
    resolveScenePlaybackId({ muxAssetId: "mux" }, options),
  ).rejects.toThrow("no playback")
  fetchImpl.mockResolvedValueOnce(new Response("x".repeat(1024 * 1024 + 1)))
  await expect(
    resolveScenePlaybackId({ muxAssetId: "mux" }, options),
  ).rejects.toThrow("too large")
})
