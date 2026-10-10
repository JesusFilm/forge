import { describe, expect, it } from "vitest"
import { studioStageCatalogSchema } from "./catalog"
describe("catalog admission", () => {
  it("requires signed ready Mux identity and rejects fabricated Core identifiers", () => {
    const input = {
      projectId: "project",
      expectedRevision: 1,
      idempotencyKey: "stage",
      renderAttemptId: "render",
      mux: {
        assetId: "mux-asset",
        playbackId: "signed-playback",
        policy: "signed",
        status: "ready",
      },
    }
    expect(studioStageCatalogSchema.safeParse(input).success).toBe(true)
    expect(
      studioStageCatalogSchema.safeParse({ ...input, coreId: "fake" }).success,
    ).toBe(false)
    expect(
      studioStageCatalogSchema.safeParse({
        ...input,
        mux: { ...input.mux, policy: "public" },
      }).success,
    ).toBe(false)
  })
})
