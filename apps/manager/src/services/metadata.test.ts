import { beforeEach, describe, expect, it, vi } from "vitest"

const { structuredOutputMock, writeArtifactMock } = vi.hoisted(() => ({
  structuredOutputMock: vi.fn(),
  writeArtifactMock: vi.fn(),
}))

vi.mock("@/services/openrouter", () => ({
  DEFAULT_MODEL: "test-model",
  createStructuredOpenrouterOutput: structuredOutputMock,
}))

vi.mock("@/services/storage", () => ({
  writeArtifact: writeArtifactMock,
}))

import { extractMetadata } from "@/services/metadata"

describe("extractMetadata", () => {
  beforeEach(() => {
    structuredOutputMock.mockReset()
    writeArtifactMock.mockReset()
    writeArtifactMock.mockResolvedValue("metadata-key")
  })

  it("writes metadata when the llm returns usable fields", async () => {
    structuredOutputMock.mockResolvedValue({
      title: "What Does This Life Mean?",
      description: "A reflection on meaning and purpose.",
      topics: ["purpose"],
      speakers: [],
      tags: ["meaning"],
      language: "en",
    })

    await expect(
      extractMetadata("asset-1", "hello world", "en"),
    ).resolves.toEqual({
      title: "What Does This Life Mean?",
      description: "A reflection on meaning and purpose.",
      topics: ["purpose"],
      speakers: [],
      tags: ["meaning"],
      language: "en",
      artifactKeys: ["metadata"],
    })
    expect(writeArtifactMock).toHaveBeenCalledTimes(1)
    expect(structuredOutputMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "metadata",
        name: "video_metadata",
        model: "test-model",
      }),
    )
  })

  it("throws instead of writing blank metadata", async () => {
    structuredOutputMock.mockResolvedValue({
      title: "",
      description: "",
      topics: [],
      speakers: [],
      tags: [],
      language: "en",
    })

    await expect(
      extractMetadata("asset-1", "hello world", "en"),
    ).rejects.toThrow("Metadata extraction produced no usable fields")
    expect(writeArtifactMock).not.toHaveBeenCalled()
  })
})
