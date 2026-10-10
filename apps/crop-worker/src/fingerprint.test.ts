import { describe, expect, it } from "vitest"
import { createJobDeadline, JobDeadlineExceededError } from "./deadline.js"
import { MissingBinaryError, type RunCommand } from "./ffmpeg.js"
import {
  buildShots,
  computeDhash,
  DHASH_FRAME_BYTES,
  FINGERPRINT_ARTIFACT_TYPE,
  parsePtsTime,
  pickRepresentativeHashes,
  runFingerprint,
} from "./fingerprint.js"
import type { Storage, WriteArtifactOptions } from "./storage.js"
import type { FingerprintArtifact } from "./types.js"

function createMemoryStorage(): Storage & {
  writes: WriteArtifactOptions[]
} {
  const writes: WriteArtifactOptions[] = []
  return {
    backend: "local",
    writes,
    async writeArtifact(options) {
      writes.push(options)
      return `${options.assetId}/${options.artifactType}.${options.ext}`
    },
    async writeArtifactFromFile(assetId, artifactType, ext) {
      return `${assetId}/${artifactType}.${ext}`
    },
    async readArtifact() {
      throw new Error("not implemented")
    },
    async artifactExists() {
      return false
    },
  }
}

describe("parsePtsTime", () => {
  it("extracts pts_time seconds from showinfo lines", () => {
    expect(
      parsePtsTime(
        "[Parsed_showinfo_1 @ 0x5614] n:   0 pts: 409600 pts_time:4.000000 duration: 1",
      ),
    ).toBe(4)
    expect(parsePtsTime("... pts_time:12.48 ...")).toBe(12.48)
    expect(parsePtsTime("... pts_time:7 ...")).toBe(7)
  })

  it("returns null for non-showinfo lines", () => {
    expect(parsePtsTime("frame=  100 fps= 25 q=-0.0")).toBeNull()
    expect(parsePtsTime("")).toBeNull()
  })
})

describe("buildShots", () => {
  it("produces a single whole-video shot when there are no boundaries", () => {
    expect(buildShots([], 10, 1.5)).toEqual([
      { shotId: "shot_00001", start: 0, end: 10 },
    ])
  })

  it("splits at boundaries and zero-pads 1-based shot ids", () => {
    expect(buildShots([4, 7.5], 10, 1.5)).toEqual([
      { shotId: "shot_00001", start: 0, end: 4 },
      { shotId: "shot_00002", start: 4, end: 7.5 },
      { shotId: "shot_00003", start: 7.5, end: 10 },
    ])
  })

  it("merges shots shorter than minShotSeconds into the previous shot", () => {
    expect(buildShots([4, 4.5], 10, 1.5)).toEqual([
      { shotId: "shot_00001", start: 0, end: 4.5 },
      { shotId: "shot_00002", start: 4.5, end: 10 },
    ])
  })

  it("keeps a short first shot when there is no previous shot", () => {
    expect(buildShots([0.5], 10, 1.5)).toEqual([
      { shotId: "shot_00001", start: 0, end: 0.5 },
      { shotId: "shot_00002", start: 0.5, end: 10 },
    ])
  })

  it("ignores boundaries outside (0, duration) and duplicates", () => {
    expect(buildShots([0, 4, 4, 10, 12], 10, 1.5)).toEqual([
      { shotId: "shot_00001", start: 0, end: 4 },
      { shotId: "shot_00002", start: 4, end: 10 },
    ])
  })
})

describe("computeDhash", () => {
  const increasingRow = [10, 20, 30, 40, 50, 60, 70, 80, 90]
  const decreasingRow = [90, 80, 70, 60, 50, 40, 30, 20, 10]
  const spikeRow = [50, 10, 10, 10, 10, 10, 10, 10, 10]

  it("returns all-zero hash for a left-to-right increasing gradient", () => {
    const frame = Buffer.from(Array(8).fill(increasingRow).flat())
    expect(computeDhash(frame)).toBe("0000000000000000")
  })

  it("returns all-ones hash for a decreasing gradient", () => {
    const frame = Buffer.from(Array(8).fill(decreasingRow).flat())
    expect(computeDhash(frame)).toBe("ffffffffffffffff")
  })

  it("packs row bits MSB-first into 16 lowercase hex chars", () => {
    const frame = Buffer.from(
      [
        increasingRow,
        decreasingRow,
        spikeRow,
        spikeRow,
        spikeRow,
        spikeRow,
        spikeRow,
        spikeRow,
      ].flat(),
    )
    // Row 0: no bits. Row 1: all bits. Rows 2-7: only col 0 (MSB) set.
    expect(computeDhash(frame)).toBe("00ff808080808080")
  })

  it("rejects frames that are not 72 bytes", () => {
    expect(() => computeDhash(Buffer.alloc(DHASH_FRAME_BYTES - 1))).toThrow(
      /72 bytes/,
    )
  })
})

describe("pickRepresentativeHashes", () => {
  const samples = Array.from({ length: 10 }, (_, index) => ({
    time: index + 0.5,
    dhash: `hash-${index}`,
  }))

  it("picks nearest samples to start+0.5, midpoint, and end-0.5", () => {
    expect(pickRepresentativeHashes({ start: 0, end: 9 }, samples)).toEqual([
      { time: 0.5, dhash: "hash-0" },
      { time: 4.5, dhash: "hash-4" },
      { time: 8.5, dhash: "hash-8" },
    ])
  })

  it("dedupes when targets resolve to the same sample", () => {
    expect(pickRepresentativeHashes({ start: 2, end: 3 }, samples)).toEqual([
      { time: 2.5, dhash: "hash-2" },
    ])
  })

  it("returns an empty list when there are no samples", () => {
    expect(pickRepresentativeHashes({ start: 0, end: 10 }, [])).toEqual([])
  })
})

describe("runFingerprint", () => {
  const sourceUrl = "https://stream.example.test/pb.m3u8"
  const whitelist = "https,tls,tcp,crypto,hls"

  function buildFrame(row: number[]): Buffer {
    return Buffer.from(Array(8).fill(row).flat())
  }

  const increasingFrame = buildFrame([10, 20, 30, 40, 50, 60, 70, 80, 90])
  const decreasingFrame = buildFrame([90, 80, 70, 60, 50, 40, 30, 20, 10])

  function createFakeRunCommand(): RunCommand {
    return async (command, args, options = {}) => {
      if (command === "ffprobe") {
        return {
          stdout: Buffer.from(
            JSON.stringify({
              streams: [{ codec_type: "video", width: 1920, height: 1080 }],
              format: { duration: "10" },
            }),
          ),
          stderr: "",
        }
      }

      expect(command).toBe("ffmpeg")

      if (args.includes("null")) {
        expect(args).toEqual([
          "-protocol_whitelist",
          whitelist,
          "-i",
          sourceUrl,
          "-vf",
          "select='gt(scene,0.3)',showinfo",
          "-an",
          "-f",
          "null",
          "-",
        ])
        options.onStderrLine?.(
          "[Parsed_showinfo_1 @ 0x1] n: 0 pts: 1 pts_time:4.000000 duration: 1",
        )
        options.onStderrLine?.("frame= 100 fps= 25 (progress noise)")
        options.onStderrLine?.(
          "[Parsed_showinfo_1 @ 0x1] n: 1 pts: 2 pts_time:4.500000 duration: 1",
        )
        return { stdout: Buffer.alloc(0), stderr: "" }
      }

      expect(args).toEqual([
        "-protocol_whitelist",
        whitelist,
        "-i",
        sourceUrl,
        "-vf",
        "fps=1,scale=9:8:flags=area,format=gray",
        "-f",
        "rawvideo",
        "pipe:1",
      ])

      // 10 frames; frame index 7 (time 7.5) uses the decreasing gradient.
      const frames = Array.from({ length: 10 }, (_, index) =>
        index === 7 ? decreasingFrame : increasingFrame,
      )
      const stream = Buffer.concat(frames)
      // Emit in 100-byte chunks to exercise frame reassembly across chunks.
      for (let offset = 0; offset < stream.byteLength; offset += 100) {
        options.onStdoutChunk?.(stream.subarray(offset, offset + 100))
      }
      return { stdout: Buffer.alloc(0), stderr: "" }
    }
  }

  it("writes the fingerprint artifact per contract and returns the summary", async () => {
    const storage = createMemoryStorage()
    const summary = await runFingerprint({
      assetId: "asset123",
      sourceUrl,
      deps: {
        runCommand: createFakeRunCommand(),
        storage,
        sceneThreshold: 0.3,
        minShotSeconds: 1.5,
        protocolWhitelist: whitelist,
        now: () => new Date("2026-06-09T00:00:00.000Z"),
      },
    })

    expect(summary).toEqual({
      shotCount: 2,
      durationSeconds: 10,
      width: 1920,
      height: 1080,
    })

    expect(storage.writes).toHaveLength(1)
    const write = storage.writes[0]!
    expect(write.assetId).toBe("asset123")
    expect(write.artifactType).toBe(FINGERPRINT_ARTIFACT_TYPE)
    expect(write.ext).toBe("json")
    expect(write.contentType).toBe("application/json")

    const artifact = JSON.parse(write.body as string) as FingerprintArtifact
    expect(artifact.version).toBe(1)
    expect(artifact.kind).toBe("smart-crop-fingerprint")
    expect(artifact.tool).toBe("crop-worker-fingerprint-v1")
    expect(artifact.assetId).toBe("asset123")
    expect(artifact.source).toEqual({
      width: 1920,
      height: 1080,
      durationSeconds: 10,
    })
    expect(artifact.sampling).toEqual({
      hashFps: 1,
      hashSize: 8,
      sceneThreshold: 0.3,
    })
    expect(artifact.generatedAt).toBe("2026-06-09T00:00:00.000Z")

    // Boundary at 4.5 creates a 0.5s shot that merges into the previous one.
    expect(
      artifact.shots.map((shot) => [shot.shotId, shot.start, shot.end]),
    ).toEqual([
      ["shot_00001", 0, 4.5],
      ["shot_00002", 4.5, 10],
    ])

    const [first, second] = artifact.shots
    expect(first!.representativeHashes.length).toBeGreaterThan(0)
    expect(first!.representativeHashes.length).toBeLessThanOrEqual(3)
    for (const sample of first!.representativeHashes) {
      expect(sample.dhash).toBe("0000000000000000")
    }

    // Shot 2's midpoint target (7.25) resolves to the decreasing frame at 7.5.
    expect(
      second!.representativeHashes.some(
        (sample) => sample.dhash === "ffffffffffffffff" && sample.time === 7.5,
      ),
    ).toBe(true)
  })

  it("classifies a missing ffmpeg binary into MissingBinaryError", async () => {
    const storage = createMemoryStorage()
    const runCommand: RunCommand = async (command) => {
      if (command === "ffprobe") {
        return {
          stdout: Buffer.from(
            JSON.stringify({
              streams: [{ codec_type: "video", width: 100, height: 100 }],
              format: { duration: "5" },
            }),
          ),
          stderr: "",
        }
      }
      throw Object.assign(new Error("spawn ffmpeg ENOENT"), {
        code: "ENOENT",
      })
    }

    await expect(
      runFingerprint({
        assetId: "asset123",
        sourceUrl,
        deps: { runCommand, storage },
      }),
    ).rejects.toThrow(MissingBinaryError)
    expect(storage.writes).toHaveLength(0)
  })

  it("fails with JobDeadlineExceededError between passes and caps the probe timeout at the remaining budget", async () => {
    const storage = createMemoryStorage()
    let nowMs = 0
    const timeouts: Array<number | undefined> = []
    const commands: string[] = []
    // Each invocation "takes" 60ms against a 100ms job budget: probe + pass 1
    // fit, the dhash pass must never be invoked.
    const runCommand: RunCommand = async (command, _args, options = {}) => {
      commands.push(command)
      timeouts.push(options.timeoutMs)
      nowMs += 60
      if (command === "ffprobe") {
        return {
          stdout: Buffer.from(
            JSON.stringify({
              streams: [{ codec_type: "video", width: 1920, height: 1080 }],
              format: { duration: "10" },
            }),
          ),
          stderr: "",
        }
      }
      return { stdout: Buffer.alloc(0), stderr: "" }
    }

    const promise = runFingerprint({
      assetId: "asset123",
      sourceUrl,
      deps: {
        runCommand,
        storage,
        timeoutMs: 1_000,
        deadline: createJobDeadline(100, () => nowMs),
      },
    })
    await expect(promise).rejects.toThrow(JobDeadlineExceededError)
    await expect(promise).rejects.toThrow(/job deadline exceeded/)

    expect(commands).toEqual(["ffprobe", "ffmpeg"])
    // Probe at t=0: min(120s default cap, 100 remaining); pass 1 at t=60:
    // min(1000, 40).
    expect(timeouts).toEqual([100, 40])
    expect(storage.writes).toHaveLength(0)
  })
})
