import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { retrieveAssetMock, signPlaybackIdMock, writeArtifactMock } = vi.hoisted(
  () => ({
    retrieveAssetMock: vi.fn(),
    signPlaybackIdMock: vi.fn(),
    writeArtifactMock: vi.fn(),
  }),
)

vi.mock("@/services/mux", () => ({
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
}))

vi.mock("@/services/storage", () => ({
  writeArtifact: writeArtifactMock,
}))

import {
  buildMuxTextTrackUrl,
  transcribe,
  waitForReadySubtitleTrack,
} from "@/services/transcription"

describe("transcription", () => {
  beforeEach(() => {
    retrieveAssetMock.mockReset()
    signPlaybackIdMock.mockReset()
    writeArtifactMock.mockReset()
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
})
