import { z } from "zod"

import { readBoundedSubtitleResponse } from "@/features/subtitle-lab/subtitle-response-reader"

const MAX_JSON_BYTES = 256 * 1024
const MAX_VTT_BYTES = 1024 * 1024

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

const boundedString = z.string().min(1).max(191)
const operatorVideoContextSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ready"),
      playbackId: boundedString,
      playbackUrl: z.string().url().max(2_048),
      durationSeconds: z.number().nonnegative().nullable(),
      clip: z
        .object({
          startSeconds: z.number().nonnegative(),
          endSeconds: z.number().positive(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      status: z.literal("blocked"),
      reason: z.enum(["VIDEO_CONTEXT_UNAVAILABLE", "PLAYBACK_UNAVAILABLE"]),
    })
    .strict(),
])

export type OperatorAssignmentEvidenceState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | {
      status: "ready"
      sourceVtt: string
      referenceVtt: string
      candidateVtt: string
      video: z.infer<typeof operatorVideoContextSchema>
    }

export async function loadOperatorAssignmentEvidence(
  assignmentId: string,
  fetchImpl: FetchLike = fetch,
): Promise<OperatorAssignmentEvidenceState> {
  if (!/^[^/]{1,191}$/.test(assignmentId)) return { status: "not-found" }
  const base = `/api/subtitle-lab/assignments/${encodeURIComponent(assignmentId)}/operator-artifacts`
  try {
    const [
      sourceResponse,
      referenceResponse,
      candidateResponse,
      videoResponse,
    ] = await Promise.all([
      fetchImpl(`${base}/source`, requestOptions()),
      fetchImpl(`${base}/reference`, requestOptions()),
      fetchImpl(`${base}/candidate`, requestOptions()),
      fetchImpl(`${base}/video-context`, requestOptions()),
    ])
    if (
      !sourceResponse.ok ||
      !referenceResponse.ok ||
      !candidateResponse.ok ||
      !videoResponse.ok
    ) {
      return sourceResponse.status === 404 ||
        referenceResponse.status === 404 ||
        candidateResponse.status === 404
        ? { status: "not-found" }
        : unavailableEvidence()
    }
    const [sourceVtt, referenceVtt, candidateVtt, videoText] =
      await Promise.all([
        readBoundedSubtitleResponse(sourceResponse, MAX_VTT_BYTES),
        readBoundedSubtitleResponse(referenceResponse, MAX_VTT_BYTES),
        readBoundedSubtitleResponse(candidateResponse, MAX_VTT_BYTES),
        readBoundedSubtitleResponse(videoResponse, MAX_JSON_BYTES),
      ])
    return {
      status: "ready",
      sourceVtt,
      referenceVtt,
      candidateVtt,
      video: operatorVideoContextSchema.parse(JSON.parse(videoText)),
    }
  } catch {
    return unavailableEvidence()
  }
}

function requestOptions(): RequestInit {
  return { cache: "no-store", credentials: "same-origin" }
}

function unavailableEvidence(): OperatorAssignmentEvidenceState {
  return {
    status: "error",
    message:
      "Operator evidence is temporarily unavailable. No storage locator was exposed.",
  }
}
