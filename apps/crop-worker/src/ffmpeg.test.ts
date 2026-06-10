import { describe, expect, it } from "vitest"
import {
  classifyCommandError,
  CommandFailedError,
  CommandTimeoutError,
  defaultRunCommand,
  MissingBinaryError,
  probeSource,
  sourceProtocolWhitelist,
  type RunCommand,
} from "./ffmpeg.js"

describe("defaultRunCommand", () => {
  it("captures stdout as a binary-safe buffer and stderr as utf8", async () => {
    const result = await defaultRunCommand("node", [
      "-e",
      "process.stdout.write(Buffer.from([0, 255, 10])); process.stderr.write('warn')",
    ])

    expect([...result.stdout]).toEqual([0, 255, 10])
    expect(result.stderr).toBe("warn")
  })

  it("emits complete stderr lines through onStderrLine, including the trailing partial", async () => {
    const lines: string[] = []
    await defaultRunCommand(
      "node",
      ["-e", "process.stderr.write('line-1\\nline-2\\ntail')"],
      { onStderrLine: (line) => lines.push(line) },
    )

    expect(lines).toEqual(["line-1", "line-2", "tail"])
  })

  it("streams stdout to onStdoutChunk instead of buffering", async () => {
    const chunks: Buffer[] = []
    const result = await defaultRunCommand(
      "node",
      ["-e", "process.stdout.write('streamed')"],
      { onStdoutChunk: (chunk) => chunks.push(chunk) },
    )

    expect(Buffer.concat(chunks).toString("utf8")).toBe("streamed")
    expect(result.stdout.byteLength).toBe(0)
  })

  it("rejects with CommandFailedError on non-zero exit", async () => {
    await expect(
      defaultRunCommand("node", [
        "-e",
        "process.stderr.write('boom'); process.exit(3)",
      ]),
    ).rejects.toThrow(CommandFailedError)
  })

  it("kills the process and rejects with CommandTimeoutError on timeout", async () => {
    await expect(
      defaultRunCommand("node", ["-e", "setTimeout(() => {}, 10_000)"], {
        timeoutMs: 100,
      }),
    ).rejects.toThrow(CommandTimeoutError)
  })

  it("rejects with the spawn error for a missing binary", async () => {
    await expect(
      defaultRunCommand("definitely-not-a-real-binary-xyz", []),
    ).rejects.toMatchObject({ code: "ENOENT" })
  })
})

describe("classifyCommandError", () => {
  it("maps ENOENT to MissingBinaryError naming the binary", () => {
    const enoent = Object.assign(new Error("spawn ffprobe ENOENT"), {
      code: "ENOENT",
    })

    const ffprobeError = classifyCommandError(enoent, "ffprobe")
    expect(ffprobeError).toBeInstanceOf(MissingBinaryError)
    expect(ffprobeError.message).toContain("ffprobe is required")

    const ffmpegError = classifyCommandError(enoent, "ffmpeg")
    expect(ffmpegError.message).toContain("ffmpeg is required")
  })

  it("passes through non-ENOENT errors", () => {
    const original = new Error("other failure")
    expect(classifyCommandError(original, "ffmpeg")).toBe(original)
  })
})

describe("sourceProtocolWhitelist", () => {
  it("returns the HLS-over-HTTPS chain in production", () => {
    expect(sourceProtocolWhitelist(undefined, "production")).toBe(
      "https,tls,tcp,crypto,hls",
    )
  })

  it("adds file outside production so local-path smokes keep working", () => {
    expect(sourceProtocolWhitelist(undefined, "development")).toBe(
      "https,tls,tcp,crypto,hls,file",
    )
    expect(sourceProtocolWhitelist(undefined, "test")).toBe(
      "https,tls,tcp,crypto,hls,file",
    )
  })

  it("prefers the env override in any environment", () => {
    expect(sourceProtocolWhitelist("https,tls,tcp", "production")).toBe(
      "https,tls,tcp",
    )
    expect(sourceProtocolWhitelist("file,pipe", "development")).toBe(
      "file,pipe",
    )
  })
})

describe("probeSource", () => {
  const whitelist = "https,tls,tcp,crypto,hls"

  const ffprobeJson = {
    streams: [
      { codec_type: "audio", duration: "7200.10" },
      { codec_type: "video", width: 1920, height: 1080, duration: "7199.90" },
    ],
    format: { duration: "7200.04" },
  }

  function fakeRunCommand(stdout: unknown): RunCommand {
    return async (command, args) => {
      expect(command).toBe("ffprobe")
      expect(args).toEqual([
        "-v",
        "error",
        "-protocol_whitelist",
        whitelist,
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        "https://stream.example.test/pb.m3u8",
      ])
      return {
        stdout: Buffer.from(JSON.stringify(stdout)),
        stderr: "",
      }
    }
  }

  it("returns dimensions from the first video stream and duration from format", async () => {
    await expect(
      probeSource("https://stream.example.test/pb.m3u8", {
        runCommand: fakeRunCommand(ffprobeJson),
        protocolWhitelist: whitelist,
      }),
    ).resolves.toEqual({ width: 1920, height: 1080, durationSeconds: 7200.04 })
  })

  it("falls back to the video stream duration when format duration is missing", async () => {
    await expect(
      probeSource("https://stream.example.test/pb.m3u8", {
        runCommand: fakeRunCommand({
          streams: ffprobeJson.streams,
          format: {},
        }),
        protocolWhitelist: whitelist,
      }),
    ).resolves.toEqual({ width: 1920, height: 1080, durationSeconds: 7199.9 })
  })

  it("throws when no video stream is present", async () => {
    await expect(
      probeSource("https://stream.example.test/pb.m3u8", {
        runCommand: fakeRunCommand({
          streams: [{ codec_type: "audio" }],
          format: { duration: "10" },
        }),
        protocolWhitelist: whitelist,
      }),
    ).rejects.toThrow(/no video stream/)
  })

  it("throws when no usable duration is present", async () => {
    await expect(
      probeSource("https://stream.example.test/pb.m3u8", {
        runCommand: fakeRunCommand({
          streams: [{ codec_type: "video", width: 100, height: 100 }],
          format: {},
        }),
        protocolWhitelist: whitelist,
      }),
    ).rejects.toThrow(/no usable duration/)
  })

  it("classifies a missing ffprobe binary into MissingBinaryError", async () => {
    const runCommand: RunCommand = async () => {
      throw Object.assign(new Error("spawn ffprobe ENOENT"), {
        code: "ENOENT",
      })
    }

    await expect(
      probeSource("https://stream.example.test/pb.m3u8", { runCommand }),
    ).rejects.toThrow(MissingBinaryError)
  })
})
