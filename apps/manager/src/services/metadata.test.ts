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

import { extractMetadata } from "@/services/metadata"

describe("extractMetadata", () => {
  beforeEach(() => {
    createCompletionMock.mockReset()
    writeArtifactMock.mockReset()
    writeArtifactMock.mockResolvedValue("metadata-key")
  })

  it("writes metadata when the llm returns usable fields", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "What Does This Life Mean?",
              description: "A reflection on meaning and purpose.",
              topics: ["purpose"],
              speakers: [],
              tags: ["meaning"],
              language: "en",
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
      speakers: [],
      tags: ["meaning"],
      language: "en",
      artifactKeys: ["metadata"],
    })
    expect(writeArtifactMock).toHaveBeenCalledTimes(1)
  })

  it("throws instead of writing blank metadata", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "",
              description: "",
              topics: [],
              speakers: [],
              tags: [],
              language: "en",
            }),
          },
        },
      ],
    })

    await expect(
      extractMetadata("asset-1", "hello world", "en"),
    ).rejects.toThrow("Metadata extraction produced no usable fields")
    expect(writeArtifactMock).not.toHaveBeenCalled()
  })
})
