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

import { extractMetadata, MetadataGenerationError } from "@/services/metadata"

describe("extractMetadata", () => {
  beforeEach(() => {
    structuredOutputMock.mockReset()
    writeArtifactMock.mockReset()
    writeArtifactMock.mockResolvedValue("metadata-key")
  })

  it("writes normalized metadata using the resolved transcription language", async () => {
    structuredOutputMock.mockResolvedValue({
      title: "  What Does This Life Mean?  ",
      description: "  A reflection on meaning and purpose.  ",
      topics: [" purpose ", "", "purpose"],
      speakers: ["  John Doe  ", "", "john doe"],
      tags: ["Meaning", "meaning", "", "Purpose"],
      language: "fr",
    })

    await expect(
      extractMetadata("asset-1", "hello world", "en"),
    ).resolves.toEqual({
      title: "What Does This Life Mean?",
      description: "A reflection on meaning and purpose.",
      topics: ["purpose"],
      speakers: ["John Doe"],
      tags: ["meaning", "purpose"],
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
    expect(writeArtifactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        artifactType: "metadata",
      }),
    )
  })

  it("includes output language guidance only when an override is supplied", async () => {
    structuredOutputMock.mockResolvedValue({
      title: "Title",
      description: "Description.",
      topics: [],
      speakers: [],
      tags: ["purpose"],
      language: "en",
    })

    await extractMetadata("asset-1", "hello world", "en")

    const firstPrompt = structuredOutputMock.mock.calls[0]?.[0]?.messages?.[1]
      ?.content as string
    expect(firstPrompt).not.toContain("language_guidance")

    structuredOutputMock.mockReset()
    structuredOutputMock.mockResolvedValue({
      title: "Titulo",
      description: "Descripcion.",
      topics: [],
      speakers: [],
      tags: ["proposito"],
      language: "es",
    })

    await extractMetadata("asset-1", "hello world", "en", {
      outputLanguage: "es",
    })

    const secondPrompt = structuredOutputMock.mock.calls[0]?.[0]?.messages?.[1]
      ?.content as string
    expect(secondPrompt).toContain("language_guidance")
    expect(secondPrompt).toContain('Set the language field to "es".')
  })

  it("applies prompt overrides only to the targeted section", async () => {
    structuredOutputMock.mockResolvedValue({
      title: "Title",
      description: "Description.",
      topics: [],
      speakers: [],
      tags: ["purpose"],
      language: "en",
    })

    await extractMetadata("asset-1", "hello world", "en", {
      promptOverrides: {
        description: "Custom description guidance.",
      },
    })

    const prompt = structuredOutputMock.mock.calls[0]?.[0]?.messages?.[1]
      ?.content as string

    expect(prompt).toContain("<description_requirements>")
    expect(prompt).toContain("Custom description guidance.")
    expect(prompt).toContain("<title_requirements>")
    expect(prompt).toContain("Never exceed 10 words.")
  })

  it("retries once when the first response is invalid json", async () => {
    structuredOutputMock
      .mockRejectedValueOnce(
        new Error("Structured output parsing failed for metadata"),
      )
      .mockResolvedValueOnce({
        title: "Restored Title",
        description: "A direct summary.",
        topics: [],
        speakers: [],
        tags: ["restored"],
        language: "en",
      })

    await expect(
      extractMetadata("asset-1", "hello world", "en"),
    ).resolves.toMatchObject({
      title: "Restored Title",
      tags: ["restored"],
      language: "en",
    })

    expect(structuredOutputMock).toHaveBeenCalledTimes(2)
    const retryPrompt = structuredOutputMock.mock.calls[1]?.[0]?.messages?.[1]
      ?.content as string
    expect(retryPrompt).toContain("<retry_corrections>")
    expect(retryPrompt).toContain("Response was not valid JSON.")
  })

  it("retries once when the first response contains filler metadata", async () => {
    structuredOutputMock
      .mockResolvedValueOnce({
        title: "The video shows a message",
        description: "This video features a speaker talking about purpose.",
        topics: [],
        speakers: [],
        tags: ["purpose"],
        language: "en",
      })
      .mockResolvedValueOnce({
        title: "Purpose and Meaning",
        description: "A speaker reflects on meaning and purpose in life.",
        topics: ["purpose"],
        speakers: ["Speaker"],
        tags: ["purpose", "meaning"],
        language: "en",
      })

    await expect(
      extractMetadata("asset-1", "hello world", "en"),
    ).resolves.toMatchObject({
      title: "Purpose and Meaning",
      tags: ["purpose", "meaning"],
    })

    expect(structuredOutputMock).toHaveBeenCalledTimes(2)
  })

  it("throws after the second invalid response and does not write an artifact", async () => {
    structuredOutputMock.mockResolvedValue({
      title: "",
      description: "This video features a speaker.",
      topics: [],
      speakers: [],
      tags: [],
      language: "en",
    })

    await expect(
      extractMetadata("asset-1", "hello world", "en"),
    ).rejects.toMatchObject({
      name: "MetadataGenerationError",
      code: "quality_validation",
    } satisfies Partial<MetadataGenerationError>)

    expect(structuredOutputMock).toHaveBeenCalledTimes(2)
    expect(writeArtifactMock).not.toHaveBeenCalled()
  })

  it("enforces the tag cap after cleanup", async () => {
    structuredOutputMock.mockResolvedValue({
      title: "Purpose and Meaning",
      description: "A reflection on meaning and purpose.",
      topics: [],
      speakers: [],
      tags: [
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
        "eleven",
      ],
      language: "en",
    })

    const result = await extractMetadata("asset-1", "hello world", "en")
    expect(result.tags).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten",
    ])
  })
})
