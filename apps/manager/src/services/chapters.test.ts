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

import { generateChapters } from "@/services/chapters"

describe("generateChapters", () => {
  beforeEach(() => {
    createCompletionMock.mockReset()
    writeArtifactMock.mockReset()
    writeArtifactMock.mockResolvedValue("chapters-key")
  })

  it("writes chapters when the llm returns valid non-empty json", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              chapters: [
                {
                  title: "Intro",
                  startSeconds: 0,
                  endSeconds: 30,
                  summary: "Opening section",
                },
              ],
            }),
          },
        },
      ],
    })

    await expect(generateChapters("asset-1", "hello world")).resolves.toEqual({
      chapters: [
        {
          title: "Intro",
          startSeconds: 0,
          endSeconds: 30,
          summary: "Opening section",
        },
      ],
      artifactKeys: ["chapters"],
    })
    expect(writeArtifactMock).toHaveBeenCalledTimes(1)
  })

  it("throws instead of writing an empty chapters artifact", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ chapters: [] }) } }],
    })

    await expect(generateChapters("asset-1", "hello world")).rejects.toThrow(
      "Chapter extraction produced no chapters",
    )
    expect(writeArtifactMock).not.toHaveBeenCalled()
  })
})
