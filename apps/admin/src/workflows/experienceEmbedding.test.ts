import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/services/mastra-experience-embedding-client", () => ({
  launchMastraExperienceEmbeddingForLocale: vi.fn(),
}))

const { runExperienceEmbedding } = await import("./experienceEmbedding")
const { launchMastraExperienceEmbeddingForLocale } =
  await import("@/services/mastra-experience-embedding-client")

describe("runExperienceEmbedding", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("launches Mastra in force mode and returns a scrubbed GraphQL-facing shape", async () => {
    vi.mocked(launchMastraExperienceEmbeddingForLocale).mockResolvedValueOnce({
      ok: true,
      status: "forced",
    })

    const result = await runExperienceEmbedding({ localeId: "loc-1" })

    expect(launchMastraExperienceEmbeddingForLocale).toHaveBeenCalledWith(
      "loc-1",
      { mode: "force" },
    )
    expect(result).toEqual({
      localeId: "loc-1",
      updated: true,
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("mastraRunId")
    expect(serialized).not.toContain("model")
    expect(serialized).not.toContain("dimensions")
  })

  it("throws typed Mastra failures instead of returning hidden ok:false results", async () => {
    vi.mocked(launchMastraExperienceEmbeddingForLocale).mockResolvedValueOnce({
      ok: false,
      reason: "provider_failed",
      retryable: true,
    })

    await expect(runExperienceEmbedding({ localeId: "loc-1" })).rejects.toThrow(
      "Mastra experience embedding failed: provider_failed",
    )
  })
})
