import { spawn } from "node:child_process"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runRender } from "../src/render.js"
import { createStorage } from "../src/storage.js"
import type { RenderReport } from "../src/types.js"

const DEFAULT_PLAYBACK_ID = "34eG2PxlcRu3L4wU5XlKVna2vN3BAI02Tjrq28dazn3Y"
const DEFAULT_ASSET_ID = "mock_smart_crop_asset"
const PLAN_CANONICAL = "smart-crop-plan-9x16-v1"
const PLAN_ATTEMPT_0 = "smart-crop-plan-9x16-attempt-000-v1"
const PLAN_ATTEMPT_1 = "smart-crop-plan-9x16-attempt-001-v1"
const QA_ATTEMPT_0 = "smart-crop-qa-9x16-attempt-000-v1"
const QA_ATTEMPT_1 = "smart-crop-qa-9x16-attempt-001-v1"
const ATTEMPTS_ARTIFACT = "smart-crop-attempts-9x16-v1"
const PROTOCOL_WHITELIST = "https,tls,tcp,crypto,hls"

type SourceInfo = {
  width: number
  height: number
  durationSeconds: number
}

type CropPlan = {
  version: 1
  kind: "smart-crop-canonical-plan"
  assetId: string
  muxAssetId: string
  playbackId: string
  source: SourceInfo
  target: { aspectRatio: "9:16"; width: number; height: number }
  strategy: { cropMode: string; plannerVersion: string; model: string }
  segments: Array<{
    shotId: string
    canonicalStart: number
    canonicalEnd: number
    mode: "speaker" | "group" | "slide_aware"
    primarySubject: string
    secondarySubjects: string[]
    avoidCutting: string[]
    confidence: number
    cropKeyframes: Array<{
      progress: number
      x: number
      y: number
      width: number
      height: number
    }>
  }>
  usage: { inputTokens: number; outputTokens: number }
  qa: { status: "draft" | "approved"; approvedBy?: string; approvedAt?: string }
  generatedAt: string
}

type AttemptSummary = {
  attemptIndex: number
  suffix: string
  planLogicalKey: string
  planArtifactType: string
  previewLogicalKey: string
  previewArtifactType: string
  renderReportLogicalKey: string
  renderReportArtifactType: string
  qaLogicalKey: string
  qaArtifactType: string
  previewFrameLogicalKeyPattern: string
  status: "complete" | "approved"
  source: "initial" | "repair"
  repairedFromAttemptIndex?: number
  createdAt: string
  updatedAt: string
  previewFrameLogicalKeys: string[]
  qa: {
    verdict: "pass" | "needs_repair"
    issueCount: number
    repairTriggerCount: number
  }
  triggerIssues: Array<{
    severity: "warning"
    description: string
    atSeconds: number
    shotId: string
  }>
}

type AttemptsArtifact = {
  version: 1
  kind: "smart-crop-attempts"
  assetId: string
  maxRepairAttempts: number
  selectedAttemptIndex: number
  attempts: AttemptSummary[]
  updatedAt: string
  manifestDigest?: string
}

const scriptPath = fileURLToPath(import.meta.url)
const cropWorkerRoot = resolve(dirname(scriptPath), "..")
const repoRoot = resolve(cropWorkerRoot, "../..")
const managerRoot = resolve(repoRoot, "apps/manager")

function readEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : fallback
}

const playbackId = readEnv("SMART_CROP_SMOKE_PLAYBACK_ID", DEFAULT_PLAYBACK_ID)
const assetId = readEnv("SMART_CROP_SMOKE_ASSET_ID", DEFAULT_ASSET_ID)
const sourceUrl = `https://stream.mux.com/${playbackId}.m3u8`
const artifactRoot = resolve(
  readEnv(
    "SMART_CROP_SMOKE_ARTIFACT_DIR",
    join(managerRoot, ".tmp", "artifacts"),
  ),
)
const mockStorePath = resolve(
  readEnv(
    "SMART_CROP_SMOKE_MOCK_STORE",
    join(managerRoot, ".tmp", "mock-cms", "store.json"),
  ),
)

function roundToEven(value: number): number {
  return 2 * Math.round(value / 2)
}

function evenFloor(value: number): number {
  return Math.max(2, 2 * Math.floor(value / 2))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function cropX(source: SourceInfo, cropWidth: number, ratio: number): number {
  return roundToEven(
    clamp((source.width - cropWidth) * ratio, 0, source.width - cropWidth),
  )
}

function normalizeForDigest(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(normalizeForDigest).join(",")}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter((key) => key !== "manifestDigest")
    .sort()
    .map((key) => `${JSON.stringify(key)}:${normalizeForDigest(record[key])}`)
    .join(",")}}`
}

function digestAttempts(artifact: AttemptsArtifact): string {
  const normalized = normalizeForDigest(artifact)
  let hash = 0x811c9dc5
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      settled = true
      reject(new Error(`${command} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout).toString("utf8"))
        return
      }
      reject(
        new Error(
          `${command} exited ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`,
        ),
      )
    })
  })
}

function firstVideoStream(
  payload: unknown,
): { width: number; height: number } | null {
  const record = payload as {
    streams?: Array<{ width?: unknown; height?: unknown }>
    programs?: Array<{ streams?: Array<{ width?: unknown; height?: unknown }> }>
  }
  const candidates = [
    ...(Array.isArray(record.streams) ? record.streams : []),
    ...(Array.isArray(record.programs)
      ? record.programs.flatMap((program) =>
          Array.isArray(program.streams) ? program.streams : [],
        )
      : []),
  ]
  for (const stream of candidates) {
    if (typeof stream.width === "number" && typeof stream.height === "number") {
      return { width: stream.width, height: stream.height }
    }
  }
  return null
}

async function probeMedia(input: string): Promise<SourceInfo> {
  const raw = await runCommand("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    input,
  ])
  const parsed = JSON.parse(raw) as { format?: { duration?: string } }
  const stream = firstVideoStream(parsed)
  const durationSeconds = Number(parsed.format?.duration)
  if (!stream || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`ffprobe did not return usable media metadata for ${input}`)
  }
  return { ...stream, durationSeconds }
}

function buildPlan(source: SourceInfo, repaired: boolean): CropPlan {
  const cropWidth = evenFloor((source.height * 9) / 16)
  const boundaries = [
    0,
    source.durationSeconds / 3,
    (source.durationSeconds * 2) / 3,
    source.durationSeconds,
  ]
  const shot2Start = boundaries[1]!
  const shot2End = boundaries[2]!
  const shot2Initial = cropX(source, cropWidth, 1)
  const shot2Repaired = cropX(source, cropWidth, 0.5)
  const generatedAt = new Date().toISOString()

  return {
    version: 1,
    kind: "smart-crop-canonical-plan",
    assetId,
    muxAssetId: assetId,
    playbackId,
    source,
    target: { aspectRatio: "9:16", width: 1080, height: 1920 },
    strategy: {
      cropMode: "auto",
      plannerVersion: "smart-crop-real-video-smoke",
      model: "deterministic-smoke",
    },
    segments: [
      {
        shotId: "shot_00001",
        canonicalStart: boundaries[0]!,
        canonicalEnd: boundaries[1]!,
        mode: "speaker",
        primarySubject: "Opening subject",
        secondarySubjects: [],
        avoidCutting: ["face"],
        confidence: 0.9,
        cropKeyframes: [
          {
            progress: 0,
            x: cropX(source, cropWidth, 0.15),
            y: 0,
            width: cropWidth,
            height: source.height,
          },
          {
            progress: 1,
            x: cropX(source, cropWidth, 0.25),
            y: 0,
            width: cropWidth,
            height: source.height,
          },
        ],
      },
      {
        shotId: "shot_00002",
        canonicalStart: shot2Start,
        canonicalEnd: shot2End,
        mode: "group",
        primarySubject: repaired ? "Re-centered subject" : "Subject near edge",
        secondarySubjects: [],
        avoidCutting: ["face", "subject"],
        confidence: repaired ? 0.94 : 0.76,
        cropKeyframes: [
          {
            progress: 0,
            x: repaired ? shot2Repaired : shot2Initial,
            y: 0,
            width: cropWidth,
            height: source.height,
          },
          {
            progress: 1,
            x: repaired ? shot2Repaired : shot2Initial,
            y: 0,
            width: cropWidth,
            height: source.height,
          },
        ],
      },
      {
        shotId: "shot_00003",
        canonicalStart: boundaries[2]!,
        canonicalEnd: boundaries[3]!,
        mode: "slide_aware",
        primarySubject: "Closing subject",
        secondarySubjects: [],
        avoidCutting: ["on-screen text"],
        confidence: 0.86,
        cropKeyframes: [
          {
            progress: 0,
            x: cropX(source, cropWidth, 0.7),
            y: 0,
            width: cropWidth,
            height: source.height,
          },
          {
            progress: 1,
            x: cropX(source, cropWidth, 0.75),
            y: 0,
            width: cropWidth,
            height: source.height,
          },
        ],
      },
    ],
    usage: { inputTokens: 0, outputTokens: 0 },
    qa: repaired
      ? {
          status: "approved",
          approvedBy: "smart-crop-real-video-smoke",
          approvedAt: generatedAt,
        }
      : { status: "draft" },
    generatedAt,
  }
}

async function writeJsonArtifact(
  storage: ReturnType<typeof createStorage>,
  artifactType: string,
  payload: unknown,
): Promise<void> {
  await storage.writeArtifact({
    assetId,
    artifactType,
    ext: "json",
    body: JSON.stringify(payload, null, 2),
    contentType: "application/json",
  })
}

function buildQaArtifact(
  verdict: "pass" | "needs_repair",
  issues: AttemptSummary["triggerIssues"],
) {
  return {
    version: 1,
    kind: "smart-crop-qa-report",
    assetId,
    renderMode: "preview",
    verdict,
    issues,
    frameCount: 2,
    model: "deterministic-smoke",
    usage: { inputTokens: 0, outputTokens: 0 },
    generatedAt: new Date().toISOString(),
  }
}

function attemptSummary(
  index: 0 | 1,
  report: RenderReport,
  issues: AttemptSummary["triggerIssues"],
): AttemptSummary {
  const suffix = `attempt-${String(index).padStart(3, "0")}`
  const artifactSuffix = suffix
  const status = index === 1 ? "approved" : "complete"
  return {
    attemptIndex: index,
    suffix,
    planLogicalKey: `smart-crop-plan-${suffix}`,
    planArtifactType: index === 0 ? PLAN_ATTEMPT_0 : PLAN_ATTEMPT_1,
    previewLogicalKey: `smart-crop-preview-${suffix}`,
    previewArtifactType: `smart-crop-preview-9x16-${artifactSuffix}`,
    renderReportLogicalKey: `smart-crop-render-report-preview-${suffix}`,
    renderReportArtifactType: `smart-crop-render-report-9x16-preview-${artifactSuffix}`,
    qaLogicalKey: `smart-crop-qa-${suffix}`,
    qaArtifactType: index === 0 ? QA_ATTEMPT_0 : QA_ATTEMPT_1,
    previewFrameLogicalKeyPattern: `smart-crop-preview-frame-9x16-{NNN}-${suffix}`,
    status,
    source: index === 0 ? "initial" : "repair",
    ...(index === 1 ? { repairedFromAttemptIndex: 0 } : {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    previewFrameLogicalKeys: [...report.previewFrameArtifactTypes],
    qa:
      index === 0
        ? {
            verdict: "needs_repair",
            issueCount: issues.length,
            repairTriggerCount: issues.length,
          }
        : { verdict: "pass", issueCount: 0, repairTriggerCount: 0 },
    triggerIssues: issues,
  }
}

async function updateMockStore(
  attempts: AttemptsArtifact,
): Promise<"updated" | "missing"> {
  try {
    await access(mockStorePath)
  } catch {
    return "missing"
  }

  const raw = await readFile(mockStorePath, "utf8")
  const state = JSON.parse(raw) as {
    readModels?: {
      jobs?: Array<{
        id?: string
        artifacts?: Record<string, { kind: string; data?: unknown }>
        updatedAt?: string
      }>
    }
  }
  const job = state.readModels?.jobs?.find(
    (entry) => entry.id === "mock-smart-crop-1",
  )
  if (!job) return "missing"

  job.updatedAt = new Date().toISOString()
  job.artifacts = {
    ...(job.artifacts ?? {}),
    smartCrop: {
      kind: "metadata",
      data: {
        domain: "smart_crop",
        kind: "canonical",
        phase: "completed",
        plan: { segmentCount: 3, approved: true },
        qa: { verdict: "pass" },
        attempts: {
          latestAttemptIndex: 1,
          selectedAttemptIndex: 1,
          maxRepairAttempts: 2,
          repairCount: 1,
          manifestDigest: attempts.manifestDigest,
        },
      },
    },
    "smart-crop-plan": { kind: "downloadable" },
    "smart-crop-attempts": { kind: "downloadable" },
    "smart-crop-plan-attempt-000": { kind: "downloadable" },
    "smart-crop-plan-attempt-001": { kind: "downloadable" },
    "smart-crop-preview-attempt-000": { kind: "downloadable" },
    "smart-crop-preview-attempt-001": { kind: "downloadable" },
    "smart-crop-render-report-preview-attempt-000": { kind: "downloadable" },
    "smart-crop-render-report-preview-attempt-001": { kind: "downloadable" },
    "smart-crop-qa-attempt-000": { kind: "downloadable" },
    "smart-crop-qa-attempt-001": { kind: "downloadable" },
    "smart-crop-output": { kind: "downloadable" },
    "smart-crop-render-report-full": { kind: "downloadable" },
  }

  await mkdir(dirname(mockStorePath), { recursive: true })
  await writeFile(mockStorePath, JSON.stringify(state, null, 2))
  return "updated"
}

async function main(): Promise<void> {
  const storage = createStorage({ localRootDir: artifactRoot })
  const source = await probeMedia(sourceUrl)
  const initialPlan = buildPlan(source, false)
  const repairedPlan = buildPlan(source, true)

  await writeJsonArtifact(storage, PLAN_ATTEMPT_0, initialPlan)
  await writeJsonArtifact(storage, PLAN_ATTEMPT_1, repairedPlan)
  await writeJsonArtifact(storage, PLAN_CANONICAL, repairedPlan)

  const attempt0 = await runRender({
    assetId,
    sourceUrl,
    mode: "preview",
    cropPlanAssetId: assetId,
    cropPlanArtifactType: PLAN_ATTEMPT_0,
    artifactSuffix: "attempt-000",
    previewFrameCount: 2,
    deps: {
      storage,
      protocolWhitelist: PROTOCOL_WHITELIST,
      previewMaxSegments: 6,
      previewMaxSeconds: 90,
    },
  })
  const attempt1 = await runRender({
    assetId,
    sourceUrl,
    mode: "preview",
    cropPlanAssetId: assetId,
    cropPlanArtifactType: PLAN_ATTEMPT_1,
    artifactSuffix: "attempt-001",
    previewFrameCount: 2,
    deps: {
      storage,
      protocolWhitelist: PROTOCOL_WHITELIST,
      previewMaxSegments: 6,
      previewMaxSeconds: 90,
    },
  })

  const issueTime = source.durationSeconds / 2
  const triggerIssues: AttemptSummary["triggerIssues"] = [
    {
      severity: "warning",
      description: "Subject is pinned to the crop edge in the initial attempt.",
      atSeconds: issueTime,
      shotId: "shot_00002",
    },
  ]
  await writeJsonArtifact(
    storage,
    QA_ATTEMPT_0,
    buildQaArtifact("needs_repair", triggerIssues),
  )
  await writeJsonArtifact(storage, QA_ATTEMPT_1, buildQaArtifact("pass", []))

  const attempts: AttemptsArtifact = {
    version: 1,
    kind: "smart-crop-attempts",
    assetId,
    maxRepairAttempts: 2,
    selectedAttemptIndex: 1,
    attempts: [
      attemptSummary(0, attempt0.report, triggerIssues),
      attemptSummary(1, attempt1.report, []),
    ],
    updatedAt: new Date().toISOString(),
  }
  attempts.manifestDigest = digestAttempts(attempts)
  await writeJsonArtifact(storage, ATTEMPTS_ARTIFACT, attempts)

  const full = await runRender({
    assetId,
    sourceUrl,
    mode: "full",
    cropPlanAssetId: assetId,
    cropPlanArtifactType: PLAN_CANONICAL,
    previewFrameCount: 0,
    deps: {
      storage,
      protocolWhitelist: PROTOCOL_WHITELIST,
      previewMaxSegments: 6,
      previewMaxSeconds: 90,
    },
  })

  const outputPath = join(artifactRoot, assetId, "smart-crop-output-9x16.mp4")
  const outputProbe = await probeMedia(outputPath)
  const plannedDuration = full.report.outputDurationSeconds
  const durationDriftSeconds = Math.abs(
    outputProbe.durationSeconds - plannedDuration,
  )
  if (outputProbe.width !== 1080 || outputProbe.height !== 1920) {
    throw new Error(
      `cropped output dimensions were ${outputProbe.width}x${outputProbe.height}, expected 1080x1920`,
    )
  }
  if (durationDriftSeconds > 1) {
    throw new Error(
      `cropped output duration drifted by ${durationDriftSeconds.toFixed(3)}s: ffprobe=${outputProbe.durationSeconds.toFixed(3)}s, planned=${plannedDuration.toFixed(3)}s`,
    )
  }

  const mockStore = await updateMockStore(attempts)
  const summary = {
    ok: true,
    source: { playbackId, url: sourceUrl, ...source },
    artifactRoot,
    attempts: attempts.attempts.map((attempt) => ({
      attemptIndex: attempt.attemptIndex,
      status: attempt.status,
      planArtifactType: attempt.planArtifactType,
      previewArtifactType: attempt.previewArtifactType,
      qa: attempt.qa,
    })),
    fullOutput: {
      path: outputPath,
      width: outputProbe.width,
      height: outputProbe.height,
      durationSeconds: outputProbe.durationSeconds,
      plannedDurationSeconds: plannedDuration,
      durationDriftSeconds,
      bytes: full.report.outputBytes,
    },
    manifestDigest: attempts.manifestDigest,
    mockStore,
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
})
