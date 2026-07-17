import { describe, expect, it } from "vitest"
import {
  FfmpegVisualFrameExtractor,
  type FfmpegCommandRunner,
} from "./ffmpeg-visual-frame-extraction.js"
import { VISUAL_FRAME_FINGERPRINT_KIND } from "./visual-fingerprint.js"

describe("FfmpegVisualFrameExtractor", () => {
  it("extracts v2 visual frame hashes from uploaded bytes with an injected runner", async () => {
    const calls: Parameters<FfmpegCommandRunner>[0][] = []
    const runner: FfmpegCommandRunner = async (input) => {
      calls.push(input)
      return {
        stdout: Buffer.concat([
          Buffer.alloc(64, 0),
          Buffer.concat([Buffer.alloc(32, 255), Buffer.alloc(32, 0)]),
        ]),
        stderr: "",
      }
    }
    const extractor = new FfmpegVisualFrameExtractor({
      runCommand: runner,
      maxFrames: 2,
      timeoutMs: 1_234,
    })

    const fingerprints = await extractor.extractFromBytes({
      bytes: Buffer.from("movie-bytes"),
      contentType: "video/mp4",
      durationMilliseconds: 2_000,
    })

    expect(fingerprints).toEqual([
      {
        offsetMilliseconds: 0,
        durationMilliseconds: null,
        payload: {
          kind: VISUAL_FRAME_FINGERPRINT_KIND,
          phash: "0000000000000000",
          frameWidth: 8,
          frameHeight: 8,
        },
      },
      {
        offsetMilliseconds: 1_000,
        durationMilliseconds: null,
        payload: {
          kind: VISUAL_FRAME_FINGERPRINT_KIND,
          phash: "ffffffff00000000",
          frameWidth: 8,
          frameHeight: 8,
        },
      },
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      command: "ffmpeg",
      timeoutMs: 1_234,
    })
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-protocol_whitelist",
        "file,pipe",
        "-vf",
        "fps=1.000000,scale=8:8,format=gray",
        "-frames:v",
        "2",
        "-f",
        "rawvideo",
        "pipe:1",
      ]),
    )
  })

  it("ignores partial raw frames instead of emitting malformed fingerprints", async () => {
    const extractor = new FfmpegVisualFrameExtractor({
      runCommand: async () => ({ stdout: Buffer.alloc(63), stderr: "" }),
      maxFrames: 2,
    })

    await expect(
      extractor.extractFromBytes({
        bytes: Buffer.from("movie-bytes"),
        contentType: "video/mp4",
      }),
    ).resolves.toEqual([])
  })

  it("adds a protocol whitelist for official HTTPS URL extraction", async () => {
    const calls: Parameters<FfmpegCommandRunner>[0][] = []
    const extractor = new FfmpegVisualFrameExtractor({
      runCommand: async (input) => {
        calls.push(input)
        return { stdout: Buffer.alloc(64, 0), stderr: "" }
      },
    })

    await extractor.extractFromUrl({
      url: "https://media.example.com/video.mp4",
    })

    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        "-protocol_whitelist",
        "https,tls,tcp,crypto",
        "-i",
        "https://media.example.com/video.mp4",
      ]),
    )
  })

  it("rejects playlist source types until nested segment URL validation exists", async () => {
    const calls: Parameters<FfmpegCommandRunner>[0][] = []
    const extractor = new FfmpegVisualFrameExtractor({
      runCommand: async (input) => {
        calls.push(input)
        return { stdout: Buffer.alloc(64, 0), stderr: "" }
      },
    })

    await expect(
      extractor.extractFromUrl({
        url: "https://media.example.com/playlist.m3u8",
        mediaSourceType: "HLS",
      }),
    ).rejects.toMatchObject({ code: "media_source_type_unsupported" })
    expect(calls).toEqual([])
  })

  it("rejects unsafe official media URLs before invoking FFmpeg", async () => {
    const calls: Parameters<FfmpegCommandRunner>[0][] = []
    const extractor = new FfmpegVisualFrameExtractor({
      runCommand: async (input) => {
        calls.push(input)
        return { stdout: Buffer.alloc(64, 0), stderr: "" }
      },
    })

    await expect(
      extractor.extractFromUrl({ url: "http://media.example.com/video.mp4" }),
    ).rejects.toMatchObject({ code: "media_url_invalid_protocol" })
    await expect(
      extractor.extractFromUrl({ url: "https://localhost/video.mp4" }),
    ).rejects.toMatchObject({ code: "media_url_private_host" })
    await expect(
      extractor.extractFromUrl({
        url: "https://[::ffff:127.0.0.1]/video.mp4",
      }),
    ).rejects.toMatchObject({ code: "media_url_private_host" })
    await expect(
      extractor.extractFromUrl({
        url: "https://[::ffff:10.0.0.1]/video.mp4",
      }),
    ).rejects.toMatchObject({ code: "media_url_private_host" })
    expect(calls).toEqual([])
  })
})
