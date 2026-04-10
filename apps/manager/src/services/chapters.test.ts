import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TranscriptSegment } from "@/services/transcription"

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

import {
  buildTimestampedTranscript,
  generateChapters,
  normalizeGeneratedChapters,
} from "@/services/chapters"

const transcriptSegments: TranscriptSegment[] = [
  { start: 12, end: 24, text: "Welcome to the episode." },
  { start: 37, end: 50, text: "We move into the main discussion." },
  { start: 75, end: 91, text: "Closing thoughts and prayer." },
]

describe("generateChapters", () => {
  beforeEach(() => {
    structuredOutputMock.mockReset()
    writeArtifactMock.mockReset()
    writeArtifactMock.mockResolvedValue("chapters-key")
  })

  it("builds a timestamped transcript from segment input", () => {
    expect(buildTimestampedTranscript(transcriptSegments)).toBe(
      [
        "[12s] Welcome to the episode.",
        "[37s] We move into the main discussion.",
        "[75s] Closing thoughts and prayer.",
      ].join("\n"),
    )
  })

  it("normalizes out-of-order output, derives endSeconds, and drops invalid rows", () => {
    expect(
      normalizeGeneratedChapters(
        [
          {
            title: "Closing Prayer",
            startSeconds: 75,
            summary: "Wraps up the talk.",
          },
          {
            title: "Chapter 1",
            startSeconds: 0,
            summary: "Generic title should be rejected.",
          },
          {
            title: "Main Discussion",
            startSeconds: 37,
            summary: "Introduces the core teaching.",
          },
          {
            title: "Main Discussion Duplicate",
            startSeconds: 37,
            summary: "Duplicate boundaries should be dropped.",
          },
          {
            title: "Opening Context",
            startSeconds: 12,
            summary: "Sets up the introduction.",
          },
        ],
        {
          assetId: "asset-1",
          segments: transcriptSegments,
        },
      ),
    ).toEqual([
      {
        title: "Opening Context",
        startSeconds: 0,
        endSeconds: 37,
        summary: "Sets up the introduction.",
      },
      {
        title: "Main Discussion",
        startSeconds: 37,
        endSeconds: 75,
        summary: "Introduces the core teaching.",
      },
      {
        title: "Closing Prayer",
        startSeconds: 75,
        endSeconds: 91,
        summary: "Wraps up the talk.",
      },
    ])
  })

  it("drops later chapter anchors that exceed the transcript duration", () => {
    expect(
      normalizeGeneratedChapters(
        [
          {
            title: "Opening Context",
            startSeconds: 12,
            summary: "Sets up the introduction.",
          },
          {
            title: "Late Hallucinated Chapter",
            startSeconds: 250,
            summary: "Should be dropped as out of bounds.",
          },
        ],
        {
          assetId: "asset-1",
          segments: transcriptSegments,
        },
      ),
    ).toEqual([
      {
        title: "Opening Context",
        startSeconds: 0,
        endSeconds: 91,
        summary: "Sets up the introduction.",
      },
    ])
  })

  it("writes normalized chapters when the llm returns valid json", async () => {
    structuredOutputMock.mockResolvedValue({
      chapters: [
        {
          title: "Main Discussion",
          startSeconds: 37,
          summary: "Introduces the core teaching.",
        },
        {
          title: "Opening Context",
          startSeconds: 12,
          summary: "Sets up the introduction.",
        },
      ],
    })

    await expect(
      generateChapters("asset-1", {
        transcriptText: "hello world",
        segments: transcriptSegments,
        language: "en",
      }),
    ).resolves.toEqual({
      chapters: [
        {
          title: "Opening Context",
          startSeconds: 0,
          endSeconds: 37,
          summary: "Sets up the introduction.",
        },
        {
          title: "Main Discussion",
          startSeconds: 37,
          endSeconds: 91,
          summary: "Introduces the core teaching.",
        },
      ],
      artifactKeys: ["chapters"],
    })

    expect(writeArtifactMock).toHaveBeenCalledTimes(1)
    expect(writeArtifactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        artifactType: "chapters",
        ext: "json",
        body: JSON.stringify(
          {
            chapters: [
              {
                title: "Opening Context",
                startSeconds: 0,
                endSeconds: 37,
                summary: "Sets up the introduction.",
              },
              {
                title: "Main Discussion",
                startSeconds: 37,
                endSeconds: 91,
                summary: "Introduces the core teaching.",
              },
            ],
          },
          null,
          2,
        ),
      }),
    )
  })

  it("throws instead of writing a chapters artifact when no usable rows remain", async () => {
    structuredOutputMock.mockResolvedValue({
      chapters: [
        {
          title: "Chapter 1",
          startSeconds: 0,
          summary: "Rejected generic title.",
        },
      ],
    })

    await expect(
      generateChapters("asset-1", {
        transcriptText: "hello world",
        segments: transcriptSegments,
      }),
    ).rejects.toThrow("Chapter extraction produced no chapters")
    expect(writeArtifactMock).not.toHaveBeenCalled()
  })

  it("writes only bounded chapter timestamps when the llm returns an out-of-bounds anchor", async () => {
    structuredOutputMock.mockResolvedValue({
      chapters: [
        {
          title: "Opening Context",
          startSeconds: 12,
          summary: "Sets up the introduction.",
        },
        {
          title: "Late Hallucinated Chapter",
          startSeconds: 250,
          summary: "Should be dropped as out of bounds.",
        },
      ],
    })

    await expect(
      generateChapters("asset-1", {
        transcriptText: "hello world",
        segments: transcriptSegments,
      }),
    ).resolves.toEqual({
      chapters: [
        {
          title: "Opening Context",
          startSeconds: 0,
          endSeconds: 91,
          summary: "Sets up the introduction.",
        },
      ],
      artifactKeys: ["chapters"],
    })

    expect(writeArtifactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify(
          {
            chapters: [
              {
                title: "Opening Context",
                startSeconds: 0,
                endSeconds: 91,
                summary: "Sets up the introduction.",
              },
            ],
          },
          null,
          2,
        ),
      }),
    )
  })

  it("keeps a sparse single-chapter outline usable when no segment timing is available", async () => {
    structuredOutputMock.mockResolvedValue({
      chapters: [
        {
          title: "Opening Context",
          startSeconds: 18,
          summary: "Sets up the introduction.",
        },
      ],
    })

    await expect(
      generateChapters("asset-1", {
        transcriptText: "hello world",
      }),
    ).resolves.toEqual({
      chapters: [
        {
          title: "Opening Context",
          startSeconds: 0,
          endSeconds: null,
          summary: "Sets up the introduction.",
        },
      ],
      artifactKeys: ["chapters"],
    })
  })

  it("throws when there is no transcript content to chapter", async () => {
    await expect(
      generateChapters("asset-1", {
        transcriptText: "   ",
        segments: [],
      }),
    ).rejects.toThrow("Chapter extraction requires transcript content")
    expect(structuredOutputMock).not.toHaveBeenCalled()
    expect(writeArtifactMock).not.toHaveBeenCalled()
  })

  it("throws instead of writing an empty chapters artifact when parsing fails", async () => {
    structuredOutputMock.mockRejectedValue(
      new Error("Structured output parsing failed for chapters"),
    )

    await expect(
      generateChapters("asset-1", {
        transcriptText: "hello world",
        segments: transcriptSegments,
      }),
    ).rejects.toThrow("Structured output parsing failed for chapters")
    expect(writeArtifactMock).not.toHaveBeenCalled()
  })

  it("includes timestamps in the prompt when segments are available", async () => {
    structuredOutputMock.mockResolvedValue({
      chapters: [
        {
          title: "Opening Context",
          startSeconds: 12,
          summary: "Sets up the introduction.",
        },
      ],
    })

    await generateChapters("asset-1", {
      transcriptText: "hello world",
      segments: transcriptSegments,
      language: "en",
    })

    expect(structuredOutputMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "chapters",
        name: "chapters_outline",
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("[12s] Welcome to the episode."),
          }),
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining(
              "Write chapter titles and summaries in the transcript language (en).",
            ),
          }),
        ]),
      }),
    )
  })
})
