import { describe, expect, it } from "vitest"
import {
  classifyCommandError,
  CommandFailedError,
  MissingBinaryError,
  probeMedia,
  sourceProtocolWhitelist,
  type RunCommand,
} from "./ffmpeg.js"

describe("sourceProtocolWhitelist", () => {
  it("pins the HLS-over-HTTPS chain by default", () => {
    expect(sourceProtocolWhitelist(false)).toBe("https,tls,tcp,crypto,hls")
  })

  it("appends http ONLY for the non-production loopback case", () => {
    expect(sourceProtocolWhitelist(true)).toBe("https,tls,tcp,crypto,hls,http")
  })
})

describe("classifyCommandError", () => {
  it("classifies ENOENT into a typed MissingBinaryError", () => {
    const enoent = Object.assign(new Error("spawn ffmpeg ENOENT"), {
      code: "ENOENT",
    })
    const classified = classifyCommandError(enoent, "ffmpeg")
    expect(classified).toBeInstanceOf(MissingBinaryError)
    expect(classified.message).toContain("ffmpeg is required for shorts-worker")
    expect((classified as MissingBinaryError).retryable).toBe(false)
  })

  it("passes through other errors unchanged", () => {
    const failure = new CommandFailedError("ffmpeg", 1, "boom")
    expect(classifyCommandError(failure, "ffmpeg")).toBe(failure)
  })
})

function probeOutput(overrides?: {
  streams?: unknown[]
  format?: Record<string, unknown>
}): string {
  return JSON.stringify({
    streams: overrides?.streams ?? [
      {
        codec_type: "video",
        width: 1280,
        height: 720,
        avg_frame_rate: "30/1",
        r_frame_rate: "30/1",
      },
      { codec_type: "audio" },
    ],
    format: overrides?.format ?? { duration: "20.05" },
  })
}

function stubRunCommand(stdout: string): RunCommand {
  return async () => ({ stdout: Buffer.from(stdout), stderr: "" })
}

describe("probeMedia", () => {
  it("parses dimensions, duration, fps, and audio presence", async () => {
    const probe = await probeMedia("/tmp/clip.mp4", {
      runCommand: stubRunCommand(probeOutput()),
    })
    expect(probe).toEqual({
      width: 1280,
      height: 720,
      durationSec: 20.05,
      fps: 30,
      hasAudio: true,
    })
  })

  it("reports hasAudio false when no audio stream exists", async () => {
    const probe = await probeMedia("/tmp/clip.mp4", {
      runCommand: stubRunCommand(
        probeOutput({
          streams: [
            {
              codec_type: "video",
              width: 640,
              height: 360,
              avg_frame_rate: "30000/1001",
            },
          ],
        }),
      ),
    })
    expect(probe.hasAudio).toBe(false)
    expect(probe.fps).toBeCloseTo(29.97, 2)
  })

  it("includes the protocol whitelist flag ONLY when given one", async () => {
    const calls: string[][] = []
    const recordingRunCommand: RunCommand = async (_command, args) => {
      calls.push(args)
      return { stdout: Buffer.from(probeOutput()), stderr: "" }
    }

    await probeMedia("https://stream.mux.com/x.m3u8", {
      runCommand: recordingRunCommand,
      protocolWhitelist: "https,tls,tcp,crypto,hls",
    })
    await probeMedia("/tmp/clip.mp4", { runCommand: recordingRunCommand })

    expect(calls[0]).toContain("-protocol_whitelist")
    expect(calls[0]![calls[0]!.indexOf("-protocol_whitelist") + 1]).toBe(
      "https,tls,tcp,crypto,hls",
    )
    expect(calls[1]).not.toContain("-protocol_whitelist")
  })

  it("throws on missing video stream or unusable duration", async () => {
    await expect(
      probeMedia("/tmp/x.mp4", {
        runCommand: stubRunCommand(
          probeOutput({ streams: [{ codec_type: "audio" }] }),
        ),
      }),
    ).rejects.toThrow(/no video stream/)

    await expect(
      probeMedia("/tmp/x.mp4", {
        runCommand: stubRunCommand(probeOutput({ format: {} })),
      }),
    ).rejects.toThrow(/no usable duration/)
  })

  it("classifies a missing ffprobe binary", async () => {
    const enoentRunCommand: RunCommand = async () => {
      throw Object.assign(new Error("spawn ffprobe ENOENT"), {
        code: "ENOENT",
      })
    }
    await expect(
      probeMedia("/tmp/x.mp4", { runCommand: enoentRunCommand }),
    ).rejects.toBeInstanceOf(MissingBinaryError)
  })
})
