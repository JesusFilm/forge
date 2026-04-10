import { describe, it, expect, vi } from "vitest"

// Mock external dependencies to avoid env validation
vi.mock("@/services/storage", () => ({
  writeArtifact: vi.fn().mockResolvedValue("key"),
}))

const { structuredOutputMock } = vi.hoisted(() => ({
  structuredOutputMock: vi.fn(),
}))

vi.mock("@/services/openrouter", () => ({
  createStructuredOpenrouterOutput: structuredOutputMock,
  DEFAULT_MODEL: "google/gemini-2.5-flash",
}))

vi.mock("@/services/mux", () => ({
  getSceneThumbnailUrls: vi
    .fn()
    .mockReturnValue([
      "https://image.mux.com/abc/thumbnail.webp?width=768&time=0",
      "https://image.mux.com/abc/thumbnail.webp?width=768&time=30",
      "https://image.mux.com/abc/thumbnail.webp?width=768&time=60",
    ]),
}))

import { beforeEach } from "vitest"
import {
  buildDescription,
  analyzeScene,
  analyzeAllScenes,
} from "./sceneAnalysis"
import type { SceneBoundary } from "./sceneBoundaries"

beforeEach(() => {
  vi.clearAllMocks()
  structuredOutputMock.mockImplementation(async ({ onUsage }) => {
    onUsage?.({
      promptTokens: 15600,
      completionTokens: 800,
      totalTokens: 16400,
    })

    return {
      inputQuality: "good",
      themes: ["forgiveness", "reconciliation"],
      bibleVerses: ["Matthew 6:14-15", "Ephesians 4:32"],
      content:
        "A father confronts his estranged son. The son asks for forgiveness.",
      tone: "sorrowful, hopeful",
      demographics: ["adult", "parent"],
      spiritualContext: ["seeker"],
    }
  })
})

describe("buildDescription", () => {
  it("concatenates signals in priority order: themes first", () => {
    const desc = buildDescription({
      inputQuality: "good",
      themes: ["forgiveness", "redemption"],
      bibleVerses: ["Matthew 6:14-15"],
      content: "A scene about forgiveness.",
      tone: "hopeful",
      demographics: ["adult"],
      spiritualContext: ["seeker"],
    })

    const lines = desc.split("\n")
    expect(lines[0]).toMatch(/^Themes:/)
    expect(lines[1]).toMatch(/^Bible verses:/)
    expect(lines[2]).toMatch(/^Content:/)
    expect(lines[3]).toMatch(/^Tone:/)
    expect(lines[4]).toMatch(/^Demographics:/)
    expect(lines[5]).toMatch(/^Spiritual context:/)
  })

  it("omits empty fields", () => {
    const desc = buildDescription({
      inputQuality: "good",
      themes: ["hope"],
      bibleVerses: [],
      content: "A hopeful scene.",
      tone: "peaceful",
      demographics: [],
      spiritualContext: [],
    })

    expect(desc).not.toContain("Bible verses:")
    expect(desc).not.toContain("Demographics:")
    expect(desc).toContain("Themes: hope.")
  })

  it("returns empty string when all fields are empty", () => {
    const desc = buildDescription({
      inputQuality: "good",
      themes: [],
      bibleVerses: [],
      content: "",
      tone: "",
      demographics: [],
      spiritualContext: [],
    })

    expect(desc).toBe("")
  })
})

describe("analyzeScene", () => {
  const boundary: SceneBoundary = {
    sceneIndex: 0,
    startSeconds: 0,
    endSeconds: 60,
    chapterTitle: "Introduction",
    transcriptChunk: "The story begins with a father...",
  }

  const metadata = {
    videoLabel: "featureFilm",
    bibleVerses: ["John 3:16"],
  }

  it("returns a correctly typed SceneAnalysis", async () => {
    const { analysis } = await analyzeScene("playback123", boundary, metadata)

    expect(analysis.sceneIndex).toBe(0)
    expect(analysis.startSeconds).toBe(0)
    expect(analysis.endSeconds).toBe(60)
    expect(analysis.chapterTitle).toBe("Introduction")
    expect(analysis.themes).toEqual(["forgiveness", "reconciliation"])
    expect(analysis.bibleVerses).toEqual(["Matthew 6:14-15", "Ephesians 4:32"])
    expect(analysis.demographics).toEqual(["adult", "parent"])
    expect(analysis.spiritualContext).toEqual(["seeker"])
  })

  it("builds description with themes first", async () => {
    const { analysis } = await analyzeScene("playback123", boundary, metadata)

    expect(analysis.description).toMatch(/^Themes:/)
    expect(analysis.description).toContain("forgiveness")
    expect(analysis.description).toContain("Matthew 6:14-15")
  })

  it("returns token counts", async () => {
    const { inputTokens, outputTokens } = await analyzeScene(
      "playback123",
      boundary,
      metadata,
    )

    expect(inputTokens).toBe(15600)
    expect(outputTokens).toBe(800)
  })

  it("calls the shared structured output helper with multimodal content", async () => {
    await analyzeScene("playback123", boundary, metadata)

    expect(structuredOutputMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "scene_analysis",
        name: "scene_analysis",
        model: "google/gemini-2.5-flash",
        messages: [
          expect.objectContaining({
            role: "system",
            content: expect.any(String),
          }),
          expect.objectContaining({
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: "https://image.mux.com/abc/thumbnail.webp?width=768&time=0",
                },
              },
              {
                type: "image_url",
                image_url: {
                  url: "https://image.mux.com/abc/thumbnail.webp?width=768&time=30",
                },
              },
              {
                type: "image_url",
                image_url: {
                  url: "https://image.mux.com/abc/thumbnail.webp?width=768&time=60",
                },
              },
              expect.objectContaining({
                type: "text",
                text: expect.stringContaining("Transcript:"),
              }),
            ],
          }),
        ],
      }),
    )
  })

  it("accumulates usage counts reported by the shared helper", async () => {
    structuredOutputMock.mockImplementation(async ({ onUsage }) => {
      onUsage?.({
        promptTokens: 15600,
        completionTokens: 800,
        totalTokens: 16400,
      })
      return {
        inputQuality: "good",
        themes: ["forgiveness", "reconciliation"],
        bibleVerses: ["Matthew 6:14-15", "Ephesians 4:32"],
        content:
          "A father confronts his estranged son. The son asks for forgiveness.",
        tone: "sorrowful, hopeful",
        demographics: ["adult", "parent"],
        spiritualContext: ["seeker"],
      }
    })

    const { inputTokens, outputTokens } = await analyzeScene(
      "playback123",
      boundary,
      metadata,
    )

    expect(inputTokens).toBe(15600)
    expect(outputTokens).toBe(800)
  })

  it(
    "returns empty analysis when the shared helper fails on all retries",
    { timeout: 15000 },
    async () => {
      structuredOutputMock.mockRejectedValue(new Error("malformed response"))

      const { analysis } = await analyzeScene("playback123", boundary, metadata)

      expect(analysis.sceneIndex).toBe(0)
      expect(analysis.startSeconds).toBe(0)
      expect(analysis.themes).toEqual([])
      expect(analysis.bibleVerses).toEqual([])
      expect(analysis.demographics).toEqual([])
      expect(analysis.description).toBe("")
    },
  )

  it("retries when the helper reports bad frames before succeeding", async () => {
    structuredOutputMock
      .mockImplementationOnce(async ({ onUsage }) => {
        onUsage?.({
          promptTokens: 100,
          completionTokens: 10,
          totalTokens: 110,
        })
        return {
          inputQuality: "bad_frames",
          themes: [],
          bibleVerses: [],
          content: "",
          tone: "",
          demographics: [],
          spiritualContext: [],
        }
      })
      .mockImplementationOnce(async ({ onUsage }) => {
        onUsage?.({
          promptTokens: 150,
          completionTokens: 20,
          totalTokens: 170,
        })
        return {
          inputQuality: "good",
          themes: ["forgiveness", "reconciliation"],
          bibleVerses: ["Matthew 6:14-15", "Ephesians 4:32"],
          content:
            "A father confronts his estranged son. The son asks for forgiveness.",
          tone: "sorrowful, hopeful",
          demographics: ["adult", "parent"],
          spiritualContext: ["seeker"],
        }
      })

    const { analysis, inputTokens, outputTokens } = await analyzeScene(
      "playback123",
      boundary,
      metadata,
    )

    expect(structuredOutputMock).toHaveBeenCalledTimes(2)
    expect(analysis.themes).toEqual(["forgiveness", "reconciliation"])
    expect(inputTokens).toBe(250)
    expect(outputTokens).toBe(30)
  })
})

describe("analyzeAllScenes", () => {
  const boundaries: SceneBoundary[] = [
    {
      sceneIndex: 0,
      startSeconds: 0,
      endSeconds: 60,
      chapterTitle: "Act One",
      transcriptChunk: "Beginning of the story.",
    },
    {
      sceneIndex: 1,
      startSeconds: 60,
      endSeconds: null,
      chapterTitle: "Act Two",
      transcriptChunk: "The story continues.",
    },
  ]

  const metadata = { videoLabel: "shortFilm" }

  it("processes all scenes and returns aggregated result", async () => {
    const result = await analyzeAllScenes(
      "asset123",
      "playback123",
      boundaries,
      metadata,
    )

    expect(result.scenes).toHaveLength(2)
    expect(result.scenes[0]!.sceneIndex).toBe(0)
    expect(result.scenes[1]!.sceneIndex).toBe(1)
    expect(result.totalInputTokens).toBe(31200)
    expect(result.totalOutputTokens).toBe(1600)
  })

  it("stores artifact via writeArtifact", async () => {
    const { writeArtifact } = await import("@/services/storage")

    await analyzeAllScenes("asset456", "playback456", boundaries, metadata)

    expect(writeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset456",
        artifactType: "scene-analysis",
        ext: "json",
      }),
    )
  })
})
