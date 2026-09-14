/**
 * Mobile in-app feedback (U2, KTD1).
 *
 * One public mutation whose outcome is DATA. The phone posts a submission and
 * gets back `accepted` plus a nullable refusal; admin files the Linear issue
 * before it answers (R11). Any OTHER error still throws, so a real fault is
 * never masked as a refusal.
 */

import { z } from "zod"

import { builder } from "@/graphql/builder"
import {
  getTrustedClientIp,
  identifyForRateLimit,
} from "@/graphql/plugins/rate-limit"
import { createLinearFeedbackIssue } from "@/services/feedback-linear"
import type { MobileFeedbackSubmission } from "@/services/feedback-linear"
import { checkFeedbackLimits } from "@/services/feedback-limits"

const FeedbackKindEnum = builder.enumType("FeedbackKind", {
  description: "What the person said the feedback was about.",
  values: {
    BROKEN: { value: "BROKEN" },
    IDEA: { value: "IDEA" },
    OTHER: { value: "OTHER" },
  } as const,
})

/** An enum, not a string: the phone's value indexes admin's platform label on
 * the way into the ticket, and a wrong spelling would reach that index
 * silently. The wire spelling is uppercase on BOTH sides. */
const FeedbackPlatformEnum = builder.enumType("FeedbackPlatform", {
  values: { IOS: { value: "IOS" }, ANDROID: { value: "ANDROID" } } as const,
})

/** A refusal is DATA, not thrown: a throw would reach the phone as Yoga's
 * masked "Unexpected error." and file a RUM error per refusal (KTD9). */
const FeedbackRefusalEnum = builder.enumType("FeedbackRefusal", {
  values: {
    INVALID_INPUT: { value: "INVALID_INPUT" },
    RATE_LIMITED: { value: "RATE_LIMITED" },
    /** Kept separate from RATE_LIMITED (KD10): the wire value + admin's log
     * are how an operator tells a busy install from the fleet kill switch. */
    DAILY_CAP: { value: "DAILY_CAP" },
    UNAVAILABLE: { value: "UNAVAILABLE" },
    NOT_CONFIGURED: { value: "NOT_CONFIGURED" },
  } as const,
})

const FeedbackVideoContextInput = builder.inputType(
  "FeedbackVideoContextInput",
  {
    description:
      "The video the person tagged. Absent when they tagged nothing.",
    fields: (t) => ({
      title: t.string({ required: true }),
      positionSeconds: t.float({ required: false }),
      slug: t.string({ required: false }),
      languageSlug: t.string({ required: false }),
    }),
  },
)

const FeedbackDeviceDetailsInput = builder.inputType(
  "FeedbackDeviceDetailsInput",
  {
    description:
      "Sent only when the person left the device-details switch on. All four fields travel together.",
    fields: (t) => ({
      appVersion: t.string({ required: true }),
      appBuild: t.string({ required: true }),
      osVersion: t.string({ required: true }),
      deviceModel: t.string({ required: true }),
    }),
  },
)

const FeedbackSubmissionInput = builder.inputType("FeedbackSubmissionInput", {
  fields: (t) => ({
    submissionId: t.string({
      required: true,
      description:
        "Client-generated UUID. Carried into the ticket for support.",
    }),
    kind: t.field({ type: FeedbackKindEnum, required: true }),
    message: t.string({ required: true }),
    platform: t.field({ type: FeedbackPlatformEnum, required: true }),
    name: t.string({ required: false }),
    email: t.string({ required: false }),
    video: t.field({ type: FeedbackVideoContextInput, required: false }),
    deviceDetails: t.field({
      type: FeedbackDeviceDetailsInput,
      required: false,
    }),
  }),
})

type FeedbackRefusal =
  | "INVALID_INPUT"
  | "RATE_LIMITED"
  | "DAILY_CAP"
  | "UNAVAILABLE"
  | "NOT_CONFIGURED"

type FeedbackSubmissionResult = {
  accepted: boolean
  refusal: FeedbackRefusal | null
}

const FeedbackSubmissionResultRef = builder
  .objectRef<FeedbackSubmissionResult>("FeedbackSubmissionResult")
  .implement({
    description:
      "Outcome of one submission. `accepted: false` with a refusal is an expected answer, not an error.",
    fields: (t) => ({
      accepted: t.exposeBoolean("accepted", { nullable: false }),
      refusal: t.field({
        type: FeedbackRefusalEnum,
        nullable: true,
        description:
          "Null when accepted. Every value renders the same message on the phone; it exists so operators can tell them apart.",
        resolve: (result) => result.refusal,
      }),
    }),
  })

const bounded = (max: number) => z.string().trim().min(1).max(max)

/** A slug reaches the ticket as a bare word, so bound the charset rather
 * than the exact shape — over-tight matching would refuse a real person's
 * feedback over a field they never typed. */
const SLUG = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u)

/** KTD7. The phone checks the same bounds before Send, so a failure here
 *  should never happen and answers `INVALID_INPUT`. */
const submissionSchema = z
  .object({
    submissionId: z.uuid(),
    kind: z.enum(["BROKEN", "IDEA", "OTHER"]),
    message: z.string().trim().min(10).max(1000),
    platform: z.enum(["IOS", "ANDROID"]),
    name: bounded(100).optional(),
    email: z.email().max(254).optional(),
    video: z
      .object({
        title: bounded(200),
        // A position past this is not a real playhead, and the ticket line
        // that formats it has to stay one short field.
        positionSeconds: z.number().min(0).max(1_000_000).optional(),
        slug: SLUG.optional(),
        languageSlug: SLUG.optional(),
      })
      .strict()
      .optional(),
    deviceDetails: z
      .object({
        appVersion: bounded(100),
        appBuild: bounded(100),
        osVersion: bounded(100),
        deviceModel: bounded(100),
      })
      .strict()
      .optional(),
  })
  .strict()

/** Plain-string key=value: Railway logsV2 drops JSON-stringified payloads
 * from a Next.js handler. Never carries the message, the name, or the email. */
function refuse(
  refusal: FeedbackRefusal,
  detail: string,
): FeedbackSubmissionResult {
  console.warn(`[feedback] event=refused refusal=${refusal} ${detail}`)
  return { accepted: false, refusal }
}

/** Drops the absent optionals so the parsed object matches U1's type. */
function toCandidate(input: {
  submissionId: string
  kind: "BROKEN" | "IDEA" | "OTHER"
  message: string
  platform: "IOS" | "ANDROID"
  name?: string | null
  email?: string | null
  video?: {
    title: string
    positionSeconds?: number | null
    slug?: string | null
    languageSlug?: string | null
  } | null
  deviceDetails?: {
    appVersion: string
    appBuild: string
    osVersion: string
    deviceModel: string
  } | null
}): Record<string, unknown> {
  const video = input.video
  return {
    submissionId: input.submissionId,
    kind: input.kind,
    message: input.message,
    platform: input.platform,
    ...(input.name != null ? { name: input.name } : {}),
    ...(input.email != null ? { email: input.email } : {}),
    ...(video != null
      ? {
          video: {
            title: video.title,
            ...(video.positionSeconds != null
              ? { positionSeconds: video.positionSeconds }
              : {}),
            ...(video.slug != null ? { slug: video.slug } : {}),
            ...(video.languageSlug != null
              ? { languageSlug: video.languageSlug }
              : {}),
          },
        }
      : {}),
    ...(input.deviceDetails != null
      ? { deviceDetails: { ...input.deviceDetails } }
      : {}),
  }
}

builder.mutationFields((t) => ({
  submitFeedback: t.field({
    type: FeedbackSubmissionResultRef,
    nullable: false,
    authScopes: { public: true },
    description:
      "File one piece of mobile feedback. Signed in or not. The Linear issue exists before this answers.",
    args: {
      input: t.arg({ type: FeedbackSubmissionInput, required: true }),
    },
    resolve: async (_root, args, ctx): Promise<FeedbackSubmissionResult> => {
      const parsed = submissionSchema.safeParse(toCandidate(args.input))
      if (!parsed.success) {
        // Field NAMES only. Every value in this submission is client text.
        const fields = parsed.error.issues
          .map((issue) => issue.path.join("."))
          .join(",")
        return refuse("INVALID_INPUT", `fields=${fields}`)
      }

      const decision = await checkFeedbackLimits({
        installIdentity: identifyForRateLimit(ctx),
        clientIp: getTrustedClientIp(ctx.request),
      })
      if (!decision.allowed) {
        return refuse(decision.refusal, `scope=${decision.scope}`)
      }

      // Annotated, never cast: this assignment is what fails the build if the
      // bounds above ever stop matching U1's contract.
      const submission: MobileFeedbackSubmission = parsed.data
      const outcome = await createLinearFeedbackIssue(submission)
      if (outcome.status === "created") return { accepted: true, refusal: null }
      if (outcome.reason === "config_missing") {
        return refuse("NOT_CONFIGURED", `reason=${outcome.reason}`)
      }
      if (outcome.reason === "rate_limited") {
        return refuse("RATE_LIMITED", `reason=${outcome.reason}`)
      }
      return refuse("UNAVAILABLE", `reason=${outcome.reason}`)
    },
  }),
}))
