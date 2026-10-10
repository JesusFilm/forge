import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}))
vi.mock("@/lib/watch-observability", () => ({
  logWatchServerEvent: vi.fn(),
}))

import { getInitialSubtitleTranscript } from "./watch-transcript"
import { logWatchServerEvent } from "@/lib/watch-observability"

const subtitles = [
  {
    documentId: "subtitle-1",
    language: {
      slug: "english",
      name: "English",
      nativeName: null,
      bcp47: "en",
    },
    vttSrc: "https://media.example.org/transcript.vtt",
    primary: true,
    aiGenerated: false,
  },
]

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("getInitialSubtitleTranscript", () => {
  it("uses a five-second abort deadline and logs a timeout without the source URL", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
    const fetchSpy = vi
      .fn()
      .mockRejectedValue(
        new DOMException("The operation timed out", "TimeoutError"),
      )
    vi.stubGlobal("fetch", fetchSpy)

    const result = await getInitialSubtitleTranscript({
      subtitles,
      audioSlug: "english",
    })

    expect(timeoutSpy).toHaveBeenCalledWith(5_000)
    expect(fetchSpy).toHaveBeenCalledWith(
      subtitles[0]!.vttSrc,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect((fetchSpy.mock.calls[0]?.[1] as RequestInit).signal).toBe(
      timeoutSpy.mock.results[0]?.value,
    )
    expect(result).toEqual({
      vttSrc: subtitles[0]!.vttSrc,
      compactText: null,
    })
    expect(logWatchServerEvent).toHaveBeenCalledWith(
      "watch_transcript.fetch.failed",
      expect.objectContaining({ reason: "timeout", timeoutMs: 5_000 }),
    )
    expect(
      JSON.stringify(vi.mocked(logWatchServerEvent).mock.calls),
    ).not.toContain(subtitles[0]!.vttSrc)
  })

  it("returns the compact transcript when the VTT request succeeds", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello",
    })
    vi.stubGlobal("fetch", fetchSpy)

    await expect(
      getInitialSubtitleTranscript({ subtitles, audioSlug: "english" }),
    ).resolves.toEqual({
      vttSrc: subtitles[0]!.vttSrc,
      compactText: "Hello",
    })
    expect(logWatchServerEvent).not.toHaveBeenCalled()
  })

  it("logs an HTTP failure without retaining the VTT URL", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    vi.stubGlobal("fetch", fetchSpy)

    const result = await getInitialSubtitleTranscript({
      subtitles,
      audioSlug: "english",
    })

    expect(result).toEqual({ vttSrc: subtitles[0]!.vttSrc, compactText: null })
    expect(logWatchServerEvent).toHaveBeenCalledWith(
      "watch_transcript.fetch.failed",
      expect.objectContaining({ reason: "request_failed", timeoutMs: 5_000 }),
    )
    expect(
      JSON.stringify(vi.mocked(logWatchServerEvent).mock.calls),
    ).not.toContain(subtitles[0]!.vttSrc)
  })
})
