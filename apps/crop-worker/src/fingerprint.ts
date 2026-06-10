// Visual fingerprinting: shot-boundary detection (scene filter + showinfo)
// plus a 1fps 64-bit dhash pass. Produces the smart-crop-fingerprint-v1
// artifact defined in docs/plans/2026-06-09-002-feat-smart-crop-plan.md.

import { env } from "./config/env.js"
import type { JobDeadline } from "./deadline.js"
import {
  classifyCommandError,
  DEFAULT_PROBE_TIMEOUT_MS,
  defaultRunCommand,
  sourceProtocolWhitelist,
  type RunCommand,
} from "./ffmpeg.js"
import { probeSource, type ProbeResult } from "./ffmpeg.js"
import { createStorage, type Storage } from "./storage.js"
import type {
  FingerprintArtifact,
  FingerprintShot,
  FingerprintSummary,
  RepresentativeHash,
} from "./types.js"

export const FINGERPRINT_ARTIFACT_TYPE = "smart-crop-fingerprint-v1"

const PTS_TIME_PATTERN = /pts_time:([0-9]+(?:\.[0-9]+)?)/

// 9 pixels wide x 8 pixels tall grayscale frame = 72 bytes per frame.
const DHASH_FRAME_WIDTH = 9
const DHASH_FRAME_HEIGHT = 8
export const DHASH_FRAME_BYTES = DHASH_FRAME_WIDTH * DHASH_FRAME_HEIGHT

export function parsePtsTime(line: string): number | null {
  if (!line.includes("pts_time:")) return null
  const match = PTS_TIME_PATTERN.exec(line)
  if (!match?.[1]) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

export type Shot = {
  shotId: string
  start: number
  end: number
}

export function buildShots(
  boundaries: number[],
  durationSeconds: number,
  minShotSeconds: number,
): Shot[] {
  const cuts = [...new Set(boundaries)]
    .filter((time) => time > 0 && time < durationSeconds)
    .sort((a, b) => a - b)

  const rawShots: Array<{ start: number; end: number }> = []
  let previousCut = 0
  for (const cut of [...cuts, durationSeconds]) {
    rawShots.push({ start: previousCut, end: cut })
    previousCut = cut
  }

  // Merge shots shorter than minShotSeconds into the previous shot. A short
  // FIRST shot has no previous shot and is kept as-is (it can only occur when
  // the source opens with an immediate cut or the whole video is short).
  const merged: Array<{ start: number; end: number }> = []
  for (const shot of rawShots) {
    const lastShot = merged[merged.length - 1]
    if (shot.end - shot.start < minShotSeconds && lastShot) {
      lastShot.end = shot.end
      continue
    }
    merged.push({ ...shot })
  }

  return merged.map((shot, index) => ({
    shotId: `shot_${String(index + 1).padStart(5, "0")}`,
    start: shot.start,
    end: shot.end,
  }))
}

export function computeDhash(frame: Buffer): string {
  if (frame.byteLength !== DHASH_FRAME_BYTES) {
    throw new Error(
      `dhash frame must be ${DHASH_FRAME_BYTES} bytes (9x8 grayscale), got ${frame.byteLength}`,
    )
  }

  let hex = ""
  for (let row = 0; row < DHASH_FRAME_HEIGHT; row++) {
    let byte = 0
    for (let col = 0; col < DHASH_FRAME_WIDTH - 1; col++) {
      const left = frame[row * DHASH_FRAME_WIDTH + col]!
      const right = frame[row * DHASH_FRAME_WIDTH + col + 1]!
      if (left > right) {
        byte |= 1 << (7 - col)
      }
    }
    hex += byte.toString(16).padStart(2, "0")
  }

  return hex
}

export function pickRepresentativeHashes(
  shot: { start: number; end: number },
  samples: RepresentativeHash[],
): RepresentativeHash[] {
  if (samples.length === 0) return []

  const targets = [
    shot.start + 0.5,
    (shot.start + shot.end) / 2,
    shot.end - 0.5,
  ]

  const picked = new Map<number, RepresentativeHash>()
  for (const target of targets) {
    let best = samples[0]!
    let bestDistance = Math.abs(best.time - target)
    for (const sample of samples) {
      const distance = Math.abs(sample.time - target)
      if (distance < bestDistance) {
        best = sample
        bestDistance = distance
      }
    }
    picked.set(best.time, best)
  }

  return [...picked.values()].sort((a, b) => a.time - b.time)
}

export type RunFingerprintInput = {
  assetId: string
  sourceUrl: string
  deps?: FingerprintDependencies
}

export type FingerprintDependencies = {
  runCommand?: RunCommand
  storage?: Storage
  probe?: typeof probeSource
  sceneThreshold?: number
  minShotSeconds?: number
  timeoutMs?: number
  /** Per-JOB deadline (set at enqueue time); caps every invocation below the remaining budget. */
  deadline?: JobDeadline
  protocolWhitelist?: string
  now?: () => Date
}

export async function runFingerprint({
  assetId,
  sourceUrl,
  deps = {},
}: RunFingerprintInput): Promise<FingerprintSummary> {
  const runCommand = deps.runCommand ?? defaultRunCommand
  const storage = deps.storage ?? createStorage()
  const probe = deps.probe ?? probeSource
  const sceneThreshold = deps.sceneThreshold ?? env.CROP_WORKER_SCENE_THRESHOLD
  const minShotSeconds = deps.minShotSeconds ?? env.CROP_WORKER_MIN_SHOT_SECONDS
  const timeoutMs =
    deps.timeoutMs ?? env.CROP_WORKER_FFMPEG_FINGERPRINT_TIMEOUT_MS
  const deadline = deps.deadline
  const protocolWhitelist = deps.protocolWhitelist ?? sourceProtocolWhitelist()
  const now = deps.now ?? (() => new Date())

  // Per-invocation timeout = min(per-invocation cap, remaining job budget);
  // throws JobDeadlineExceededError once the job deadline has passed.
  const invocationTimeoutMs = (capMs: number): number =>
    deadline ? deadline.capTimeoutMs(capMs) : capMs

  const source: ProbeResult = await probe(sourceUrl, {
    runCommand,
    timeoutMs: invocationTimeoutMs(DEFAULT_PROBE_TIMEOUT_MS),
    protocolWhitelist,
  })

  // Pass 1 — shot boundaries from the scene-change filter's showinfo lines.
  const boundaries: number[] = []
  try {
    await runCommand(
      "ffmpeg",
      [
        "-protocol_whitelist",
        protocolWhitelist,
        "-i",
        sourceUrl,
        "-vf",
        `select='gt(scene,${sceneThreshold})',showinfo`,
        "-an",
        "-f",
        "null",
        "-",
      ],
      {
        timeoutMs: invocationTimeoutMs(timeoutMs),
        onStderrLine: (line) => {
          const ptsTime = parsePtsTime(line)
          if (ptsTime != null) {
            boundaries.push(ptsTime)
          }
        },
      },
    )
  } catch (error) {
    throw classifyCommandError(error, "ffmpeg")
  }

  const shots = buildShots(boundaries, source.durationSeconds, minShotSeconds)

  // Pass 2 — 1fps dhash sampling. With fps=1 the filter emits roughly one
  // frame per second of source; we approximate frame N's timestamp as
  // N + 0.5 seconds (mid-second), which is accurate enough for shot-level
  // representative hash lookup.
  const samples: RepresentativeHash[] = []
  let pending: Buffer = Buffer.alloc(0)
  let frameIndex = 0
  try {
    await runCommand(
      "ffmpeg",
      [
        "-protocol_whitelist",
        protocolWhitelist,
        "-i",
        sourceUrl,
        "-vf",
        "fps=1,scale=9:8:flags=area,format=gray",
        "-f",
        "rawvideo",
        "pipe:1",
      ],
      {
        timeoutMs: invocationTimeoutMs(timeoutMs),
        onStdoutChunk: (chunk) => {
          pending = pending.byteLength ? Buffer.concat([pending, chunk]) : chunk
          while (pending.byteLength >= DHASH_FRAME_BYTES) {
            const frame = pending.subarray(0, DHASH_FRAME_BYTES)
            samples.push({
              time: frameIndex + 0.5,
              dhash: computeDhash(Buffer.from(frame)),
            })
            frameIndex += 1
            pending = pending.subarray(DHASH_FRAME_BYTES)
          }
        },
      },
    )
  } catch (error) {
    throw classifyCommandError(error, "ffmpeg")
  }

  const fingerprintShots: FingerprintShot[] = shots.map((shot) => ({
    shotId: shot.shotId,
    start: shot.start,
    end: shot.end,
    representativeHashes: pickRepresentativeHashes(shot, samples),
  }))

  const artifact: FingerprintArtifact = {
    version: 1,
    kind: "smart-crop-fingerprint",
    assetId,
    source: {
      width: source.width,
      height: source.height,
      durationSeconds: source.durationSeconds,
    },
    sampling: { hashFps: 1, hashSize: 8, sceneThreshold },
    shots: fingerprintShots,
    tool: "crop-worker-fingerprint-v1",
    generatedAt: now().toISOString(),
  }

  await storage.writeArtifact({
    assetId,
    artifactType: FINGERPRINT_ARTIFACT_TYPE,
    ext: "json",
    body: JSON.stringify(artifact, null, 2),
    contentType: "application/json",
  })

  return {
    shotCount: fingerprintShots.length,
    durationSeconds: source.durationSeconds,
    width: source.width,
    height: source.height,
  }
}
