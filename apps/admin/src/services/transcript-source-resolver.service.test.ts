import { describe, expect, it, vi } from "vitest"

import {
  resolveSubtitleTranscriptSource,
  _internals,
} from "@/services/transcript-source-resolver.service"

const target = {
  videoId: "v-1",
  videoEditionId: "e-1",
  coreId: "core-1",
  cmsVideoId: 42,
  language: "en",
  languageId: "lang-en",
  languageSlug: "english",
  hasSubtitle: true,
  hasDub: true,
  isPrimaryLanguage: true,
}

function prismaWithSubtitles(subtitles: unknown[]) {
  return {
    videoSubtitle: {
      findMany: vi.fn(async () => subtitles),
    },
  }
}

describe("resolveSubtitleTranscriptSource", () => {
  it("resolves a VTT subtitle into timed transcript source", async () => {
    const prisma = prismaWithSubtitles([
      {
        id: "sub-1",
        languageId: "lang-en",
        primary: true,
        vttSrc: "https://api-media-core.jesusfilm.org/subtitles/en.vtt",
        srtSrc: null,
        syncedAt: new Date("2026-06-01T00:00:00.000Z"),
        updatedAt: new Date("2026-06-02T00:00:00.000Z"),
        language: { bcp47: "en", slug: "english" },
      },
    ])
    const fetchImpl = vi.fn(async () => {
      return new Response(
        `WEBVTT

00:00:00.000 --> 00:00:02.000
<v Jesus>Hello &amp; peace.
`,
      )
    })

    const result = await resolveSubtitleTranscriptSource(
      prisma as never,
      target,
      { fetchImpl },
    )

    expect(result).toMatchObject({
      status: "resolved",
      source: {
        sourceKind: "subtitle",
        transcript: {
          text: "Hello & peace.",
          artifactKey: "admin-video-subtitle/sub-1.vtt",
          provider: "admin-subtitle",
          generatedAt: "2026-06-01T00:00:00.000Z",
        },
        provenance: {
          sourceKind: "subtitle",
          sourceKey: "admin-video-subtitle/sub-1.vtt",
          language: "en",
          languageId: "lang-en",
          languageSlug: "english",
          subtitleId: "sub-1",
          format: "vtt",
        },
      },
    })
    expect(
      result.status === "resolved" && result.source.transcript.segments,
    ).toEqual([{ start: 0, end: 2, text: "Hello & peace." }])
  })

  it("falls through to SRT when no VTT URL exists", async () => {
    const prisma = prismaWithSubtitles([
      {
        id: "sub-2",
        languageId: "lang-en",
        primary: false,
        vttSrc: null,
        srtSrc: "https://api-media-core.jesusfilm.org/subtitles/en.srt",
        syncedAt: null,
        updatedAt: new Date("2026-06-02T00:00:00.000Z"),
        language: { bcp47: "en", slug: "english" },
      },
    ])
    const fetchImpl = vi.fn(async () => {
      return new Response(`1
00:00:01,000 --> 00:00:03,500
Peace be with you.
`)
    })

    const result = await resolveSubtitleTranscriptSource(
      prisma as never,
      target,
      { fetchImpl },
    )

    expect(result).toMatchObject({
      status: "resolved",
      source: {
        transcript: {
          text: "Peace be with you.",
          artifactKey: "admin-video-subtitle/sub-2.srt",
        },
      },
    })
    expect(
      result.status === "resolved" && result.source.transcript.segments,
    ).toEqual([{ start: 1, end: 3.5, text: "Peace be with you." }])
  })

  it("returns typed gaps for missing or empty subtitles", async () => {
    await expect(
      resolveSubtitleTranscriptSource(prismaWithSubtitles([]) as never, target),
    ).resolves.toMatchObject({
      status: "gap",
      gap: { reason: "subtitle_missing" },
    })

    await expect(
      resolveSubtitleTranscriptSource(
        prismaWithSubtitles([
          {
            id: "sub-empty",
            languageId: "lang-en",
            primary: true,
            vttSrc: "https://api-media-core.jesusfilm.org/empty.vtt",
            srtSrc: null,
            syncedAt: null,
            updatedAt: new Date("2026-06-02T00:00:00.000Z"),
            language: { bcp47: "en", slug: "english" },
          },
        ]) as never,
        target,
        { fetchImpl: vi.fn(async () => new Response("WEBVTT\n\n")) },
      ),
    ).resolves.toMatchObject({
      status: "gap",
      gap: { reason: "subtitle_empty", subtitleId: "sub-empty" },
    })
  })
})

describe("transcript timed-text fetch guards", () => {
  it("allows known subtitle delivery hosts", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(`WEBVTT

00:00:00.000 --> 00:00:01.000
Peace.
`)
    })

    await expect(
      _internals.fetchTimedTextContent(
        "https://stream.mux.com/playback/text/track-en.vtt",
        { fetchImpl },
      ),
    ).resolves.toContain("Peace.")
  })

  it("rejects untrusted hosts and unsafe redirects", async () => {
    await expect(
      _internals.fetchTimedTextContent("https://evil.test/sub.vtt", {
        fetchImpl: vi.fn(),
      }),
    ).rejects.toThrow(/untrusted subtitle URL/)

    const fetchImpl = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.test/sub.vtt" },
      })
    })

    await expect(
      _internals.fetchTimedTextContent(
        "https://api-media-core.jesusfilm.org/sub.vtt",
        { fetchImpl },
      ),
    ).rejects.toThrow(/untrusted subtitle URL/)
  })
})
