import { describe, expect, it, vi } from "vitest"

import { handleDevotionalAssetRequest } from "./devotional-asset-route"

const BASE = {
  authHeader: "Bearer secret",
  serviceKeys: ["secret"],
  assetId: "devo_1",
  artifactType: "devotional-output-portrait-v1",
  ext: "mp4",
}

describe("devotional asset route", () => {
  it("fails closed without the service bearer", async () => {
    const response = await handleDevotionalAssetRequest({
      ...BASE,
      authHeader: undefined,
    })
    expect(response.status).toBe(401)
  })

  it("rejects artifact types outside the devotional video allowlist", async () => {
    const response = await handleDevotionalAssetRequest({
      ...BASE,
      artifactType: "devotional-render-input-v1",
    })
    expect(response.status).toBe(404)
  })

  it("forwards Range and preserves streaming response metadata", async () => {
    const fetchArtifact = vi.fn(
      async () =>
        new Response(new Uint8Array([2, 3]), {
          status: 206,
          headers: {
            "accept-ranges": "bytes",
            "content-range": "bytes 1-2/4",
            "content-length": "2",
            "content-type": "video/mp4",
          },
        }),
    )
    const response = await handleDevotionalAssetRequest({
      ...BASE,
      range: "bytes=1-2",
      fetchArtifact,
    })

    expect(fetchArtifact).toHaveBeenCalledWith(
      {
        assetId: "devo_1",
        artifactType: "devotional-output-portrait-v1",
        ext: "mp4",
      },
      "bytes=1-2",
    )
    expect(response.status).toBe(206)
    expect(response.headers.get("accept-ranges")).toBe("bytes")
    expect(response.headers.get("content-range")).toBe("bytes 1-2/4")
    await expect(response.arrayBuffer()).resolves.toEqual(
      new Uint8Array([2, 3]).buffer,
    )
  })
})
