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
    expect(result).toEqual({
      vttSrc: subtitles[0]!.vttSrc,
      compactText: null,
    })
    expect(logWatchServerEvent).toHaveBeenCalledWith(
      "watch_transcript.fetch.failed",
      { reason: "timeout", timeoutMs: 5_000 },
    )
    expect(
      JSON.stringify(vi.mocked(logWatchServerEvent).mock.calls),
    ).not.toContain(subtitles[0]!.vttSrc)
  })
})
