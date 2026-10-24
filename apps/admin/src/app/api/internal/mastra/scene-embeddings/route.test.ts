import { describe, expect, it } from "vitest"

import { GET, POST } from "./route"

describe("retired Mastra scene embedding ingest route", () => {
  it("returns a stable 410 tombstone for POST", async () => {
    const response = await POST()

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({
      error: "Legacy scene embedding ingest has been retired",
      reason: "legacy_scene_embedding_pipeline_removed",
      retryable: false,
      replacement:
        "Search uses transcript embeddings; historical scene data is retained for feat-199.",
    })
  })

  it("returns the same tombstone for GET", async () => {
    const response = await GET()

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({
      reason: "legacy_scene_embedding_pipeline_removed",
      retryable: false,
    })
  })
})
