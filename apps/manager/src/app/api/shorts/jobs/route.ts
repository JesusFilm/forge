// POST /api/shorts/jobs — create a Shorts Studio job (clip bounds + source
// resolution) and launch the durable prepare workflow.
// GET /api/shorts/jobs — list shorts jobs (options.shorts present).
//
// Plan 2026-06-11-002 "API routes". Clones the smart-crop create route's
// conventions: identity-returning auth (requestedBy is derived from the
// authenticated actor, never the body), Zod validation, 503 config_missing,
// plain-string `[shorts] event=` logging, launch-failure job cleanup.

import { randomBytes } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { SHORT_CLIP_DURATION } from "@forge/shorts-compositions/schema"
import {
  authenticateManagerOverrideRequest,
  authenticateRequest,
  managerActorIdentity,
} from "@/lib/auth"
import { env } from "@/config/env"
import {
  buildShortsMetadataArtifact,
  mergeShortsReport,
} from "@/lib/shorts-report"
import { toWhisperLanguage } from "@/lib/whisper-language"
import { buildShortsInitialSteps } from "@/lib/workflow-steps"
import { createJob, listJobs, updateJob } from "@/lib/state"
import type { ShortsJobOptions } from "@/types/job"

const ASSET_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
// Mux playback IDs are alphanumeric; the playback id is interpolated into
// the shorts-worker ffmpeg source URL, so the Mux-resolved value goes
// through the same shape gate as operator-supplied ids do elsewhere
// (smart-crop precedent).
const PLAYBACK_ID_PATTERN = /^[a-zA-Z0-9]+$/

// Tolerance on the upper clip bound: Mux durations are float seconds and
// scrubbers snap to frame boundaries — half a second of slack avoids
// rejecting "select to the end" clips over rounding.
const CLIP_END_TOLERANCE_SEC = 0.5

const createShortsJobSchema = z
  .object({
    coreId: z.string().regex(ASSET_ID_PATTERN).optional(),
    muxAssetId: z.string().regex(ASSET_ID_PATTERN).optional(),
    clip: z.object({
      startSec: z.number().finite().min(0),
      endSec: z.number().finite().positive(),
    }),
    title: z.string().min(1).max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.coreId && !value.muxAssetId) {
      ctx.addIssue({
        code: "custom",
        path: ["coreId"],
        message: "At least one of coreId or muxAssetId is required",
      })
    }
  })

function getMissingShortsConfig(): string[] {
  const missing: string[] = []
  if (!env.SHORTS_WORKER_BASE_URL) missing.push("SHORTS_WORKER_BASE_URL")
  if (!env.SHORTS_WORKER_API_KEY) missing.push("SHORTS_WORKER_API_KEY")
  return missing
}

export type ShortsCreateRejectionReason =
  | "video_not_found"
  | "missing_mux_asset"
  | "playback_not_public"
  | "clip_too_short"
  | "clip_too_long"
  | "clip_out_of_bounds"

function validationFailed(
  reason: ShortsCreateRejectionReason,
  message: string,
  status = 422,
): NextResponse {
  return NextResponse.json(
    { error: message, reason, retryable: false },
    { status },
  )
}

export async function POST(request: Request) {
  const actor = await authenticateManagerOverrideRequest(request)
  if (actor instanceof NextResponse) return actor

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = createShortsJobSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const missingConfig = getMissingShortsConfig()
  if (missingConfig.length > 0) {
    return NextResponse.json(
      {
        error: "Shorts Studio is not configured on this Manager deployment",
        reason: "config_missing",
        messages: [`Missing env vars: ${missingConfig.join(", ")}`],
        retryable: false,
      },
      { status: 503 },
    )
  }

  const body = parsed.data

  // ---------------------------------------------------------------------
  // Resolve the source video: coreId → admin lookup (mux asset + language +
  // title); muxAssetId-only → no admin metadata (language unknown → whisper
  // transcription degrades per plan decision 5).
  // ---------------------------------------------------------------------
  let sourceMuxAssetId = body.muxAssetId ?? null
  let sourceCoreId: string | undefined
  let sourceTitle = body.title
  let languageBcp47: string | null = null

  if (body.coreId) {
    const { lookupVideosByCoreIdFromAdmin } =
      await import("@/lib/admin-video-lookup")
    const envelope = await lookupVideosByCoreIdFromAdmin([body.coreId])
    if (!envelope.ok) {
      const status = envelope.reason === "config_missing" ? 503 : 502
      return NextResponse.json(
        {
          error: "admin video lookup failed",
          reason:
            envelope.reason === "config_missing"
              ? "config_missing"
              : "admin_unreachable",
          upstreamReason: envelope.reason,
          messages: envelope.messages,
          retryable: envelope.retryable,
        },
        { status },
      )
    }

    const video = envelope.data.get(body.coreId)
    if (!video) {
      return validationFailed(
        "video_not_found",
        `No admin video found for coreId ${body.coreId}`,
        404,
      )
    }
    if (!video.muxAssetId) {
      return validationFailed(
        "missing_mux_asset",
        `Video ${body.coreId} has no Mux asset — it cannot be clipped into a short`,
      )
    }
    if (body.muxAssetId && body.muxAssetId !== video.muxAssetId) {
      return NextResponse.json(
        {
          error: `muxAssetId ${body.muxAssetId} does not match the Mux asset of video ${body.coreId} (${video.muxAssetId}) — supply one or the other`,
        },
        { status: 400 },
      )
    }

    sourceMuxAssetId = video.muxAssetId
    sourceCoreId = video.coreId
    sourceTitle = body.title ?? video.label ?? undefined
    languageBcp47 = video.primaryLanguageBcp47
  }

  // superRefine guarantees one of the two was supplied.
  if (!sourceMuxAssetId) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: "muxAssetId could not be resolved",
      },
      { status: 400 },
    )
  }

  // The admin-resolved Mux asset id becomes the storage-prefix base — same
  // shape gate as operator-supplied ids (defense in depth).
  if (!ASSET_ID_PATTERN.test(sourceMuxAssetId)) {
    return NextResponse.json(
      {
        error: `Resolved Mux asset id for ${body.coreId ?? sourceMuxAssetId} is not a valid storage assetId (alphanumeric, hyphen, underscore)`,
      },
      { status: 400 },
    )
  }

  // ---------------------------------------------------------------------
  // Live Mux resolution: duration comes from the Mux API (NEVER
  // mux_videos.duration — always 0, root CLAUDE.md) and the playback id
  // must carry the PUBLIC policy (the worker fetches HLS unauthenticated).
  // ---------------------------------------------------------------------
  let muxDuration: number | null
  let publicPlaybackId: string | null
  try {
    const { getMuxAssetPlayback } = await import("@/services/mux")
    const playback = await getMuxAssetPlayback(sourceMuxAssetId)
    muxDuration = playback.duration
    publicPlaybackId = playback.publicPlaybackId
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not resolve Mux asset ${sourceMuxAssetId}: ${
          error instanceof Error ? error.message : "unknown Mux error"
        }`,
      },
      { status: 400 },
    )
  }

  if (!publicPlaybackId) {
    return validationFailed(
      "playback_not_public",
      `Mux asset ${sourceMuxAssetId} has no public playback ID (signed/drm-only assets cannot be clipped into shorts)`,
    )
  }
  if (!PLAYBACK_ID_PATTERN.test(publicPlaybackId)) {
    return NextResponse.json(
      {
        error: `Resolved playback ID for Mux asset ${sourceMuxAssetId} is not a valid Mux playback ID (alphanumeric)`,
      },
      { status: 400 },
    )
  }

  // ---------------------------------------------------------------------
  // Clip bounds (plan: 5–180s, within the live source duration).
  // ---------------------------------------------------------------------
  const clip = body.clip
  const clipDurationSec = clip.endSec - clip.startSec
  if (clipDurationSec < SHORT_CLIP_DURATION.minSec) {
    return validationFailed(
      "clip_too_short",
      `Clip must be at least ${SHORT_CLIP_DURATION.minSec}s (got ${clipDurationSec.toFixed(2)}s)`,
    )
  }
  if (clipDurationSec > SHORT_CLIP_DURATION.maxSec) {
    return validationFailed(
      "clip_too_long",
      `Clip must be at most ${SHORT_CLIP_DURATION.maxSec}s (got ${clipDurationSec.toFixed(2)}s)`,
    )
  }
  // Mux occasionally reports null duration; the worker re-clamps bounds
  // against the ffprobed source duration anyway (plan decision 9), so a
  // missing live duration skips only this early check.
  if (
    muxDuration !== null &&
    clip.endSec > muxDuration + CLIP_END_TOLERANCE_SEC
  ) {
    return validationFailed(
      "clip_out_of_bounds",
      `Clip end ${clip.endSec}s is beyond the source duration ${muxDuration}s`,
    )
  }

  // ---------------------------------------------------------------------
  // Mint the per-short storage prefix (plan decision 1) and assemble the
  // job options. requestedBy comes from the authenticated actor.
  // ---------------------------------------------------------------------
  const suffix = randomBytes(4).toString("hex")
  const shortAssetId = `${sourceMuxAssetId}-short-${suffix}`
  if (!ASSET_ID_PATTERN.test(shortAssetId)) {
    return NextResponse.json(
      {
        error: `Minted short assetId ${shortAssetId} is not a valid storage assetId`,
      },
      { status: 500 },
    )
  }

  const shorts: ShortsJobOptions = {
    assetId: shortAssetId,
    sourceMuxAssetId,
    sourcePlaybackId: publicPlaybackId,
    ...(sourceCoreId ? { sourceCoreId } : {}),
    ...(sourceTitle ? { sourceTitle } : {}),
    clip: { startSec: clip.startSec, endSec: clip.endSec },
    language: {
      bcp47: languageBcp47,
      whisper: toWhisperLanguage(languageBcp47),
    },
    requestedBy: managerActorIdentity(actor),
  }

  const job = await createJob(sourceMuxAssetId, publicPlaybackId, [], {
    jobOptions: { shorts },
    steps: buildShortsInitialSteps("prepare"),
    // Launching intent only ({phase: "queued"}) — the workflows own all
    // other phase transitions (plan decision 2, single-writer rule).
    initialArtifacts: buildShortsMetadataArtifact(
      mergeShortsReport(null, { phase: "queued" }),
    ),
  })

  try {
    const { launchShorts } = await import("@/workflows/launchShorts")
    await launchShorts("prepare", job.id)
  } catch (error) {
    console.error(
      `[shorts] event=launch_failed jobId=${job.id} error=${
        error instanceof Error ? error.message : "unknown"
      }`,
    )
    // Fail the job rather than leaking a stuck pending record (smart-crop
    // create precedent).
    await updateJob(job.id, { status: "failed" }).catch(() => null)
    return NextResponse.json(
      { error: "Failed to launch the shorts prepare workflow" },
      { status: 500 },
    )
  }

  console.log(
    `[shorts] event=job_created jobId=${job.id} assetId=${shortAssetId} sourceMuxAssetId=${sourceMuxAssetId} clipStartSec=${clip.startSec} clipEndSec=${clip.endSec} actor=${managerActorIdentity(actor)}`,
  )

  return NextResponse.json({ job }, { status: 201 })
}

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const jobs = await listJobs({ limit: 100 })
  const shortsJobs = jobs.filter((job) => job.options.shorts != null)

  return NextResponse.json({ jobs: shortsJobs })
}
