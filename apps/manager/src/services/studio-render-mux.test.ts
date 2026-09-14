import { expect, it, vi } from "vitest"
const create = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({
    id: "mux-upload",
    status: "waiting",
  })),
)
vi.mock("./mux", () => ({ getMux: () => ({ video: { uploads: { create } } }) }))
import { createStudioMuxUpload, studioMuxReadyProof } from "./studio-render-mux"
it("creates only signed playback with no automatic provider retries", async () => {
  await createStudioMuxUpload("render-intent-1", new AbortController().signal)
  expect(create.mock.calls[0]?.[0]).not.toHaveProperty("input")
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      timeout: 3600,
      new_asset_settings: expect.objectContaining({
        playback_policy: ["signed"],
        passthrough: "render-intent-1",
        master_access: "none",
      }),
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
