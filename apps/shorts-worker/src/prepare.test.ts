import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { RunCommand } from "./ffmpeg.js"
import {
  buildTrimArgs,
  buildWavExtractArgs,
  CAPTIONS_ARTIFACT_TYPE,
  CLIP_ARTIFACT_TYPE,
  CLIP_META_ARTIFACT_TYPE,
  clampClipBounds,
  ClipOutOfRangeError,
  runPrepare,
  TRANSCRIPTION_SKIPPED_NO_AUDIO,
  TRANSCRIPTION_UNSUPPORTED_LANGUAGE,
} from "./prepare.js"
import { SourceUrlRejectedError } from "./source-url.js"
import { createStorage, type Storage } from "./storage.js"
import type { CaptionsArtifact, ClipMetaArtifact } from "./types.js"
import type { TranscribeClip } from "./whisper.js"

const SOURCE_URL = "https://stream.mux.com/pb_abc.m3u8"
const ALLOWED = ["stream.mux.com"]

describe("clampClipBounds", () => {
  it("passes through bounds inside the probed duration", () => {
    expect(
      clampClipBounds({ startSec: 5, endSec: 15, sourceDurationSec: 120 }),
    ).toEqual({ startSec: 5, endSec: 15 })
  })

  it("clamps endSec beyond the probed duration (never trusts the caller)", () => {
    expect(
      clampClipBounds({ startSec: 100, endSec: 999, sourceDurationSec: 120 }),
    ).toEqual({ startSec: 100, endSec: 120 })
  })

  it("clamps negative startSec to 0", () => {
    expect(
      clampClipBounds({ startSec: -3, endSec: 10, sourceDurationSec: 120 }),
    ).toEqual({ startSec: 0, endSec: 10 })
  })

  it("throws typed ClipOutOfRangeError when nothing overlaps", () => {
    expect(() =>
      clampClipBounds({ startSec: 200, endSec: 240, sourceDurationSec: 120 }),
    ).toThrow(ClipOutOfRangeError)
  })
})

describe("buildTrimArgs — argv contract (plan decision 9)", () => {
  const args = buildTrimArgs({
    sourceUrl: SOURCE_URL,
    startSec: 5,
    durationSec: 10,
    protocolWhitelist: "https,tls,tcp,crypto,hls",
    outputPath: "/tmp/clip.mp4",
  })

  it("puts -ss BEFORE -i (input-seek — REQUIRED, never output-seek)", () => {
    expect(args.indexOf("-ss")).toBeGreaterThan(-1)
    expect(args.indexOf("-i")).toBeGreaterThan(-1)
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"))
  })

  it("pins explicit stream mapping (one video, at-most-one audio)", () => {
    const mapIndices = args
      .map((value, index) => (value === "-map" ? index : -1))
      .filter((index) => index >= 0)
    expect(mapIndices).toHaveLength(2)
    expect(args[mapIndices[0]! + 1]).toBe("0:v:0")
    expect(args[mapIndices[1]! + 1]).toBe("0:a:0?")
  })

  it("passes the source protocol whitelist", () => {
    const index = args.indexOf("-protocol_whitelist")
    expect(index).toBeGreaterThan(-1)
    expect(args[index + 1]).toBe("https,tls,tcp,crypto,hls")
  })

  it("re-encodes to the intermediate contract (30fps yuv420p faststart)", () => {
    expect(args).toContain("libx264")
    expect(args[args.indexOf("-preset") + 1]).toBe("veryfast")
    expect(args[args.indexOf("-crf") + 1]).toBe("17")
    expect(args[args.indexOf("-r") + 1]).toBe("30")
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuv420p")
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart")
    expect(args[args.indexOf("-t") + 1]).toBe("10")
  })
})

describe("buildWavExtractArgs", () => {
  it("extracts 16kHz mono s16 WAV without the source whitelist", () => {
    const args = buildWavExtractArgs({
      clipPath: "/tmp/clip.mp4",
      wavPath: "/tmp/clip.wav",
    })
    expect(args[args.indexOf("-ar") + 1]).toBe("16000")
    expect(args[args.indexOf("-ac") + 1]).toBe("1")
    expect(args[args.indexOf("-c:a") + 1]).toBe("pcm_s16le")
    expect(args).toContain("-vn")
    expect(args).not.toContain("-protocol_whitelist")
  })
})

type FakeRunCommandOptions = {
  sourceDurationSec?: number
  clipHasAudio?: boolean
  clipDurationSec?: number
}

function createFakeRunCommand(options: FakeRunCommandOptions = {}) {
  const calls: Array<{ command: string; args: string[] }> = []
  const sourceDurationSec = options.sourceDurationSec ?? 120
  const clipHasAudio = options.clipHasAudio ?? true
  const clipDurationSec = options.clipDurationSec ?? 10

  const runCommand: RunCommand = async (command, args) => {
    calls.push({ command, args })

    if (command === "ffprobe") {
      const input = args[args.length - 1]!
      const probingSource = input === SOURCE_URL
      const body = {
        streams: [
          {
            codec_type: "video",
            width: probingSource ? 1920 : 1280,
            height: probingSource ? 1080 : 720,
            avg_frame_rate: "30/1",
          },
          ...(probingSource || clipHasAudio ? [{ codec_type: "audio" }] : []),
        ],
        format: {
          duration: String(probingSource ? sourceDurationSec : clipDurationSec),
        },
      }
      return { stdout: Buffer.from(JSON.stringify(body)), stderr: "" }
    }

    // ffmpeg: create the requested output file (trim or WAV) so the
    // pipeline's later reads/copies succeed.
    const outputPath = args[args.length - 1]!
    await writeFile(outputPath, Buffer.from(`fake:${outputPath}`))
    return { stdout: Buffer.alloc(0), stderr: "" }
  }

  return { runCommand, calls }
}

describe("runPrepare", () => {
  let root: string
  let storage: Storage

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "shorts-worker-prepare-test-"))
    storage = createStorage({ localRootDir: root })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function readJsonArtifact<T>(
    assetId: string,
    artifactType: string,
  ): Promise<T> {
    const raw = await readFile(join(root, assetId, `${artifactType}.json`))
    return JSON.parse(raw.toString("utf8")) as T
  }

  it("rejects a non-allowlisted source BEFORE any subprocess spawn", async () => {
    const { runCommand, calls } = createFakeRunCommand()

    await expect(
      runPrepare({
        assetId: "asset1",
        sourceUrl: "https://stream.mux.com.evil.com/x.m3u8",
        clip: { startSec: 0, endSec: 10 },
        language: "en",
        deps: {
          runCommand,
          storage,
          allowedHosts: ALLOWED,
          nodeEnv: "production",
          transcribe: null,
        },
      }),
    ).rejects.toBeInstanceOf(SourceUrlRejectedError)

    expect(calls).toHaveLength(0)
  })

  it("clamps caller bounds against the probed source duration", async () => {
    const { runCommand, calls } = createFakeRunCommand({
      sourceDurationSec: 60,
    })

    await runPrepare({
      assetId: "asset1",
      sourceUrl: SOURCE_URL,
      clip: { startSec: 50, endSec: 500 },
      language: null,
      deps: {
        runCommand,
        storage,
        allowedHosts: ALLOWED,
        nodeEnv: "test",
        transcribe: null,
      },
    })

    const trim = calls.find((call) => call.command === "ffmpeg")!
    // startSec preserved, endSec clamped 500 → 60, so -t = 10.
    expect(trim.args[trim.args.indexOf("-ss") + 1]).toBe("50")
    expect(trim.args[trim.args.indexOf("-t") + 1]).toBe("10")

    const meta = await readJsonArtifact<ClipMetaArtifact>(
      "asset1",
      CLIP_META_ARTIFACT_TYPE,
    )
    expect(meta.clip).toEqual({ startSec: 50, endSec: 60 })
  })

  it("hands ffprobe/ffmpeg the RE-SERIALIZED validated URL, never the raw string", async () => {
    const { runCommand, calls } = createFakeRunCommand()
    // Raw string whose canonical serialization differs (URL lowercases the
    // host): the subprocess argv must carry EXACTLY the string that passed
    // validation — validated.url.toString() — not the caller's raw bytes.
    const rawUrl = "https://STREAM.MUX.COM/pb_abc.m3u8"

    await runPrepare({
      assetId: "asset1",
      sourceUrl: rawUrl,
      clip: { startSec: 5, endSec: 15 },
      language: null,
      deps: {
        runCommand,
        storage,
        allowedHosts: ALLOWED,
        nodeEnv: "test",
        transcribe: null,
      },
    })

    const probe = calls.find((call) => call.command === "ffprobe")!
    expect(probe.args[probe.args.length - 1]).toBe(SOURCE_URL)
    expect(probe.args).not.toContain(rawUrl)

    const trim = calls.find((call) => call.command === "ffmpeg")!
    expect(trim.args[trim.args.indexOf("-i") + 1]).toBe(SOURCE_URL)
    expect(trim.args).not.toContain(rawUrl)
  })

  it("writes clip, meta, and captions artifacts with host-only provenance", async () => {
    const { runCommand } = createFakeRunCommand()
    const fakeTranscribe: TranscribeClip = async () => ({
      captions: [
        {
          text: "Hello",
          startMs: 0,
          endMs: 480,
          timestampMs: 240,
          confidence: 0.97,
        },
        {
          text: " world",
          startMs: 480,
          endMs: 900,
          timestampMs: 700,
          confidence: 0.93,
        },
      ],
    })

    const result = await runPrepare({
      assetId: "asset1",
      sourceUrl: SOURCE_URL,
      clip: { startSec: 5, endSec: 15 },
      language: "en",
      deps: {
        runCommand,
        storage,
        allowedHosts: ALLOWED,
        nodeEnv: "test",
        transcribe: fakeTranscribe,
        now: () => new Date("2026-06-11T00:00:00.000Z"),
      },
    })

    expect(result.artifacts).toEqual([
      { assetId: "asset1", artifactType: CLIP_ARTIFACT_TYPE, ext: "mp4" },
      { assetId: "asset1", artifactType: CLIP_META_ARTIFACT_TYPE, ext: "json" },
      { assetId: "asset1", artifactType: CAPTIONS_ARTIFACT_TYPE, ext: "json" },
    ])
    expect(result.report).toEqual({
      hasAudio: true,
      clipDurationSec: 10,
      captionsCount: 2,
      annotation: null,
    })

    await expect(
      storage.artifactExists("asset1", CLIP_ARTIFACT_TYPE, "mp4"),
    ).resolves.toBe(true)

    const meta = await readJsonArtifact<ClipMetaArtifact>(
      "asset1",
      CLIP_META_ARTIFACT_TYPE,
    )
    // Host ONLY — never the full URL (no path, no query, no playback id).
    expect(meta.sourceHost).toBe("stream.mux.com")
    expect(JSON.stringify(meta)).not.toContain("pb_abc")
    expect(meta).toMatchObject({
      durationSec: 10,
      fps: 30,
      width: 1280,
      height: 720,
      hasAudio: true,
      generatedAt: "2026-06-11T00:00:00.000Z",
    })

    const captions = await readJsonArtifact<CaptionsArtifact>(
      "asset1",
      CAPTIONS_ARTIFACT_TYPE,
    )
    expect(captions.language).toBe("en")
    expect(captions.model).toBe("large-v3-turbo")
    expect(captions.annotation).toBeNull()
    expect(captions.captions).toHaveLength(2)
  })

  it("skips transcription deterministically when the clip has no audio", async () => {
    const { runCommand, calls } = createFakeRunCommand({ clipHasAudio: false })
    let transcribeCalled = false
    const fakeTranscribe: TranscribeClip = async () => {
      transcribeCalled = true
      return { captions: [] }
    }

    const result = await runPrepare({
      assetId: "asset1",
      sourceUrl: SOURCE_URL,
      clip: { startSec: 5, endSec: 15 },
      language: "en",
      deps: {
        runCommand,
        storage,
        allowedHosts: ALLOWED,
        nodeEnv: "test",
        transcribe: fakeTranscribe,
      },
    })

    expect(transcribeCalled).toBe(false)
    expect(result.report.annotation).toBe(TRANSCRIPTION_SKIPPED_NO_AUDIO)
    // No WAV extraction happened: only the trim ffmpeg invocation.
    expect(calls.filter((call) => call.command === "ffmpeg")).toHaveLength(1)

    const captions = await readJsonArtifact<CaptionsArtifact>(
      "asset1",
      CAPTIONS_ARTIFACT_TYPE,
    )
    expect(captions).toMatchObject({
      captions: [],
      language: null,
      model: null,
      annotation: TRANSCRIPTION_SKIPPED_NO_AUDIO,
    })
  })

  it("annotates unsupported language (language null) without calling whisper", async () => {
    const { runCommand } = createFakeRunCommand()

    const result = await runPrepare({
      assetId: "asset1",
      sourceUrl: SOURCE_URL,
      clip: { startSec: 5, endSec: 15 },
      language: null,
      deps: {
        runCommand,
        storage,
        allowedHosts: ALLOWED,
        nodeEnv: "test",
        transcribe: null,
      },
    })

    expect(result.report.annotation).toBe(TRANSCRIPTION_UNSUPPORTED_LANGUAGE)
    expect(result.report.captionsCount).toBe(0)
  })

  it("degrades to the unsupported annotation when the model is unavailable outside production", async () => {
    const { runCommand } = createFakeRunCommand()

    const result = await runPrepare({
      assetId: "asset1",
      sourceUrl: SOURCE_URL,
      clip: { startSec: 5, endSec: 15 },
      language: "en",
      deps: {
        runCommand,
        storage,
        allowedHosts: ALLOWED,
        nodeEnv: "development",
        transcribe: null,
      },
    })

    expect(result.report.annotation).toBe(TRANSCRIPTION_UNSUPPORTED_LANGUAGE)
  })

  it("extracts a 16kHz WAV before transcribing when audio + language are available", async () => {
    const { runCommand, calls } = createFakeRunCommand()
    const wavPaths: string[] = []
    const fakeTranscribe: TranscribeClip = async ({ wavPath }) => {
      wavPaths.push(wavPath)
      return { captions: [] }
    }

    await runPrepare({
      assetId: "asset1",
      sourceUrl: SOURCE_URL,
      clip: { startSec: 5, endSec: 15 },
      language: "es",
      deps: {
        runCommand,
        storage,
        allowedHosts: ALLOWED,
        nodeEnv: "test",
        transcribe: fakeTranscribe,
      },
    })

    const ffmpegCalls = calls.filter((call) => call.command === "ffmpeg")
    expect(ffmpegCalls).toHaveLength(2)
    expect(ffmpegCalls[1]!.args[ffmpegCalls[1]!.args.indexOf("-ar") + 1]).toBe(
      "16000",
    )
    expect(wavPaths).toHaveLength(1)
    expect(wavPaths[0]).toMatch(/clip\.wav$/)
  })
})
