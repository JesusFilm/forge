import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {
    ELEVENLABS_API_KEY: "test-elevenlabs-key",
    ELEVENLABS_REQUEST_TIMEOUT_MS: 30_000,
    ELEVENLABS_SOURCE_DOWNLOAD_TIMEOUT_MS: 30_000,
  },
}))

import { transcribeViaElevenLabs } from "@/services/elevenlabs-transcription"

describe("elevenlabs transcription", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("downloads source media, isolates audio, and maps Scribe words into canonical transcript segments", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "video/mp4" }),
        blob: async () => new Blob(["video"], { type: "video/mp4" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "audio/mpeg" }),
        blob: async () => new Blob(["isolated"], { type: "audio/mpeg" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          language_code: "en",
          text: "Hello world.",
          words: [
            {
              text: "Hello",
              start: 0,
              end: 0.4,
              type: "word",
              speaker_id: "speaker_0",
            },
            {
              text: " ",
              start: 0.4,
              end: 0.5,
              type: "spacing",
              speaker_id: "speaker_0",
            },
            {
              text: "world.",
              start: 0.5,
              end: 1.1,
              type: "word",
              speaker_id: "speaker_0",
            },
          ],
        }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const result = await transcribeViaElevenLabs({
      sourceUrl: "https://stream.mux.com/playback-1/720p.mp4?token=secret",
      languageCode: "en",
      keyterms: ["Jesus Film"],
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://stream.mux.com/playback-1/720p.mp4?token=secret",
      expect.objectContaining({
        signal: expect.any(Object),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.elevenlabs.io/v1/audio-isolation",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "xi-api-key": "test-elevenlabs-key",
        }),
        body: expect.any(FormData),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.elevenlabs.io/v1/speech-to-text",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "xi-api-key": "test-elevenlabs-key",
        }),
        body: expect.any(FormData),
      }),
    )

    const speechRequest = fetchMock.mock.calls[2]?.[1] as {
      body?: FormData
    }
    expect(speechRequest.body?.get("model_id")).toBe("scribe_v2")
    expect(speechRequest.body?.get("language_code")).toBe("en")
    expect(speechRequest.body?.get("diarize")).toBe("true")
    expect(speechRequest.body?.get("timestamps_granularity")).toBe("word")
    expect(speechRequest.body?.getAll("keyterms")).toEqual(["Jesus Film"])

    expect(result).toMatchObject({
      text: "Hello world.",
      language: "en",
      segments: [{ start: 0, end: 1.1, text: "Hello world." }],
      diarization: {
        speakerCount: 1,
        segments: [{ speakerId: "speaker_0", start: 0, end: 1.1 }],
      },
    })
  })

  it("rejects untrusted source URLs before attempting to download them", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      transcribeViaElevenLabs({
        sourceUrl: "https://cdn.example.com/video.mp4",
        languageCode: "en",
      }),
    ).rejects.toThrow(
      "ElevenLabs source media must come from a trusted downloadable MP4 URL.",
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sends provided isolated audio directly to Scribe", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        language_code: "en",
        text: "Clean audio transcript.",
        words: [
          {
            text: "Clean",
            start: 0,
            end: 0.4,
            type: "word",
            speaker_id: "speaker_0",
          },
          {
            text: " audio transcript.",
            start: 0.4,
            end: 1.2,
            type: "word",
            speaker_id: "speaker_0",
          },
        ],
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await transcribeViaElevenLabs({
      isolatedAudio: new Blob(["isolated"], { type: "audio/mpeg" }),
      languageCode: "en",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/speech-to-text",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
      }),
    )
    expect(result).toMatchObject({
      text: "Clean audio transcript.",
      language: "en",
    })
  })

  it("fails clearly when ElevenLabs rejects the transcription request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "video/mp4" }),
        blob: async () => new Blob(["video"], { type: "video/mp4" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "audio/mpeg" }),
        blob: async () => new Blob(["isolated"], { type: "audio/mpeg" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => '{"detail":"bad request"}',
      })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      transcribeViaElevenLabs({
        sourceUrl: "https://api-media-core.jesusfilm.org/video.mp4",
        languageCode: "en",
      }),
    ).rejects.toThrow("ElevenLabs speech-to-text failed: 422")
  })
})
