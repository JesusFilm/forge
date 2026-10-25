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

  it("input-seeks to all twelve declared offsets in one ordered command", async () => {
    const calls: Parameters<FfmpegCommandRunner>[0][] = []
    const extractor = new FfmpegVisualFrameExtractor({
      adaptiveSeeking: true,
      runCommand: async (input) => {
        calls.push(input)
        return { stdout: Buffer.alloc(64 * 12), stderr: "" }
      },
    })

    const fingerprints = await extractor.extractFromUrl({
      url: "https://media.example.com/video.mp4",
      durationMilliseconds: 600_000,
    })

    expect(fingerprints).toHaveLength(12)
    expect(
      fingerprints.map(({ offsetMilliseconds }) => offsetMilliseconds),
    ).toEqual([
      0, 50_000, 100_000, 150_000, 200_000, 250_000, 300_000, 350_000, 400_000,
      450_000, 500_000, 550_000,
    ])
    expect(calls).toHaveLength(1)
    const args = calls[0]!.args
    expect(args.filter((arg) => arg === "-protocol_whitelist")).toHaveLength(12)
    const seekIndices = args.flatMap((arg, index) =>
      arg === "-ss" ? [index] : [],
    )
    const inputIndices = args.flatMap((arg, index) =>
      arg === "-i" ? [index] : [],
    )
    expect(seekIndices).toHaveLength(12)
    expect(inputIndices).toHaveLength(12)
    for (const [index, seekIndex] of seekIndices.entries()) {
      const inputIndex = inputIndices[index]!
      expect(seekIndex).toBeLessThan(inputIndex)
      expect(args[seekIndex + 1]).toBe((index * 50).toFixed(3))
      expect(args.slice(seekIndex - 2, seekIndex)).toEqual([
        "-protocol_whitelist",
        "https,tls,tcp,crypto",
      ])
      expect(args[inputIndex + 1]).toBe("https://media.example.com/video.mp4")
    }
    const filterGraph = args[args.indexOf("-filter_complex") + 1]
    expect(filterGraph).toContain(
      "[0:v]trim=end_frame=1,scale=8:8,format=gray,setpts=PTS-STARTPTS[v0]",
    )
    expect(filterGraph).toContain(
      "[v0][v1][v2][v3][v4][v5][v6][v7][v8][v9][v10][v11]concat=n=12:v=1:a=0[out]",
    )
    expect(args.slice(args.indexOf("-map"))).toEqual([
      "-map",
      "[out]",
      "-vsync",
      "0",
      "-frames:v",
      "12",
      "-f",
      "rawvideo",
      "pipe:1",
    ])
  })

  it("uses one timeout budget for the consolidated long-media command", async () => {
    const calls: Parameters<FfmpegCommandRunner>[0][] = []
    const extractor = new FfmpegVisualFrameExtractor({
      adaptiveSeeking: true,
      maxFrames: 4,
      timeoutMs: 1_000,
      runCommand: async (input) => {
        calls.push(input)
        return { stdout: Buffer.alloc(64 * 4), stderr: "" }
      },
    })

    await expect(
      extractor.extractFromBytes({
        bytes: Buffer.from("movie-bytes"),
        contentType: "video/mp4",
        durationMilliseconds: 600_000,
      }),
    ).resolves.toHaveLength(4)
    expect(calls.map(({ timeoutMs }) => timeoutMs)).toEqual([1_000])
  })

  it("fails the entire long-media extraction when consolidated output is incomplete", async () => {
    let calls = 0
    const extractor = new FfmpegVisualFrameExtractor({
      adaptiveSeeking: true,
      runCommand: async () => {
        calls += 1
        return { stdout: Buffer.alloc(64 * 12 - 1), stderr: "" }
      },
    })

    await expect(
      extractor.extractFromBytes({
        bytes: Buffer.from("movie-bytes"),
        contentType: "video/mp4",
        durationMilliseconds: 600_000,
      }),
    ).rejects.toMatchObject({ code: "ffmpeg_incomplete_frames" })
    expect(calls).toBe(1)
  })

  it("keeps short, unknown-duration, and opt-out long media on the single-pass path", async () => {
    const calls: Parameters<FfmpegCommandRunner>[0][] = []
    const runner: FfmpegCommandRunner = async (input) => {
      calls.push(input)
      return { stdout: Buffer.alloc(64 * 12), stderr: "" }
    }
    const adaptiveExtractor = new FfmpegVisualFrameExtractor({
      adaptiveSeeking: true,
      runCommand: runner,
    })
    const legacyExtractor = new FfmpegVisualFrameExtractor({
      runCommand: runner,
    })

    await adaptiveExtractor.extractFromBytes({
      bytes: Buffer.from("short-movie"),
      contentType: "video/mp4",
      durationMilliseconds: 120_000,
    })
    await adaptiveExtractor.extractFromBytes({
      bytes: Buffer.from("unknown-movie"),
      contentType: "video/mp4",
      durationMilliseconds: null,
    })
    await legacyExtractor.extractFromBytes({
      bytes: Buffer.from("long-movie"),
      contentType: "video/mp4",
      durationMilliseconds: 600_000,
    })

    expect(calls).toHaveLength(3)
    for (const call of calls) {
      const filterIndex = call.args.indexOf("-vf")
      expect(call.args).not.toContain("-ss")
      expect(call.args[filterIndex + 1]).toMatch(/^fps=/)
      expect(call.args[call.args.indexOf("-frames:v") + 1]).toBe("12")
    }
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
