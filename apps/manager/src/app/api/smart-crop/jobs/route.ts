// POST /api/smart-crop/jobs — create a smart-crop job (canonical or
// localized) and launch the durable workflow.
// GET /api/smart-crop/jobs — list smart-crop jobs (options.smartCrop present).
//
// Plan 2026-06-09-002 "API routes".

import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import { env } from "@/config/env"
import { buildSmartCropMetadataArtifact } from "@/lib/smart-crop-report"
import { buildSmartCropInitialSteps } from "@/lib/workflow-steps"
import { createJob, listJobs, updateJob } from "@/lib/state"
import type { SmartCropJobOptions } from "@/types/job"

const ASSET_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
// Mux playback IDs are alphanumeric; the playback id is interpolated into the
// crop-worker ffmpeg source URL, so validate the shape at the boundary (both
// operator-supplied and Mux-resolved values).
const PLAYBACK_ID_PATTERN = /^[a-zA-Z0-9]+$/
const LANGUAGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i

const createSmartCropJobSchema = z
  .object({
    kind: z.enum(["canonical", "localized"]),
    muxAssetId: z.string().min(1),
    playbackId: z.string().regex(PLAYBACK_ID_PATTERN).optional(),
    assetId: z.string().regex(ASSET_ID_PATTERN).optional(),
    language: z.string().regex(LANGUAGE_SLUG_PATTERN).optional(),
    canonicalAssetId: z.string().regex(ASSET_ID_PATTERN).optional(),
    cropMode: z
      .enum(["auto", "speaker", "group", "object", "slide_aware"])
      .default("auto"),
    model: z.string().min(1).optional(),
    force: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "localized") {
      if (!value.language) {
        ctx.addIssue({
          code: "custom",
          path: ["language"],
          message: "language is required for localized smart-crop jobs",
        })
      }
      if (!value.canonicalAssetId) {
        ctx.addIssue({
          code: "custom",
          path: ["canonicalAssetId"],
          message: "canonicalAssetId is required for localized smart-crop jobs",
        })
      }
      // Localized artifacts live under the localized assetId; sharing the
      // canonical prefix would silently overwrite canonical artifacts.
      if (
        value.canonicalAssetId &&
        (value.assetId ?? value.muxAssetId) === value.canonicalAssetId
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["assetId"],
          message:
            "localized assetId must differ from canonicalAssetId (it would overwrite the canonical smart-crop artifacts) — supply a distinct assetId",
        })
      }
    }
  })

function getMissingSmartCropConfig(): string[] {
  const missing: string[] = []
  if (!env.CROP_WORKER_BASE_URL) missing.push("CROP_WORKER_BASE_URL")
  if (!env.CROP_WORKER_API_KEY) missing.push("CROP_WORKER_API_KEY")
  if (!env.MASTRA_BASE_URL) missing.push("MASTRA_BASE_URL")
  if (!env.MASTRA_SERVICE_API_KEY) missing.push("MASTRA_SERVICE_API_KEY")
  return missing
}

export async function POST(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = createSmartCropJobSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const missingConfig = getMissingSmartCropConfig()
  if (missingConfig.length > 0) {
    return NextResponse.json(
      {
        error: "Smart Crop is not configured on this Manager deployment",
        reason: "config_missing",
        messages: [`Missing env vars: ${missingConfig.join(", ")}`],
        retryable: false,
      },
      { status: 503 },
    )
  }

  const body = parsed.data
  const assetId = body.assetId ?? body.muxAssetId
  if (!ASSET_ID_PATTERN.test(assetId)) {
    return NextResponse.json(
      {
        error:
          "muxAssetId is not a valid storage assetId (alphanumeric, hyphen, underscore) — provide assetId explicitly",
      },
      { status: 400 },
    )
  }

  let playbackId = body.playbackId
  if (!playbackId) {
    try {
      const { getMuxAsset } = await import("@/services/mux")
      playbackId = (await getMuxAsset(body.muxAssetId)).playbackId
    } catch (error) {
      return NextResponse.json(
        {
          error: `Could not resolve a playback ID for Mux asset ${body.muxAssetId}: ${
            error instanceof Error ? error.message : "unknown Mux error"
          }`,
        },
        { status: 400 },
      )
    }
  }

  // Mux-resolved values go through the same shape gate as operator-supplied
  // ones before being interpolated into crop-worker source URLs.
  if (!PLAYBACK_ID_PATTERN.test(playbackId)) {
    return NextResponse.json(
      {
        error: `Resolved playback ID for Mux asset ${body.muxAssetId} is not a valid Mux playback ID (alphanumeric)`,
      },
      { status: 400 },
    )
  }

  if (body.kind === "localized" && body.canonicalAssetId) {
    const { artifactExists } = await import("@/services/storage")
    const planExists = await artifactExists(
      body.canonicalAssetId,
      "smart-crop-plan-9x16-v1",
      "json",
    )
    if (!planExists) {
      return NextResponse.json(
        {
          error: `No canonical smart-crop plan artifact found for ${body.canonicalAssetId} — run and approve a canonical job first`,
          reason: "canonical_plan_missing",
        },
        { status: 400 },
      )
    }
  }

  const smartCrop: SmartCropJobOptions = {
    kind: body.kind,
    assetId,
    targetAspectRatio: "9:16",
    cropMode: body.cropMode,
    ...(body.kind === "localized"
      ? { canonicalAssetId: body.canonicalAssetId, language: body.language }
      : {}),
    ...(body.model ? { model: body.model } : {}),
    ...(body.force ? { force: true } : {}),
  }

  const job = await createJob(
    body.muxAssetId,
    playbackId,
    body.kind === "localized" && body.language ? [body.language] : [],
    {
      jobOptions: { smartCrop },
      steps: buildSmartCropInitialSteps(body.kind),
      initialArtifacts: buildSmartCropMetadataArtifact({
        domain: "smart_crop",
        kind: body.kind,
        phase: "queued",
      }),
    },
  )

  try {
    const { launchSmartCrop } = await import("@/workflows/launchSmartCrop")
    if (body.kind === "localized") {
      await launchSmartCrop({
        kind: "localized",
        jobId: job.id,
        assetId,
        muxAssetId: body.muxAssetId,
        playbackId,
        cropMode: body.cropMode,
        model: body.model,
        force: body.force,
        // Guaranteed by schema superRefine for localized jobs.
        canonicalAssetId: body.canonicalAssetId ?? "",
        language: body.language ?? "",
      })
    } else {
      await launchSmartCrop({
        kind: "canonical",
        jobId: job.id,
        assetId,
        muxAssetId: body.muxAssetId,
        playbackId,
        cropMode: body.cropMode,
        model: body.model,
        force: body.force,
      })
    }
  } catch (error) {
    console.error(
      `[smart-crop] event=launch_failed jobId=${job.id} error=${
        error instanceof Error ? error.message : "unknown"
      }`,
    )
    await updateJob(job.id, { status: "failed" }).catch(() => null)
    return NextResponse.json(
      { error: "Failed to launch the smart-crop workflow" },
      { status: 500 },
    )
  }

  return NextResponse.json({ job }, { status: 201 })
}

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const jobs = await listJobs({ limit: 100 })
  const smartCropJobs = jobs.filter((job) => job.options.smartCrop != null)

  return NextResponse.json({ jobs: smartCropJobs })
}
