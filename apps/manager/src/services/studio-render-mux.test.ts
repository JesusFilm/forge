import { expect, it, vi } from "vitest"
const create = vi.hoisted(() =>
  vi.fn(async () => ({ id: "mux-asset", status: "preparing" })),
)
vi.mock("./mux", () => ({ getMux: () => ({ video: { assets: { create } } }) }))
import { createStudioMuxAsset, studioMuxReadyProof } from "./studio-render-mux"
it("creates only signed playback with no automatic provider retries", async () => {
  await createStudioMuxAsset(
    "https://storage.example.test/immutable.mp4",
    "render-intent-1",
    new AbortController().signal,
  )
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      input: [{ url: "https://storage.example.test/immutable.mp4" }],
      playback_policy: ["signed"],
      passthrough: "render-intent-1",
      master_access: "none",
    }),
    expect.objectContaining({ maxRetries: 0, timeout: 30000 }),
  )
})
const asset = {
  id: "mux-asset",
  status: "ready",
  passthrough: "render-intent-1",
  duration: 1,
  playback_ids: [{ id: "signed-id", policy: "signed" }],
  tracks: [
    { type: "video", max_width: 320, max_height: 180, max_frame_rate: 30 },
    { type: "audio", max_channels: 2 },
  ],
}
it("requires exact signed-only readiness and matching intent", () => {
  expect(studioMuxReadyProof(asset, "render-intent-1")).toEqual({
    assetId: "mux-asset",
    playbackId: "signed-id",
    status: "ready",
    playbackPolicies: ["signed"],
    width: 320,
    height: 180,
    fps: 30,
    durationMs: 1000,
    audio: true,
  })
  expect(() =>
    studioMuxReadyProof(
      {
        ...asset,
        playback_ids: [
          ...asset.playback_ids,
          { id: "public-id", policy: "public" },
        ],
      },
      "render-intent-1",
    ),
  ).toThrow()
  expect(() => studioMuxReadyProof(asset, "other-intent")).toThrow()
  expect(() =>
    studioMuxReadyProof({ ...asset, status: "preparing" }, "render-intent-1"),
  ).toThrow()
})
