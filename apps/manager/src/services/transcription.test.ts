import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  ensureGeneratedSubtitlesForAssetMock,
  retrieveAssetMock,
  readArtifactMock,
  signPlaybackIdMock,
  transcribeViaElevenLabsMock,
  writeArtifactMock,
} = vi.hoisted(() => ({
  ensureGeneratedSubtitlesForAssetMock: vi.fn(),
  retrieveAssetMock: vi.fn(),
  readArtifactMock: vi.fn(),
  signPlaybackIdMock: vi.fn(),
  transcribeViaElevenLabsMock: vi.fn(),
  writeArtifactMock: vi.fn(),
}))

vi.mock("@/services/mux", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/mux")>()

  return {
    ...actual,
    ensureGeneratedSubtitlesForAsset: ensureGeneratedSubtitlesForAssetMock,
    getMux: () => ({
      video: {
        assets: {
          retrieve: retrieveAssetMock,
        },
      },
      jwt: {
        signPlaybackId: signPlaybackIdMock,
      },
    }),
  }
})

vi.mock("@/services/storage", () => ({
  readArtifact: readArtifactMock,
  writeArtifact: writeArtifactMock,
}))

vi.mock("@/services/elevenlabs-transcription", () => ({
  transcribeViaElevenLabs: transcribeViaElevenLabsMock,
  isSupportedElevenLabsLanguage: (value: string | null | undefined) =>
    value === "en" || value === "ru",
}))

import {
  buildMuxTextTrackUrl,
  MuxSubtitleReadinessTimeoutError,
  transcribe,
  transcribeSubtitleUrl,
  waitForReadySubtitleTrack,
} from "@/services/transcription"

describe("transcription", () => {
  beforeEach(() => {
    ensureGeneratedSubtitlesForAssetMock.mockReset()
    retrieveAssetMock.mockReset()
    readArtifactMock.mockReset()
    signPlaybackIdMock.mockReset()
    transcribeViaElevenLabsMock.mockReset()
    writeArtifactMock.mockReset()
    ensureGeneratedSubtitlesForAssetMock.mockResolvedValue(undefined)
    readArtifactMock.mockResolvedValue(new Uint8Array([1, 2, 3]))
    writeArtifactMock.mockResolvedValue("artifact-key")
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("polls until a generated subtitle track is ready", async () => {
    const retrieveAsset = vi
      .fn()
      .mockResolvedValueOnce({
        duration: 12,
        playback_ids: [{ id: "playback-1", policy: "public" }],
        tracks: [
          {
            id: "track-1",
            type: "text",
            text_type: "subtitles",
            text_source: "generated_vod",
            language_code: "ru",
            status: "preparing",
          },
        ],
      })
      .mockResolvedValueOnce({
        duration: 12,
        playback_ids: [{ id: "playback-1", policy: "public" }],
        tracks: [
          {
            id: "track-1",
            type: "text",
            text_type: "subtitles",
            text_source: "generated_vod",
            language_code: "ru",
            status: "ready",
          },
        ],
      })

    const readyTrack = await waitForReadySubtitleTrack("mux-asset-1", "ru", {
      retrieveAsset,
      pollIntervalMs: 0,
      timeoutMs: 100,
    })

    expect(retrieveAsset).toHaveBeenCalledTimes(2)
    expect(readyTrack).toMatchObject({
      playbackId: "playback-1",
      playbackPolicy: "public",
      track: {
        id: "track-1",
        language_code: "ru",
      },
    })
  })

  it("throws a typed timeout while Mux subtitles are still preparing", async () => {
    const retrieveAsset = vi.fn().mockResolvedValue({
      duration: 12,
      playback_ids: [{ id: "playback-1", policy: "public" }],
      tracks: [
        {
          id: "track-1",
          type: "text",
          text_type: "subtitles",
          text_source: "generated_vod",
          language_code: "ru",
          status: "preparing",
        },
      ],
    })

    const error = await waitForReadySubtitleTrack("mux-asset-1", "ru", {
      retrieveAsset,
      pollIntervalMs: 0,
      timeoutMs: 0,
    }).catch((reason) => reason)

    expect(error).toBeInstanceOf(MuxSubtitleReadinessTimeoutError)
    expect(error).toMatchObject({
      muxAssetId: "mux-asset-1",
      language: "ru",
      timeoutMs: 0,
      attempts: 1,
    })
  })

  it("keeps waiting for the requested language instead of selecting a ready wrong-language track", async () => {
    const retrieveAsset = vi
      .fn()
      .mockResolvedValueOnce({
        duration: 12,
        playback_ids: [{ id: "playback-1", policy: "public" }],
        tracks: [
          {
            id: "track-en",
            type: "text",
            text_type: "subtitles",
            text_source: "generated_vod",
            language_code: "en",
            status: "ready",
          },
          {
            id: "track-ru",
            type: "text",
            text_type: "subtitles",
            text_source: "generated_vod",
            language_code: "ru",
            status: "preparing",
          },
        ],
      })
      .mockResolvedValueOnce({
        duration: 12,
        playback_ids: [{ id: "playback-1", policy: "public" }],
        tracks: [
          {
            id: "track-en",
            type: "text",
            text_type: "subtitles",
            text_source: "generated_vod",
            language_code: "en",
            status: "ready",
          },
          {
            id: "track-ru",
            type: "text",
            text_type: "subtitles",
            text_source: "generated_vod",
            language_code: "ru",
            status: "ready",
          },
        ],
      })

    const readyTrack = await waitForReadySubtitleTrack("mux-asset-1", "ru", {
      retrieveAsset,
      pollIntervalMs: 0,
      timeoutMs: 100,
    })

    expect(retrieveAsset).toHaveBeenCalledTimes(2)
    expect(readyTrack.track).toMatchObject({
      id: "track-ru",
      language_code: "ru",
    })
  })

  it("builds public text track urls without a token", async () => {
    await expect(
      buildMuxTextTrackUrl("playback-1", "track-1", "public"),
    ).resolves.toBe("https://stream.mux.com/playback-1/text/track-1.vtt")
  })

  it("fails clearly for signed assets when signing keys are unavailable", async () => {
    await expect(
      buildMuxTextTrackUrl("playback-1", "track-1", "signed"),
    ).rejects.toThrow(
      "Mux signing keys are required to fetch subtitles from signed playback assets.",
    )
  })

  it("fetches VTT subtitles and writes transcript artifacts", async () => {
    retrieveAssetMock.mockResolvedValue({
      duration: 12,
      playback_ids: [{ id: "playback-1", policy: "public" }],
      tracks: [
        {
          id: "track-1",
          type: "text",
          text_type: "subtitles",
          text_source: "generated_vod",
          language_code: "ru",
          status: "ready",
        },
      ],
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        "WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nПривет.\n\n00:00:01.500 --> 00:00:03.000\nКак дела?\n",
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await transcribe("asset-1", "mux-asset-1", "ru")

    expect(fetchMock).toHaveBeenCalledWith(
      "https://stream.mux.com/playback-1/text/track-1.vtt",
      expect.objectContaining({
        signal: expect.any(Object),
      }),
    )
    expect(writeArtifactMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        assetId: "asset-1",
        artifactType: "transcript",
        ext: "json",
      }),
    )
    expect(writeArtifactMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        assetId: "asset-1",
        artifactType: "subtitles",
        ext: "vtt",
      }),
    )
    expect(result).toMatchObject({
      language: "ru",
      text: "Привет. Как дела?",
      artifactKeys: ["transcript", "subtitles"],
    })
    expect(result.segments).toHaveLength(2)
  })

  it("transcribes an admin-supplied subtitle URL without polling Mux", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          "WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nAlready here.\n\n00:00:01.500 --> 00:00:03.000\nNo Mux wait.\n",
          { status: 200 },
        ),
      )
    vi.stubGlobal("fetch", fetchMock)

    const result = await transcribeSubtitleUrl(
      "asset-1",
      "https://cdn.jesusfilm.org/subtitles.vtt",
      "en",
    )

    expect(retrieveAssetMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cdn.jesusfilm.org/subtitles.vtt",
      expect.objectContaining({
        signal: expect.any(Object),
      }),
    )
    expect(writeArtifactMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        assetId: "asset-1",
        artifactType: "transcript",
        ext: "json",
      }),
    )
    expect(writeArtifactMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        assetId: "asset-1",
        artifactType: "subtitles",
        ext: "vtt",
      }),
    )
    expect(result).toMatchObject({
      language: "en",
      text: "Already here. No Mux wait.",
      resolvedProvider: "mux",
      artifactKeys: ["transcript", "subtitles"],
    })
  })

  it("rejects untrusted admin-supplied subtitle URLs before fetch", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      transcribeSubtitleUrl(
        "asset-1",
        "https://cdn.example.com/subtitles.vtt",
        "en",
      ),
    ).rejects.toThrow("Untrusted subtitle URL hostname")

    expect(fetchMock).not.toHaveBeenCalled()
    expect(writeArtifactMock).not.toHaveBeenCalled()
  })

  it("routes automatic supported-language transcription through ElevenLabs", async () => {
    transcribeViaElevenLabsMock.mockResolvedValue({
      text: "Hello world.",
      segments: [{ start: 0, end: 1.2, text: "Hello world." }],
      language: "en",
      diarization: {
        speakerCount: 1,
        segments: [{ speakerId: "speaker_0", start: 0, end: 1.2 }],
      },
    })

    const result = await transcribe("asset-1", "mux-asset-1", "en", {
      requestedProvider: "automatic",
      sourceInputUrl: "https://cdn.example.com/video.mp4",
    })

    expect(transcribeViaElevenLabsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        languageCode: "en",
        sourceUrl: "https://cdn.example.com/video.mp4",
      }),
    )
    expect(result).toMatchObject({
      text: "Hello world.",
      language: "en",
      resolvedProvider: "elevenlabs",
      routingReport: {
        finalProvider: "elevenlabs",
        finalSourceLanguageCode: "en",
        attempts: [
          expect.objectContaining({
            requestedProvider: "automatic",
            resolvedProvider: "elevenlabs",
            status: "completed",
          }),
        ],
      },
    })
  })

  it("uses cleaned audio artifacts as the ElevenLabs transcription input", async () => {
    transcribeViaElevenLabsMock.mockResolvedValue({
      text: "Clean input transcript.",
      segments: [{ start: 0, end: 1.2, text: "Clean input transcript." }],
      language: "en",
    })

    const result = await transcribe("asset-1", "mux-asset-1", "en", {
      requestedProvider: "automatic",
      cleanedAudioArtifact: {
        assetId: "asset-1",
        artifactType: "cleaned-audio",
        ext: "mp3",
      },
    })

    expect(readArtifactMock).toHaveBeenCalledWith(
      "asset-1",
      "cleaned-audio",
      "mp3",
    )
    expect(transcribeViaElevenLabsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isolatedAudio: expect.any(Blob),
        languageCode: "en",
      }),
    )
    expect(transcribeViaElevenLabsMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "sourceUrl",
    )
    expect(result).toMatchObject({
      text: "Clean input transcript.",
      language: "en",
      resolvedProvider: "elevenlabs",
      routingReport: {
        finalProvider: "elevenlabs",
        attempts: [
          expect.objectContaining({
            decisionReason:
              "Automatic routing chose ElevenLabs for the resolved source language using cleaned audio from audio_cleanup.",
          }),
        ],
      },
    })
  })

  it("uses Mux when automatic routing does not have a supported source language", async () => {
    retrieveAssetMock.mockResolvedValue({
      duration: 12,
      playback_ids: [{ id: "playback-1", policy: "public" }],
      tracks: [
        {
          id: "track-1",
          type: "text",
          text_type: "subtitles",
          text_source: "generated_vod",
          language_code: "tlh",
          status: "ready",
        },
      ],
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nnuqneH.\n",
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await transcribe("asset-1", "mux-asset-1", "tlh", {
      requestedProvider: "automatic",
      sourceInputUrl: "https://cdn.example.com/video.mp4",
    })

    expect(ensureGeneratedSubtitlesForAssetMock).toHaveBeenCalledWith(
      "mux-asset-1",
      "tlh",
    )
    expect(transcribeViaElevenLabsMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      resolvedProvider: "mux",
      routingReport: {
        finalProvider: "mux",
        attempts: [
          expect.objectContaining({
            requestedProvider: "automatic",
            resolvedProvider: "mux",
            status: "completed",
            decisionReason:
              "Source language is not supported by ElevenLabs, so automatic routing used Mux.",
          }),
        ],
      },
    })
  })

  it("fails the automatic run when ElevenLabs was selected but did not complete", async () => {
    transcribeViaElevenLabsMock.mockRejectedValue(new Error("scribe timeout"))
    const error = await transcribe("asset-1", "mux-asset-1", "ru", {
      requestedProvider: "automatic",
      sourceInputUrl: "https://cdn.example.com/video.mp4",
    }).catch((reason) => reason)

    expect(error).toMatchObject({
      message: "scribe timeout",
      routingReport: {
        attempts: [
          expect.objectContaining({
            resolvedProvider: "elevenlabs",
            status: "failed",
            fallbackReason: "scribe timeout",
          }),
        ],
      },
    })
    expect(retrieveAssetMock).not.toHaveBeenCalled()
    expect(writeArtifactMock).not.toHaveBeenCalled()
  })

  it("does not silently fall back to Mux for a forced ElevenLabs rerun", async () => {
    transcribeViaElevenLabsMock.mockRejectedValue(new Error("isolation failed"))

    await expect(
      transcribe("asset-1", "mux-asset-1", "en", {
        requestedProvider: "elevenlabs",
        sourceInputUrl: "https://cdn.example.com/video.mp4",
      }),
    ).rejects.toThrow("isolation failed")

    expect(retrieveAssetMock).not.toHaveBeenCalled()
  })

  it("persists routing state when the Mux path fails", async () => {
    ensureGeneratedSubtitlesForAssetMock.mockRejectedValue(
      new Error("mux subtitle generation failed"),
    )

    const error = await transcribe("asset-1", "mux-asset-1", "tlh", {
      requestedProvider: "automatic",
      sourceInputUrl: "https://cdn.example.com/video.mp4",
    }).catch((reason) => reason)

    expect(error).toMatchObject({
      message: "mux subtitle generation failed",
      routingReport: {
        attempts: [
          expect.objectContaining({
            requestedProvider: "automatic",
            resolvedProvider: "mux",
            status: "failed",
            fallbackReason: "mux subtitle generation failed",
          }),
        ],
      },
    })
    expect(writeArtifactMock).not.toHaveBeenCalled()
  })

  it("records a failed attempt when forced ElevenLabs is missing a source url", async () => {
    const error = await transcribe("asset-1", "mux-asset-1", "en", {
      requestedProvider: "elevenlabs",
    }).catch((reason) => reason)

    expect(error).toMatchObject({
      message:
        "ElevenLabs transcription requires a persisted source input URL or cleaned audio artifact.",
      routingReport: {
        attempts: [
          expect.objectContaining({
            requestedProvider: "elevenlabs",
            resolvedProvider: "elevenlabs",
            status: "failed",
            fallbackReason:
              "ElevenLabs transcription requires a persisted source input URL or cleaned audio artifact.",
          }),
        ],
      },
    })
    expect(transcribeViaElevenLabsMock).not.toHaveBeenCalled()
    expect(retrieveAssetMock).not.toHaveBeenCalled()
  })
})
