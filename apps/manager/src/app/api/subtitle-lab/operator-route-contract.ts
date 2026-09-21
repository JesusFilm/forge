import { z } from "zod"

import { BOUNDED_ID } from "@/features/subtitle-lab/subtitle-lab-contract"

const boundedText = z.string().trim().min(1).max(4_000)
const optionalBoundedText = z.string().trim().max(4_000).nullable()

export const corpusApprovalBodySchema = z
  .object({
    reason: boundedText,
    certification: z
      .object({
        schemaVersion: z.literal(1),
        authority: BOUNDED_ID,
        sourceTracksVerified: z.number().int().positive().max(100),
        referenceTracksVerified: z.number().int().positive().max(100),
        humanAuthorshipConfirmed: z.literal(true),
        languageIdentityConfirmed: z.literal(true),
        certifiedAt: z
          .string()
          .trim()
          .regex(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/,
          ),
        notes: optionalBoundedText,
      })
      .strict(),
  })
  .strict()

export const createComparisonBodySchema = z
  .object({
    idempotencyKey: BOUNDED_ID,
    baselineReportId: BOUNDED_ID,
    candidateReportId: BOUNDED_ID,
    changedAxis: z.enum([
      "CODE_REVISION",
      "MODEL",
      "PROMPT_POLICY",
      "RUNTIME",
      "WORKFLOW_POLICY",
    ]),
  })
  .strict()
  .refine(
    (value) => value.baselineReportId !== value.candidateReportId,
    "Baseline and candidate reports must differ.",
  )

export const appendNarrativeBodySchema = z
  .object({
    hypothesis: boundedText,
    conclusion: optionalBoundedText,
    rationale: optionalBoundedText,
    followUpAction: optionalBoundedText,
  })
  .strict()

export const referenceIssueDispositionBodySchema = z
  .object({
    disposition: z.enum(["ACCEPTED", "REJECTED"]),
    reason: boundedText,
    correctedCorpusVersionId: BOUNDED_ID.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.disposition === "ACCEPTED" &&
      value.correctedCorpusVersionId == null
    ) {
      context.addIssue({
        code: "custom",
        message: "An accepted correction requires a superseding corpus.",
        path: ["correctedCorpusVersionId"],
      })
    }
    if (
      value.disposition === "REJECTED" &&
      value.correctedCorpusVersionId != null
    ) {
      context.addIssue({
        code: "custom",
        message: "A rejected correction cannot name a corrected corpus.",
        path: ["correctedCorpusVersionId"],
      })
    }
  })

export const specialistAssignmentBodySchema = z
  .object({ reviewerMembershipId: BOUNDED_ID })
  .strict()

export const referenceIssueStatusSchema = z.enum([
  "OPEN",
  "ACCEPTED",
  "REJECTED",
])

export const specialistDimensionSchema = z
  .enum(["SCRIPTURE", "THEOLOGY", "SCRIPTURE_THEOLOGY"])
  .optional()
