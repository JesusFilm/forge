import { z } from "zod"

import { readBoundedSubtitleResponse } from "./subtitle-response-reader"

const MAX_JSON_BYTES = 256 * 1024
const MAX_VTT_BYTES = 1024 * 1024
const MAX_EVIDENCE_BYTES = MAX_JSON_BYTES + MAX_VTT_BYTES * 3

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

const boundedString = z.string().min(1).max(191)
const trackSchema = z
  .object({
    label: z.enum(["SOURCE", "A", "B"]),
    contentId: boundedString,
    mediaType: z.literal("text/vtt"),
  })
  .strict()
const receiptSchema = z
  .object({
    reviewId: boundedString,
    submittedAt: z.string().min(1).max(64),
    referenceTrackLabel: z.enum(["A", "B"]),
    candidateTrackLabel: z.enum(["A", "B"]),
    machineAdvisoryRiskFlags: z.array(boundedString).max(100),
    resolvedModel: z.string().min(1).max(191).nullable(),
    assessmentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
export const reviewerAssignmentSchema = z
  .object({
    id: boundedString,
    status: z.string().min(1).max(64),
    kind: z.string().min(1).max(64),
    round: z.number().int().positive().max(100),
    targetLanguageId: boundedString,
    targetLanguageSlug: boundedString,
    caseId: boundedString,
    collectionKey: boundedString,
    videoId: boundedString,
    editionIdentity: boundedString,
    clipStartSeconds: z.number().nonnegative().nullable(),
    clipEndSeconds: z.number().positive().nullable(),
    submitted: z.boolean(),
    postSubmitReceipt: receiptSchema.nullable(),
    sourceTrack: trackSchema,
    trackA: trackSchema,
    trackB: trackSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.submitted !== (value.postSubmitReceipt != null)) {
      context.addIssue({
        code: "custom",
        path: ["postSubmitReceipt"],
        message: "Receipt provenance is available only after submission",
      })
    }
  })
const queueItemSchema = z
  .object({
    id: boundedString,
    status: z.string().min(1).max(64),
    kind: z.string().min(1).max(64),
    round: z.number().int().positive().max(100),
    targetLanguageId: boundedString,
    targetLanguageSlug: boundedString,
    caseId: boundedString,
    collectionKey: boundedString,
    videoId: boundedString,
    assignedAt: z.string().min(1).max(64),
    submittedAt: z.string().min(1).max(64).nullable(),
  })
  .strict()
const queueSchema = z
  .object({
    nodes: z.array(queueItemSchema).max(50),
    nextCursor: boundedString.nullable(),
  })
  .strict()
const videoContextSchema = z.discriminatedUnion("status", [
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
const reviewerEvidenceSchema = z
  .object({
    detail: reviewerAssignmentSchema,
    sourceVtt: z.string().max(MAX_VTT_BYTES),
    trackAVtt: z.string().max(MAX_VTT_BYTES),
    trackBVtt: z.string().max(MAX_VTT_BYTES),
    video: videoContextSchema,
  })
  .strict()

export type ReviewerAssignment = z.infer<typeof reviewerAssignmentSchema>
export type ReviewerQueueItem = z.infer<typeof queueItemSchema>
export type ReviewVideoContext = z.infer<typeof videoContextSchema>

export type ReviewerQueueState =
  | { status: "loading" }
  | { status: "empty" }
  | {
      status: "ready"
      items: ReviewerQueueItem[]
      nextCursor: string | null
    }
  | { status: "error"; message: string; retryable?: boolean }

export type ReviewerAssignmentLoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string; retryable: boolean }
  | {
      status: "ready"
      detail: ReviewerAssignment
      sourceVtt: string
      trackAVtt: string
      trackBVtt: string
      video: ReviewVideoContext
    }

export async function loadReviewerQueue(
  after: string | null = null,
  fetchImpl: FetchLike = fetch,
): Promise<ReviewerQueueState> {
  try {
    const query = new URLSearchParams({ limit: "25" })
    if (after) query.set("after", after)
    const response = await fetchImpl(
      `/api/subtitle-lab/assignments?${query.toString()}`,
      {
        cache: "no-store",
        credentials: "same-origin",
      },
    )
    if (!response.ok) {
      return {
        status: "error",
        message: "The review service is temporarily unavailable.",
        retryable: response.status >= 500,
      }
    }
    const page = queueSchema.parse(
      JSON.parse(await readBoundedSubtitleResponse(response, MAX_JSON_BYTES)),
    )
    return page.nodes.length === 0 && after == null
      ? { status: "empty" }
      : { status: "ready", items: page.nodes, nextCursor: page.nextCursor }
  } catch {
    return {
      status: "error",
      message: "The review service is temporarily unavailable.",
      retryable: true,
    }
  }
}

export async function loadReviewerAssignment(
  assignmentId: string,
  fetchImpl: FetchLike = fetch,
): Promise<ReviewerAssignmentLoadState> {
  if (!/^[^/]{1,191}$/.test(assignmentId)) return { status: "not-found" }
  const base = `/api/subtitle-lab/assignments/${encodeURIComponent(assignmentId)}`
  try {
    const response = await fetchImpl(`${base}/evidence`, requestOptions())
    if (response.status === 404) return { status: "not-found" }
    if (!response.ok) return unavailableAssignment()
    const evidence = reviewerEvidenceSchema.parse(
      JSON.parse(
        await readBoundedSubtitleResponse(response, MAX_EVIDENCE_BYTES),
      ),
    )
    return {
      status: "ready",
      ...evidence,
    }
  } catch {
    return unavailableAssignment()
  }
}

function requestOptions(): RequestInit {
  return { cache: "no-store", credentials: "same-origin" }
}

function unavailableAssignment(): ReviewerAssignmentLoadState {
  return {
    status: "error",
    message:
      "This review is temporarily unavailable. Your assignment or language access may have changed.",
    retryable: true,
  }
}
