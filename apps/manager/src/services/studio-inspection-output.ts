import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { z } from "zod"
import type { StudioDocument } from "@forge/studio-contracts"
import {
  STUDIO_INSPECTION_LIMITS as limits,
  STUDIO_INSPECTION_VERSION,
  studioInspectionEvidenceSchema,
  type StudioInspectionContext,
  type StudioInspectionEvidence,
  type StudioInspectionFinding,
} from "@forge/studio-contracts/inspection"

export class StudioInspectionError extends Error {}
const exec = promisify(execFile)
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")
type Sample = {
  frame: number
  reasons: Array<"representative" | "before-cut" | "after-cut">
}

/** These are composition hints, explicitly separate from decoded measurements.
 * Uncovered intervals are authored gaps; the composition has no intent marker. */
export function planStudioInspection(document: StudioDocument) {
  const total = document.durationInFrames
  const visual = document.items.filter(
    (i) =>
      i.kind !== "audio" &&
      i.transform?.opacity !== 0 &&
      (i.kind !== "text" || i.text.trim()),
  )
  const cutFrames = [
    ...new Set(
      visual.flatMap((i) => [i.startFrame, i.startFrame + i.durationInFrames]),
    ),
  ]
    .filter((f) => f > 0 && f < total)
    .sort((a, b) => a - b)
  const samples: Sample[] = []
  const add = (frame: number, reason: Sample["reasons"][number]) => {
    const found = samples.find((s) => s.frame === frame)
    if (found) {
      if (!found.reasons.includes(reason)) found.reasons.push(reason)
      return
    }
    if (samples.length < limits.samples)
      samples.push({ frame, reasons: [reason] })
  }
  for (const ratio of [0, 1 / 3, 2 / 3, 1])
    add(Math.round((total - 1) * ratio), "representative")
  // Spread cut pairs across the entire timeline, rather than inspecting only its start.
  const selectedCuts =
    cutFrames.length <= 4
      ? cutFrames
      : [0, 1 / 3, 2 / 3, 1].map(
          (r) => cutFrames[Math.round((cutFrames.length - 1) * r)]!,
        )
  for (const cut of selectedCuts) {
    add(cut - 1, "before-cut")
    add(cut, "after-cut")
  }
  const intervals = visual
    .map(
      (i) =>
        [
          i.startFrame,
          Math.min(total, i.startFrame + i.durationInFrames),
        ] as const,
    )
    .sort((a, b) => a[0] - b[0])
  const authoredGaps: Array<{ startMs: number; endMs: number }> = []
  let end = 0
  for (const interval of intervals) {
    if (interval[0] > end)
      authoredGaps.push({
        startMs: (end / document.fps) * 1000,
        endMs: (interval[0] / document.fps) * 1000,
      })
    end = Math.max(end, interval[1])
  }
  if (end < total)
    authoredGaps.push({
      startMs: (end / document.fps) * 1000,
      endMs: (total / document.fps) * 1000,
    })
  const findings: StudioInspectionFinding[] = authoredGaps.map((gap) => ({
    code: "authored-gap",
    basis: "timeline-heuristic",
    ...gap,
    message:
      "No visible timeline item covers this interval. This may be an intentional pause; author intent is not recorded. It is distinct from black pixels despite an active visual item.",
  }))
  for (const item of visual) {
    if (item.kind !== "text") continue
    const size =
      (item.properties.fontSize ?? 72) * (item.transform?.scaleY ?? 1)
    const lines = Math.max(
      1,
      Math.ceil((item.text.length * size * 0.55) / document.width),
    )
    const common = {
      basis: "timeline-heuristic" as const,
      itemId: item.id,
      startMs: (item.startFrame / document.fps) * 1000,
      endMs: ((item.startFrame + item.durationInFrames) / document.fps) * 1000,
    }
    if (
      size * 1.2 * lines > document.height ||
      Math.abs(item.transform?.y ?? 0) + size / 2 > document.height / 2
    )
      findings.push({
        ...common,
        code: "potential-text-overflow",
        message:
          "Estimated text extent may exceed the frame. This rough font/length estimate is not rendered glyph measurement; inspect the sampled image.",
      })
    if (size < document.height / 80)
      findings.push({
        ...common,
        code: "potential-small-text",
        message:
          "Authored font size is small relative to frame height. Readability depends on typeface, contrast and viewing size; inspect the actual image.",
      })
  }
  return {
    samples: samples.sort((a, b) => a.frame - b.frame),
    cutCount: cutFrames.length,
    sampledCutCount: selectedCuts.length,
    selectedCuts,
    authoredGaps,
    findings,
  }
}

function initialEvidence(context: StudioInspectionContext, start: number) {
  const plan = planStudioInspection(context.document)
  const evidence: StudioInspectionEvidence = {
    version: STUDIO_INSPECTION_VERSION,
    projectId: context.projectId,
    attemptId: context.attemptId,
    revision: context.revision,
    inputHash: context.inputHash,
    output: context.output,
    durationMs:
      (context.document.durationInFrames / context.document.fps) * 1000,
    outputReadyAt: context.outputReadyAt,
    preparationStartedAt: new Date(start).toISOString(),
    evidenceReadyAt: new Date(start).toISOString(),
    preparationMs: 0,
    status: "incomplete",
    advisoryOnly: true,
    samples: [],
    coverage: {
      totalFrames: context.document.durationInFrames,
      requestedFrames: plan.samples.map((s) => s.frame),
      cutCount: plan.cutCount,
      sampledCutCount: 0,
      authoredGaps: plan.authoredGaps,
      gapIntent: "not-recorded; confirm intentional gaps with the author",
      audio: {
        status: "unavailable",
        startMs: 0,
        endMs: 0,
        monoSampleRate: 8000,
        rms: null,
        peak: null,
        nearFullscaleFraction: null,
        silence: [],
      },
    },
    findings: plan.findings,
    limitations: [
      "Sampled frames are not frame-by-frame or full-video inspection. Unselected cuts, transitions and transient defects can be missed.",
      "Timeline text/gap heuristics are not pixel OCR or author intent. Black frames, fades, dark scenes and sparse white text can produce false positives.",
      "Audio statistics decode only the first 60 seconds to mono 8 kHz. They are not listening, speech intelligibility, pronunciation, loudness compliance or true-peak measurement.",
      "Client must report whether it actually viewed image blocks or listened to media. Unsupported modalities stay unknown; source subtitles do not prove rendered captions.",
      "Advisory only. At most one automatic defect-repair pass per handoff; time any repair render separately. Remaining uncertainty requires human review.",
    ],
    toolchain: { ffmpeg: "unavailable", ffprobe: "unavailable" },
  }
  return { evidence, plan }
}

export function incompleteStudioInspection(
  context: StudioInspectionContext,
  started: number,
  message: string,
) {
  const { evidence } = initialEvidence(context, started)
  evidence.findings.push({ code: "unsupported", basis: "container", message })
  evidence.preparationMs = Date.now() - started
  evidence.evidenceReadyAt = new Date().toISOString()
  return boundStudioInspectionEvidence(evidence)
}

const probeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      duration: z.string().optional(),
    }),
  ),
  format: z.object({ duration: z.string() }),
})

/** The only media input is digest-verified completed output, never authored code,
 * a source URL, subtitles or a caller path. Child protocols and threads are bounded. */
export async function extractStudioInspection(
  context: StudioInspectionContext,
  bytes: Buffer,
  binaries: { ffmpeg: string; ffprobe: string },
  signal?: AbortSignal,
): Promise<StudioInspectionEvidence> {
  if (
    !bytes.length ||
    bytes.length > limits.outputBytes ||
    hash(bytes) !== context.output.digest
  )
    throw new StudioInspectionError(
      "Exact rendered output digest/size mismatch",
    )
  const start = Date.now()
  const bounded = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(limits.preparationMs)])
    : AbortSignal.timeout(limits.preparationMs)
  const { evidence, plan } = initialEvidence(context, start)
  const dir = await mkdtemp(join(tmpdir(), "shorts-inspection-"))
  const input = join(dir, "render.mp4")
  const run = async (binary: string, args: string[], maxBuffer: number) => {
    bounded.throwIfAborted()
    return exec(binary, args, {
      encoding: "buffer",
      timeout: Math.max(1, limits.preparationMs - (Date.now() - start)),
      killSignal: "SIGKILL",
      signal: bounded,
      maxBuffer,
      windowsHide: true,
      cwd: dir,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
        NODE_ENV: "production",
      },
    })
  }
  try {
    await writeFile(input, bytes, { mode: 0o600 })
    for (const binary of ["ffmpeg", "ffprobe"] as const) {
      const result = await run(binaries[binary], ["-version"], 16384)
      evidence.toolchain[binary] = result.stdout
        .toString()
        .split("\n")[0]!
        .slice(0, 300)
    }
    const probed = await run(
      binaries.ffprobe,
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-show_entries",
        "stream=codec_type,width,height,duration:format=duration",
        "-of",
        "json",
        input,
      ],
      16384,
    )
    const probe = probeSchema.parse(JSON.parse(probed.stdout.toString()))
    const video = probe.streams.find((s) => s.codec_type === "video")
    const duration = Number(probe.format.duration) * 1000
    if (
      !video ||
      video.width !== context.document.width ||
      video.height !== context.document.height ||
      !Number.isFinite(duration) ||
      Math.abs(duration - evidence.durationMs) > 150
    )
      throw new StudioInspectionError(
        "Rendered container does not match exact revision dimensions/duration",
      )
    for (const sample of plan.samples) {
      const timestampMs = (sample.frame / context.document.fps) * 1000
      const result = await run(
        binaries.ffmpeg,
        [
          "-hide_banner",
          "-nostdin",
          "-v",
          "info",
          "-threads",
          "1",
          "-protocol_whitelist",
          "file",
          "-ss",
          String(timestampMs / 1000),
          "-i",
          input,
          "-an",
          "-frames:v",
          "1",
          "-vf",
          "scale=320:320:force_original_aspect_ratio=decrease,blackframe=amount=0:threshold=24",
          "-filter_threads",
          "1",
          "-threads",
          "1",
          "-q:v",
          "6",
          "-c:v",
          "mjpeg",
          "-f",
          "image2pipe",
          "pipe:1",
        ],
        limits.imageBytes,
      )
      if (
        !result.stdout.length ||
        result.stdout.length > limits.imageBytes ||
        result.stdout[0] !== 0xff ||
        result.stdout[1] !== 0xd8
      )
        throw new StudioInspectionError(
          "Frame sample exceeds JPEG budget or cannot decode",
        )
      const match = result.stderr.toString().match(/pblack:(\d+)/)
      const blackPercent = match ? Number(match[1]) : null
      evidence.samples.push({
        ...sample,
        timestampMs,
        blackPercent,
        image: {
          mimeType: "image/jpeg",
          data: result.stdout.toString("base64"),
          digest: hash(result.stdout),
        },
      })
      if (
        blackPercent !== null &&
        blackPercent >= 98 &&
        !plan.authoredGaps.some(
          (g) => timestampMs >= g.startMs && timestampMs < g.endMs,
        )
      )
        evidence.findings.push({
          code: "sampled-black",
          basis: "rendered-pixels",
          startMs: timestampMs,
          message:
            "At least 98% of this sampled output is dark despite authored visual coverage. Inspect for a cut defect; an intentional fade/dark scene or sparse text can also explain it.",
        })
    }
    const expectedAudio = context.document.items.some(
      (i) =>
        (i.kind === "audio" || i.kind === "video") &&
        i.volume > 0 &&
        i.startFrame / context.document.fps < limits.audioSeconds,
    )
    if (!probe.streams.some((s) => s.codec_type === "audio")) {
      evidence.coverage.audio.status = "missing"
      if (expectedAudio)
        evidence.findings.push({
          code: "audio-missing",
          basis: "container",
          message:
            "Rendered container has no audio stream although the timeline contains audible media.",
        })
    } else {
      const result = await run(
        binaries.ffmpeg,
        [
          "-hide_banner",
          "-nostdin",
          "-v",
          "error",
          "-threads",
          "1",
          "-protocol_whitelist",
          "file",
          "-i",
          input,
          "-vn",
          "-t",
          String(limits.audioSeconds),
          "-ac",
          "1",
          "-ar",
          "8000",
          "-filter_threads",
          "1",
          "-threads",
          "1",
          "-f",
          "f32le",
          "pipe:1",
        ],
        limits.audioSeconds * 8000 * 4 + 4096,
      )
      const count = Math.floor(result.stdout.length / 4)
      let sum = 0,
        peak = 0,
        near = 0,
        silentStart: number | null = null
      const silence: Array<{ startMs: number; endMs: number }> = []
      for (let i = 0; i < count; i++) {
        const value = Math.abs(result.stdout.readFloatLE(i * 4))
        if (!Number.isFinite(value))
          throw new StudioInspectionError("Invalid decoded audio sample")
        sum += value * value
        peak = Math.max(peak, value)
        if (value >= 0.99) near++
        if (value < 0.001) {
          if (silentStart === null) silentStart = i
        } else if (silentStart !== null) {
          if (i - silentStart >= 4000)
            silence.push({ startMs: silentStart / 8, endMs: i / 8 })
          silentStart = null
        }
      }
      if (silentStart !== null && count - silentStart >= 4000)
        silence.push({ startMs: silentStart / 8, endMs: count / 8 })
      evidence.coverage.audio = {
        status: "measured",
        startMs: 0,
        endMs: count / 8,
        monoSampleRate: 8000,
        rms: count ? Math.sqrt(sum / count) : 0,
        peak,
        nearFullscaleFraction: count ? near / count : 0,
        silence: silence.slice(0, 120),
      }
      if (expectedAudio && (count === 0 || sum / count < 0.000001))
        evidence.findings.push({
          code: "audio-silence",
          basis: "decoded-audio",
          startMs: 0,
          endMs: count / 8,
          message:
            "Decoded audio is effectively silent in the measured interval despite authored audible media. Confirm intentional silence before changing it.",
        })
      if (count && near / count > 0.001)
        evidence.findings.push({
          code: "audio-near-fullscale",
          basis: "decoded-audio",
          startMs: 0,
          endMs: count / 8,
          message:
            "Decoded mono samples repeatedly approach full scale. Potential clipping/distortion; downmix/resampling is not a true-peak test and listening remains necessary.",
        })
    }
    evidence.status = "sampled"
  } catch (error) {
    const missing =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    evidence.status = missing ? "unsupported" : "incomplete"
    evidence.findings.push({
      code: "unsupported",
      basis: "container",
      message: missing
        ? "Configured FFmpeg/FFprobe binary is missing; provision STUDIO_FFMPEG_PATH and STUDIO_FFPROBE_PATH. No audiovisual inspection is claimed."
        : bounded.aborted
          ? "Inspection reached its processing deadline; only returned samples/measurements were inspected."
          : "Bounded output extraction failed. Returned samples are partial; remaining visual/audio coverage is unknown.",
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  evidence.coverage.sampledCutCount = plan.selectedCuts.filter(
    (cut) =>
      evidence.samples.some((sample) => sample.frame === cut - 1) &&
      evidence.samples.some((sample) => sample.frame === cut),
  ).length
  evidence.preparationMs = Date.now() - start
  evidence.evidenceReadyAt = new Date().toISOString()
  return boundStudioInspectionEvidence(evidence)
}

/** Keep the advertised whole-report cap, not just individual JPEG limits. Pixel
 * and decoded-audio findings outrank composition estimates when space is scarce. */
export function boundStudioInspectionEvidence(
  evidence: StudioInspectionEvidence,
) {
  const original = evidence.findings.length
  evidence.findings.sort(
    (a, b) =>
      Number(a.basis === "timeline-heuristic") -
      Number(b.basis === "timeline-heuristic"),
  )
  evidence.findings = evidence.findings.slice(0, 1100)
  const needsTrim = () =>
    Buffer.byteLength(JSON.stringify(evidence)) > limits.evidenceBytes
  if (original !== evidence.findings.length || needsTrim()) {
    evidence.limitations.push(
      "The bounded report omitted lower-priority findings or samples. Absence of a warning is not proof of absence of a defect.",
    )
    while (needsTrim() && evidence.findings.length)
      evidence.findings.splice(
        -Math.max(1, Math.ceil(evidence.findings.length / 4)),
      )
    while (needsTrim() && evidence.samples.length) {
      evidence.samples.pop()
      evidence.status = "incomplete"
    }
    evidence.coverage.sampledCutCount = Math.min(
      evidence.coverage.sampledCutCount,
      evidence.samples.filter(
        (s) =>
          s.reasons.includes("after-cut") &&
          evidence.samples.some((other) => other.frame === s.frame - 1),
      ).length,
    )
  }
  return studioInspectionEvidenceSchema.parse(evidence)
}
