import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { extractSourceAudioMock, fetchMock, writeArtifactMock, runCommandMock } =
  vi.hoisted(() => ({
    extractSourceAudioMock: vi.fn(),
    fetchMock: vi.fn(),
    writeArtifactMock: vi.fn(),
    runCommandMock: vi.fn(),
  }))

vi.mock("@/config/env", () => ({
  env: {
    ELEVENLABS_API_KEY: "test-elevenlabs-key",
  },
}))

vi.mock("@/services/storage", () => ({
  writeArtifact: writeArtifactMock,
}))

import {
  cleanupAudioForReview,
  extractSourceAudioFromVideoUrl,
  runAudioCleanup,
} from "@/services/audioCleanup"

describe("runAudioCleanup", () => {
  beforeEach(() => {
    extractSourceAudioMock.mockReset()
    fetchMock.mockReset()
    writeArtifactMock.mockReset()

    writeArtifactMock
      .mockResolvedValueOnce("asset-1/original-audio.mp3")
      .mockResolvedValueOnce("asset-1/cleaned-audio.mp3")

    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("extracts source audio, sends it to ElevenLabs, and writes both artifacts", async () => {
    const originalBytes = new Uint8Array([1, 2, 3, 4])
    const cleanedBytes = new Uint8Array([9, 8, 7, 6])

    extractSourceAudioMock.mockResolvedValue(originalBytes)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "audio/mpeg",
      }),
      arrayBuffer: async () => cleanedBytes.buffer.slice(0),
    })

    const result = await runAudioCleanup(
      {
        assetId: "asset-1",
        sourceVideoUrl: "https://example.com/source.mp4",
      },
      {
        extractSourceAudio: extractSourceAudioMock,
      },
    )

    expect(extractSourceAudioMock).toHaveBeenCalledWith(
      "https://example.com/source.mp4",
    )
    expect(writeArtifactMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        assetId: "asset-1",
        artifactType: "original-audio",
        ext: "mp3",
        contentType: "audio/mpeg",
      }),
    )
    expect(writeArtifactMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        assetId: "asset-1",
        artifactType: "cleaned-audio",
        ext: "mp3",
        contentType: "audio/mpeg",
      }),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe("https://api.elevenlabs.io/v1/audio-isolation")
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "xi-api-key": "test-elevenlabs-key",
      },
    })
    expect(init?.body).toBeInstanceOf(FormData)

    const body = init?.body as FormData
    expect(body.get("file_format")).toBe("other")

    const audioFile = body.get("audio")
    expect(audioFile).toBeTruthy()
    expect(audioFile).toBeInstanceOf(Blob)
    const sentBytes = new Uint8Array(await (audioFile as Blob).arrayBuffer())
    expect(Array.from(sentBytes)).toEqual(Array.from(originalBytes))

    expect(result).toEqual({
      originalAudioArtifactKey: "asset-1/original-audio.mp3",
      cleanedAudioArtifactKey: "asset-1/cleaned-audio.mp3",
      artifactKeys: ["original-audio", "cleaned-audio"],
    })
  })

  it("rejects when ELEVENLABS_API_KEY is missing", async () => {
    await expect(
      runAudioCleanup(
        {
          assetId: "asset-1",
          sourceVideoUrl: "https://example.com/source.mp4",
        },
        {
          extractSourceAudio: extractSourceAudioMock,
          elevenLabsApiKey: "",
        },
      ),
    ).rejects.toThrow("ELEVENLABS_API_KEY is required for audio cleanup")
  })

  it("surfaces ElevenLabs rejection details without writing the cleaned artifact", async () => {
    extractSourceAudioMock.mockResolvedValue(new Uint8Array([1, 2, 3]))
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      text: async () => "invalid audio payload",
    })

    const cleanupPromise = runAudioCleanup(
      {
        assetId: "asset-1",
        sourceVideoUrl: "https://example.com/source.mp4",
      },
      {
        extractSourceAudio: extractSourceAudioMock,
      },
    )

    await expect(cleanupPromise).rejects.toThrow(
      "ElevenLabs audio isolation failed: 422 Unprocessable Entity - invalid audio payload",
    )
    await expect(cleanupPromise).rejects.toMatchObject({
      artifactKeys: ["original-audio"],
    })

    expect(writeArtifactMock).toHaveBeenCalledTimes(1)
  })

  it("times out clearly when ElevenLabs never responds", async () => {
    vi.useFakeTimers()

    extractSourceAudioMock.mockResolvedValue(new Uint8Array([1, 2, 3]))
    fetchMock.mockImplementation(() => new Promise(() => {}))

    const cleanupPromise = runAudioCleanup(
      {
        assetId: "asset-1",
        sourceVideoUrl: "https://example.com/source.mp4",
      },
      {
        extractSourceAudio: extractSourceAudioMock,
        timeoutMs: 10,
      },
    )

    const timeoutAssertion = expect(cleanupPromise).rejects.toThrow(
      "ElevenLabs audio isolation timed out after 10ms",
    )
    await vi.advanceTimersByTimeAsync(20)
    await timeoutAssertion
  })

  it("derives the review source from the Mux playback URL", async () => {
    const getMuxAssetMock = vi.fn().mockResolvedValue({
      assetId: "mux-1",
      playbackId: "play-1",
      status: "ready",
      duration: 10,
    })

    extractSourceAudioMock.mockResolvedValue(new Uint8Array([1, 2, 3]))
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "audio/mpeg",
      }),
      arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer.slice(0),
    })

    await cleanupAudioForReview(
      {
        assetId: "asset-1",
        muxAssetId: "mux-1",
      },
      {
        getMuxAsset: getMuxAssetMock,
        extractSourceAudio: extractSourceAudioMock,
      },
    )

    expect(getMuxAssetMock).toHaveBeenCalledWith("mux-1")
    expect(extractSourceAudioMock).toHaveBeenCalledWith(
      "https://stream.mux.com/play-1.m3u8",
    )
  })
})

describe("extractSourceAudioFromVideoUrl", () => {
  beforeEach(() => {
    runCommandMock.mockReset()
  })

  it("invokes ffmpeg against the source video URL and returns stdout bytes", async () => {
    const extractedBytes = new Uint8Array([4, 5, 6, 7])

    runCommandMock.mockResolvedValue({
      stdout: extractedBytes,
      stderr: "",
    })

    const bytes = await extractSourceAudioFromVideoUrl(
      "https://example.com/source.mp4",
      {
        runCommand: runCommandMock,
      },
    )

    expect(runCommandMock).toHaveBeenCalledWith("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "https://example.com/source.mp4",
      "-vn",
      "-acodec",
      "libmp3lame",
      "-f",
      "mp3",
      "pipe:1",
    ])
    expect(bytes).toEqual(extractedBytes)
  })

  it("surfaces a runtime-specific error when ffmpeg is unavailable", async () => {
    runCommandMock.mockRejectedValue(
      Object.assign(new Error("not found"), { code: "ENOENT" }),
    )

    await expect(
      extractSourceAudioFromVideoUrl("https://example.com/source.mp4", {
        runCommand: runCommandMock,
      }),
    ).rejects.toThrow(
      "ffmpeg is required to extract original audio for audio_cleanup",
    )
  })
})
