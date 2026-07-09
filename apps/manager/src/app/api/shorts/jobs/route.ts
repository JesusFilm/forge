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
import { requireShortsWorkerConfig } from "@/lib/shorts-config"
import {
  buildShortsMetadataArtifact,
  mergeShortsReport,
} from "@/lib/shorts-report"
import { toWhisperLanguage } from "@/lib/whisper-language"
import { buildShortsInitialSteps } from "@/lib/workflow-steps"
import { createJob, listJobs, updateJob } from "@/lib/state"
import type { ShortsJobOptions } from "@/types/job"

const ASSET_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const SOURCE_SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/
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
    sourceSlug: z.string().trim().regex(SOURCE_SLUG_PATTERN).optional(),
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

export type ShortsCreateRejectionReason =
  | "video_not_found"
  | "missing_mux_asset"
  | "playback_not_public"
  | "asset_mismatch"
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

  const configMissing = requireShortsWorkerConfig()
  if (configMissing) return configMissing

  const body = parsed.data

  // ---------------------------------------------------------------------
  // Resolve the source video: coreId → admin lookup (mux asset + language +
  // title); muxAssetId-only → no admin metadata (language unknown → whisper
  // transcription degrades per plan decision 5).
  // ---------------------------------------------------------------------
  let sourceMuxAssetId = body.muxAssetId ?? null
  let sourceCoreId: string | undefined
  const sourceSlug = body.sourceSlug
  let sourceTitle = body.title
  let sourceVideoTitle: string | undefined
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
      return validationFailed(
        "asset_mismatch",
        `muxAssetId ${body.muxAssetId} does not match the Mux asset of video ${body.coreId} (${video.muxAssetId}) — supply one or the other`,
        400,
      )
    }

    sourceMuxAssetId = video.muxAssetId
    sourceCoreId = video.coreId
    sourceVideoTitle = video.label ?? undefined
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
    // Upstream failure, not a validation rejection — mirror the videos
    // route's agent-native envelope (502 mux_error, retryable) so a
    // transient Mux outage never reads as a permanent 4xx.
    return NextResponse.json(
      {
        error: `Could not resolve Mux asset ${sourceMuxAssetId}: ${
          error instanceof Error ? error.message : "unknown Mux error"
        }`,
        reason: "mux_error",
        retryable: true,
      },
      { status: 502 },
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
  // No re-validation needed: sourceMuxAssetId already passed
  // ASSET_ID_PATTERN above and the appended suffix is hex-only.
  const suffix = randomBytes(4).toString("hex")
  const shortAssetId = `${sourceMuxAssetId}-short-${suffix}`

  const shorts: ShortsJobOptions = {
    assetId: shortAssetId,
    sourceMuxAssetId,
    sourcePlaybackId: publicPlaybackId,
    ...(sourceCoreId ? { sourceCoreId } : {}),
    ...(sourceSlug ? { sourceSlug } : {}),
    ...(sourceTitle ? { sourceTitle } : {}),
    clip: { startSec: clip.startSec, endSec: clip.endSec },
    language: {
      bcp47: languageBcp47,
      whisper: toWhisperLanguage(languageBcp47),
    },
    requestedBy: managerActorIdentity(actor),
  }

  const job = await createJob(sourceMuxAssetId, publicPlaybackId, [], {
    ...(sourceVideoTitle ? { sourceMediaTitle: sourceVideoTitle } : {}),
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
    // create precedent). The failed job's id is returned so callers recover
    // via POST /api/shorts/jobs/{id}/retry (which allows a prepare relaunch
    // from phase "queued" + status "failed") instead of re-POSTing this
    // route and minting a duplicate job — hence retryable: false here.
    await updateJob(job.id, { status: "failed" }).catch(() => null)
    return NextResponse.json(
      {
        error: "Failed to launch the shorts prepare workflow",
        reason: "launch_failed",
        retryable: false,
        jobId: job.id,
      },
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

  // Cross-kind cap tradeoff: listJobs limits across ALL job kinds BEFORE the
  // shorts filter below, so a busy enrichment/smart-crop fleet can crowd
  // shorts jobs out of the window. 250 keeps the read bounded while leaving
  // ample headroom for the realistic shorts volume (3-operator tool); if the
  // fleet outgrows it, page until N shorts are collected instead.
  const jobs = await listJobs({ limit: 250 })
  const shortsJobs = jobs.filter((job) => job.options.shorts != null)

  return NextResponse.json({ jobs: shortsJobs })
}
