import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { loadVideoContextPack } from "./video-context-pack.service"

type Overrides = {
  video?: unknown
  videoLocale?: unknown[]
  videoDub?: unknown[]
  videoImage?: unknown[]
  studyQuestion?: { findMany: ReturnType<typeof vi.fn> }
  bibleCitation?: unknown[] | { findMany: ReturnType<typeof vi.fn> }
  sceneLocale?: unknown[] | { findMany: ReturnType<typeof vi.fn> }
  transcriptChunk?: unknown[]
}

const PLAYABLE_VIDEO = {
  id: "vid1",
  slug: "the-resurrection",
  label: "FEATURE_FILM",
}
const DUB = {
  published: true,
  hls: "https://example.com/v.m3u8",
  dash: null,
  share: null,
  language: { bcp47: "en", iso3: "eng", slug: "english" },
}
const CITATION = {
  osisId: "John.20.19",
  chapterStart: 20,
  chapterEnd: null,
  verseStart: 19,
  verseEnd: 29,
  bibleBook: { name: { en: "John" }, osisId: "John" },
}

function makePrisma(o: Overrides = {}): PrismaClient {
  const many = (rows: unknown[]) => ({
    findMany: vi.fn().mockResolvedValue(rows),
  })
  return {
    video: {
      findFirst: vi
        .fn()
        .mockResolvedValue(o.video === undefined ? PLAYABLE_VIDEO : o.video),
    },
    videoLocale: many(
      o.videoLocale ?? [
        {
          locale: "en",
          title: "The Resurrection",
          description: "A story.",
        },
      ],
    ),
    videoDub: many(o.videoDub ?? [DUB]),
    videoImage: many(o.videoImage ?? [{ url: "https://example.com/img.jpg" }]),
    videoStudyQuestion:
      o.studyQuestion ?? many([{ text: "Why does it matter?", order: 1 }]),
    bibleCitation:
      o.bibleCitation && "findMany" in (o.bibleCitation as object)
        ? o.bibleCitation
        : many((o.bibleCitation as unknown[]) ?? [CITATION]),
    videoSceneLocale:
      o.sceneLocale && "findMany" in (o.sceneLocale as object)
        ? o.sceneLocale
        : many(
            (o.sceneLocale as unknown[]) ?? [
              {
                description: "A locked room.",
                themes: ["fear"],
                spiritualContext: ["peace"],
              },
            ],
          ),
    videoTranscriptChunk: many(
      o.transcriptChunk ?? [{ text: "Peace be with you." }],
    ),
  } as unknown as PrismaClient
}

describe("loadVideoContextPack", () => {
  it("assembles a full pack with all provenance true", async () => {
    const pack = await loadVideoContextPack(makePrisma(), {
      videoId: "vid1",
      locale: "en",
    })
    expect(pack).not.toBeNull()
    expect(pack!.video.videoId).toBe("vid1")
    expect(pack!.video.previewStreamUrl).toBe("https://example.com/v.m3u8")
    expect(pack!.studyQuestions[0].text).toBe("Why does it matter?")
    // Citation composes a real reference label and carries NO verse text.
    expect(pack!.citations[0].reference).toBe("John 20:19-29")
    expect(pack!.citations[0]).not.toHaveProperty("text")
    expect(pack!.provenance).toMatchObject({
      studyQuestions: true,
      citations: true,
      scene: true,
      transcript: true,
      localeFallback: null,
    })
  })

  it("uses English title fallback without replacing requested description", async () => {
    const pack = await loadVideoContextPack(
      makePrisma({
        videoLocale: [
          { locale: "ar", title: "   ", description: "وصف عربي" },
          {
            locale: "en",
            title: "The Resurrection",
            description: "English description",
          },
        ],
      }),
      { videoId: "vid1", locale: "ar" },
    )

    expect(pack?.video).toMatchObject({
      title: "The Resurrection",
      description: "وصف عربي",
    })
  })

  it("returns null when the anchor video is missing or not playable", async () => {
    const pack = await loadVideoContextPack(makePrisma({ video: null }), {
      videoId: "missing",
      locale: "en",
    })
    expect(pack).toBeNull()
  })

  it("degrades when scene + transcript are absent (only-this-branch fixture)", async () => {
    const pack = await loadVideoContextPack(
      makePrisma({ sceneLocale: [], transcriptChunk: [] }),
      { videoId: "vid1", locale: "en" },
    )
    expect(pack!.scene).toBeNull()
    expect(pack!.transcript).toBeNull()
    expect(pack!.provenance.scene).toBe(false)
    expect(pack!.provenance.transcript).toBe(false)
    // The reliable floor (study questions + citations) is still present.
    expect(pack!.provenance.studyQuestions).toBe(true)
    expect(pack!.provenance.citations).toBe(true)
  })

  it("omits study questions (never fabricates) when none exist", async () => {
    const pack = await loadVideoContextPack(
      makePrisma({
        studyQuestion: { findMany: vi.fn().mockResolvedValue([]) },
      }),
      { videoId: "vid1", locale: "en" },
    )
    expect(pack!.studyQuestions).toEqual([])
    expect(pack!.provenance.studyQuestions).toBe(false)
    expect(pack!.provenance.localeFallback).toBeNull()
  })

  it("falls back to primary-language study questions and records localeFallback", async () => {
    // First call (requested locale) → empty; second call (primary) → present.
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ text: "Primary question", order: 1 }])
    const pack = await loadVideoContextPack(
      makePrisma({ studyQuestion: { findMany } }),
      { videoId: "vid1", locale: "fr" },
    )
    expect(pack!.studyQuestions[0].text).toBe("Primary question")
    expect(pack!.provenance.localeFallback).toBe("primary")
  })

  it("degrades (never throws) when a source read fails", async () => {
    const pack = await loadVideoContextPack(
      makePrisma({
        bibleCitation: {
          findMany: vi.fn().mockRejectedValue(new Error("db down")),
        },
      }),
      { videoId: "vid1", locale: "en" },
    )
    expect(pack).not.toBeNull()
    expect(pack!.citations).toEqual([])
    expect(pack!.provenance.citations).toBe(false)
    // Other sources unaffected.
    expect(pack!.provenance.studyQuestions).toBe(true)
  })
})
