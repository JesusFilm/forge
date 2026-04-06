import { describe, it, expect, vi } from "vitest"

// Mock storage to avoid env validation at import time
vi.mock("@/services/storage", () => ({
  writeArtifact: vi.fn().mockResolvedValue("key"),
  readArtifact: vi.fn(),
  artifactExists: vi.fn(),
}))

import { extractSceneBoundaries } from "./sceneBoundaries"
import type { Chapter } from "./chapters"

describe("extractSceneBoundaries", () => {
  it("produces a single scene when no chapters exist", () => {
    const result = extractSceneBoundaries([], "full transcript text")
    expect(result.scenes).toHaveLength(1)
    expect(result.scenes[0]).toEqual({
      sceneIndex: 0,
      startSeconds: 0,
      endSeconds: null,
      chapterTitle: null,
      transcriptChunk: "full transcript text",
    })
  })

  it("maps a single chapter to a single scene", () => {
    const chapters: Chapter[] = [
      {
        title: "Introduction",
        startSeconds: 0,
        endSeconds: null,
        summary: "Opening",
      },
    ]

    const result = extractSceneBoundaries(chapters, "hello world")
    expect(result.scenes).toHaveLength(1)
    expect(result.scenes[0]).toMatchObject({
      sceneIndex: 0,
      startSeconds: 0,
      endSeconds: null,
      chapterTitle: "Introduction",
      transcriptChunk: "hello world",
    })
  })

  it("maps multiple chapters to ordered scenes with transcript chunks", () => {
    const chapters: Chapter[] = [
      {
        title: "Act One",
        startSeconds: 0,
        endSeconds: 60,
        summary: "Beginning",
      },
      {
        title: "Act Two",
        startSeconds: 60,
        endSeconds: 120,
        summary: "Middle",
      },
      {
        title: "Act Three",
        startSeconds: 120,
        endSeconds: null,
        summary: "End",
      },
    ]

    const transcript = "word1 word2 word3 word4 word5 word6"
    const result = extractSceneBoundaries(chapters, transcript)

    expect(result.scenes).toHaveLength(3)
    expect(result.scenes[0]!.sceneIndex).toBe(0)
    expect(result.scenes[1]!.sceneIndex).toBe(1)
    expect(result.scenes[2]!.sceneIndex).toBe(2)
    expect(result.scenes[0]!.chapterTitle).toBe("Act One")
    expect(result.scenes[2]!.chapterTitle).toBe("Act Three")

    // All transcript words should be distributed across chunks
    const allWords = result.scenes
      .map((s) => s.transcriptChunk)
      .join(" ")
      .split(/\s+/)
      .filter(Boolean)
    expect(allWords).toHaveLength(6)
  })

  it("preserves chapter timestamps exactly", () => {
    const chapters: Chapter[] = [
      {
        title: "Scene A",
        startSeconds: 10.5,
        endSeconds: 45.2,
        summary: "A",
      },
      {
        title: "Scene B",
        startSeconds: 45.2,
        endSeconds: null,
        summary: "B",
      },
    ]

    const result = extractSceneBoundaries(chapters, "some words here now")
    expect(result.scenes[0]!.startSeconds).toBe(10.5)
    expect(result.scenes[0]!.endSeconds).toBe(45.2)
    expect(result.scenes[1]!.startSeconds).toBe(45.2)
    expect(result.scenes[1]!.endSeconds).toBeNull()
  })

  it("handles feature-film-scale chapter count", () => {
    const chapters: Chapter[] = Array.from({ length: 75 }, (_, i) => ({
      title: `Chapter ${i + 1}`,
      startSeconds: i * 60,
      endSeconds: i === 74 ? null : (i + 1) * 60,
      summary: `Summary ${i + 1}`,
    }))

    const transcript = Array.from({ length: 750 }, (_, i) => `w${i}`).join(" ")
    const result = extractSceneBoundaries(chapters, transcript)

    expect(result.scenes).toHaveLength(75)
    expect(result.scenes[0]!.sceneIndex).toBe(0)
    expect(result.scenes[74]!.sceneIndex).toBe(74)
    for (const scene of result.scenes) {
      expect(scene.transcriptChunk.length).toBeGreaterThan(0)
    }
  })
})
