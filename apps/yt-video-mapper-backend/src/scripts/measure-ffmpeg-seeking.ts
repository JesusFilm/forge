import { spawn } from "node:child_process"
import { access, mkdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  FfmpegVisualFrameExtractor,
  defaultFfmpegCommandRunner,
  type FfmpegCommandRunner,
  type FfmpegVisualFrameExtractorOptions,
} from "../services/ffmpeg-visual-frame-extraction.js"
import {
  VISUAL_FRAME_FINGERPRINT_HEIGHT,
  VISUAL_FRAME_FINGERPRINT_KIND,
  VISUAL_FRAME_FINGERPRINT_WIDTH,
  buildVisualFrameFingerprintPayload,
  type VisualFrameFingerprint,
} from "../services/visual-fingerprint.js"

const FIXTURE_DIRECTORY = join(tmpdir(), "forge-ytm-ffmpeg-seek-v1")
const SHORT_DURATION_MS = 120_000
const TYPICAL_DURATION_MS = 360_000
const LONG_DURATION_MS = 1_800_000
const EXPECTED_FRAMES = 12

type ExtractorMode = "adaptive" | "legacy"

type TrackedRunner = {
  runCommand: FfmpegCommandRunner
  calls: Parameters<FfmpegCommandRunner>[0][]
  maxActive: () => number
}

class FfmpegSeekingBenchmarkProcessError extends Error {
  constructor(command: string, code: number | null) {
    super(`${command} exited with code ${code ?? "unknown"}`)
    this.name = "FfmpegSeekingBenchmarkProcessError"
  }
}

async function main(): Promise<void> {
  const fixtureStartedAt = performance.now()
  const fixtures = await ensureFixtures()
  const fixtureGenerationMs = performance.now() - fixtureStartedAt
  const [shortBytes, typicalBytes, longBytes] = await Promise.all([
    readFile(fixtures.short),
    readFile(fixtures.typical),
    readFile(fixtures.long),
  ])

  const long = await timedExtraction({
    bytes: longBytes,
    durationMilliseconds: LONG_DURATION_MS,
    mode: "adaptive",
  })
  const longReplay = await timedExtraction({
    bytes: longBytes,
    durationMilliseconds: LONG_DURATION_MS,
    mode: "adaptive",
  })
  const shortLegacy = await timedExtraction({
    bytes: shortBytes,
    durationMilliseconds: SHORT_DURATION_MS,
    mode: "legacy",
  })
  const short = await timedExtraction({
    bytes: shortBytes,
    durationMilliseconds: SHORT_DURATION_MS,
    mode: "adaptive",
  })
  const unknown = await timedExtraction({
    bytes: shortBytes,
    durationMilliseconds: null,
    mode: "adaptive",
  })
  const typical = await timedExtraction({
    bytes: typicalBytes,
    durationMilliseconds: TYPICAL_DURATION_MS,
    mode: "adaptive",
  })
  const expectedLongFingerprintKeys = await exactSeekFingerprintKeys({
    source: fixtures.long,
    durationMilliseconds: LONG_DURATION_MS,
  })

  const shortVideoRegressionRatio =
    shortLegacy.elapsedMs > 0 ? short.elapsedMs / shortLegacy.elapsedMs : 1

  process.stdout.write(
    `${JSON.stringify({
      long_video_extract_ms: round(long.elapsedMs),
      frame_contract_ok: Number(
        hasFrameContract(long.frames, LONG_DURATION_MS),
      ),
      frame_content_ok: Number(
        fingerprintKeys(long.frames).join("|") ===
          expectedLongFingerprintKeys.join("|"),
      ),
      deterministic_ok: Number(
        fingerprintKeys(long.frames).join("|") ===
          fingerprintKeys(longReplay.frames).join("|"),
      ),
      short_fallback_ok: Number(
        isSinglePass(short.runner.calls) &&
          isSinglePass(unknown.runner.calls) &&
          short.frames.length === EXPECTED_FRAMES &&
          unknown.frames.length === EXPECTED_FRAMES,
      ),
      short_video_regression_ratio: round(shortVideoRegressionRatio),
      max_active_ffmpeg: Math.max(
        long.runner.maxActive(),
        longReplay.runner.maxActive(),
        shortLegacy.runner.maxActive(),
        short.runner.maxActive(),
        unknown.runner.maxActive(),
        typical.runner.maxActive(),
      ),
      short_video_extract_ms: round(short.elapsedMs),
      typical_video_extract_ms: round(typical.elapsedMs),
      typical_adaptive_ok: Number(isAdaptiveSeek(typical.runner.calls)),
      ffmpeg_commands_long: long.runner.calls.length,
      fixture_generation_ms: round(fixtureGenerationMs),
    })}\n`,
  )
}

async function exactSeekFingerprintKeys({
  source,
  durationMilliseconds,
}: {
  source: string
  durationMilliseconds: number
}): Promise<string[]> {
  const offsets = frameOffsets(durationMilliseconds)
  const keys: string[] = []

  for (const offsetMilliseconds of offsets) {
    const result = await defaultFfmpegCommandRunner({
      command: "ffmpeg",
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-protocol_whitelist",
        "file,pipe",
        "-ss",
        (offsetMilliseconds / 1_000).toFixed(3),
        "-i",
        source,
        "-vf",
        `scale=${VISUAL_FRAME_FINGERPRINT_WIDTH}:${VISUAL_FRAME_FINGERPRINT_HEIGHT},format=gray`,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "pipe:1",
      ],
      timeoutMs: 60_000,
    })
    const payload = buildVisualFrameFingerprintPayload({
      bytes: result.stdout,
      width: VISUAL_FRAME_FINGERPRINT_WIDTH,
      height: VISUAL_FRAME_FINGERPRINT_HEIGHT,
    })
    keys.push(`${offsetMilliseconds}:${payload.phash}`)
  }

  return keys
}

async function timedExtraction({
  bytes,
  durationMilliseconds,
  mode,
}: {
  bytes: Buffer
  durationMilliseconds: number | null
  mode: ExtractorMode
}) {
  const runner = trackedRunner()
  const options = {
    runCommand: runner.runCommand,
    adaptiveSeeking: mode === "adaptive",
  } as FfmpegVisualFrameExtractorOptions
  const extractor = new FfmpegVisualFrameExtractor(options)
  const startedAt = performance.now()
  const frames = await extractor.extractFromBytes({
    bytes,
    contentType: "video/mp4",
    durationMilliseconds,
  })

  return {
    elapsedMs: performance.now() - startedAt,
    frames,
    runner,
  }
}

function trackedRunner(): TrackedRunner {
  const calls: Parameters<FfmpegCommandRunner>[0][] = []
  let active = 0
  let maxActive = 0

  return {
    calls,
    maxActive: () => maxActive,
    runCommand: async (input) => {
      calls.push(input)
      active += 1
      maxActive = Math.max(maxActive, active)
      try {
        return await defaultFfmpegCommandRunner(input)
      } finally {
        active -= 1
      }
    },
  }
}

function hasFrameContract(
  frames: VisualFrameFingerprint[],
  durationMilliseconds: number,
): boolean {
  const offsets = frameOffsets(durationMilliseconds)
  return (
    frames.length === EXPECTED_FRAMES &&
    frames.every(
      (frame, index) =>
        frame.offsetMilliseconds === offsets[index] &&
        frame.payload.kind === VISUAL_FRAME_FINGERPRINT_KIND &&
        frame.payload.frameWidth === VISUAL_FRAME_FINGERPRINT_WIDTH &&
        frame.payload.frameHeight === VISUAL_FRAME_FINGERPRINT_HEIGHT,
    )
  )
}

function frameOffsets(durationMilliseconds: number): number[] {
  const offsetStepMilliseconds = durationMilliseconds / EXPECTED_FRAMES
  return Array.from({ length: EXPECTED_FRAMES }, (_, index) =>
    Math.round(index * offsetStepMilliseconds),
  )
}

function fingerprintKeys(frames: VisualFrameFingerprint[]): string[] {
  return frames.map(
    (frame) => `${frame.offsetMilliseconds}:${frame.payload.phash}`,
  )
}

function isSinglePass(calls: Parameters<FfmpegCommandRunner>[0][]): boolean {
  if (calls.length !== 1) return false
  const args = calls[0]?.args ?? []
  const filter = args[args.indexOf("-vf") + 1]
  return (
    args.includes("-i") && !args.includes("-ss") && filter?.startsWith("fps=")
  )
}

function isAdaptiveSeek(calls: Parameters<FfmpegCommandRunner>[0][]): boolean {
  if (calls.length !== 1) return false
  const args = calls[0]?.args ?? []
  return (
    args.filter((arg) => arg === "-ss").length === EXPECTED_FRAMES &&
    args.filter((arg) => arg === "-i").length === EXPECTED_FRAMES &&
    args.includes("-filter_complex") &&
    !args.includes("-vf")
  )
}

async function ensureFixtures(): Promise<{
  short: string
  typical: string
  long: string
}> {
  await mkdir(FIXTURE_DIRECTORY, { recursive: true })
  const fixtures = {
    short: join(FIXTURE_DIRECTORY, "short-120s.mp4"),
    typical: join(FIXTURE_DIRECTORY, "typical-360s.mp4"),
    long: join(FIXTURE_DIRECTORY, "long-1800s.mp4"),
  }

  await ensureFixture(fixtures.short, SHORT_DURATION_MS)
  await ensureFixture(fixtures.typical, TYPICAL_DURATION_MS)
  await ensureFixture(fixtures.long, LONG_DURATION_MS)
  return fixtures
}

async function ensureFixture(
  path: string,
  durationMilliseconds: number,
): Promise<void> {
  try {
    await access(path)
    return
  } catch {
    // The fixture is generated once and reused across stable benchmark repeats.
  }

  await runProcess("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=30",
    "-t",
    (durationMilliseconds / 1_000).toFixed(3),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "35",
    "-g",
    "60",
    "-keyint_min",
    "60",
    "-sc_threshold",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-y",
    path,
  ])
}

async function runProcess(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" })
    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new FfmpegSeekingBenchmarkProcessError(command, code))
      }
    })
  })
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

await main()
