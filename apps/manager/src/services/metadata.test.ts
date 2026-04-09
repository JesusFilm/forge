import { beforeEach, describe, expect, it, vi } from "vitest"

const { createCompletionMock, writeArtifactMock } = vi.hoisted(() => ({
  createCompletionMock: vi.fn(),
  writeArtifactMock: vi.fn(),
}))

vi.mock("@/services/openrouter", () => ({
  DEFAULT_MODEL: "test-model",
  getOpenrouter: () => ({
    chat: {
      completions: {
        create: createCompletionMock,
      },
    },
  }),
}))

vi.mock("@/services/storage", () => ({
  writeArtifact: writeArtifactMock,
}))

import { extractMetadata, MetadataGenerationError } from "@/services/metadata"

describe("extractMetadata", () => {
  beforeEach(() => {
    createCompletionMock.mockReset()
    writeArtifactMock.mockReset()
    writeArtifactMock.mockResolvedValue("metadata-key")
  })

  it("writes normalized metadata using the resolved transcription language", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "  What Does This Life Mean?  ",
              description: "  A reflection on meaning and purpose.  ",
              topics: [" purpose ", "", "purpose"],
              speakers: ["  John Doe  ", "", "john doe"],
              tags: ["Meaning", "meaning", "", "Purpose"],
              language: "fr",
            }),
          },
        },
      ],
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
    expect(writeArtifactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        artifactType: "metadata",
      }),
    )
  })

  it("includes output language guidance only when an override is supplied", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "Title",
              description: "Description.",
              topics: [],
              speakers: [],
              tags: ["purpose"],
            }),
          },
        },
      ],
    })

    await extractMetadata("asset-1", "hello world", "en")

    const firstPrompt = createCompletionMock.mock.calls[0]?.[0]?.messages?.[1]
      ?.content as string
    expect(firstPrompt).not.toContain("language_guidance")

    createCompletionMock.mockReset()
    createCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "Titulo",
              description: "Descripcion.",
              topics: [],
              speakers: [],
              tags: ["proposito"],
            }),
          },
        },
      ],
    })

    await extractMetadata("asset-1", "hello world", "en", {
      outputLanguage: "es",
    })

    const secondPrompt = createCompletionMock.mock.calls[0]?.[0]?.messages?.[1]
      ?.content as string
    expect(secondPrompt).toContain("language_guidance")
    expect(secondPrompt).toContain('Set the language field to "es".')
  })

  it("applies prompt overrides only to the targeted section", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "Title",
              description: "Description.",
              topics: [],
              speakers: [],
              tags: ["purpose"],
            }),
          },
        },
      ],
    })

    await extractMetadata("asset-1", "hello world", "en", {
      promptOverrides: {
        description: "Custom description guidance.",
      },
    })

    const prompt = createCompletionMock.mock.calls[0]?.[0]?.messages?.[1]
      ?.content as string

    expect(prompt).toContain("<description_requirements>")
    expect(prompt).toContain("Custom description guidance.")
    expect(prompt).toContain("<title_requirements>")
    expect(prompt).toContain(`Never exceed 10 words.`)
  })

  it("retries once when the first response is invalid json", async () => {
    createCompletionMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "not json",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "Restored Title",
                description: "A direct summary.",
                topics: [],
                speakers: [],
                tags: ["restored"],
              }),
            },
          },
        ],
      })

    await expect(
      extractMetadata("asset-1", "hello world", "en"),
    ).resolves.toMatchObject({
      title: "Restored Title",
      tags: ["restored"],
      language: "en",
    })

    expect(createCompletionMock).toHaveBeenCalledTimes(2)
    const retryPrompt = createCompletionMock.mock.calls[1]?.[0]?.messages?.[1]
      ?.content as string
    expect(retryPrompt).toContain("<retry_corrections>")
    expect(retryPrompt).toContain("Response was not valid JSON.")
  })

  it("retries once when the first response contains filler metadata", async () => {
    createCompletionMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "The video shows a message",
                description:
                  "This video features a speaker talking about purpose.",
                topics: [],
                speakers: [],
                tags: ["purpose"],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "Purpose and Meaning",
                description:
                  "A speaker reflects on meaning and purpose in life.",
                topics: ["purpose"],
                speakers: ["Speaker"],
                tags: ["purpose", "meaning"],
              }),
            },
          },
        ],
      })

    await expect(
      extractMetadata("asset-1", "hello world", "en"),
    ).resolves.toMatchObject({
      title: "Purpose and Meaning",
      tags: ["purpose", "meaning"],
    })

    expect(createCompletionMock).toHaveBeenCalledTimes(2)
  })

  it("throws after the second invalid response and does not write an artifact", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "",
              description: "This video features a speaker.",
              topics: [],
              speakers: [],
              tags: [],
            }),
          },
        },
      ],
    })

    await expect(
      extractMetadata("asset-1", "hello world", "en"),
    ).rejects.toMatchObject({
      name: "MetadataGenerationError",
      code: "quality_validation",
    } satisfies Partial<MetadataGenerationError>)

    expect(createCompletionMock).toHaveBeenCalledTimes(2)
    expect(writeArtifactMock).not.toHaveBeenCalled()
  })

  it("enforces the tag cap after cleanup", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
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
            }),
          },
        },
      ],
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
