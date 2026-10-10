import { z } from "zod"
import {
  buildDraftExperienceJsonSchema,
  DraftExperienceSchema,
} from "@forge/experience-schema"

export const QualityDraftReferenceLedgerEntrySchema = z
  .object({
    sourceKind: z.enum([
      "scripture",
      "provided_source",
      "video_candidate",
      "needs_verification",
    ]),
    claim: z.string().trim().min(1),
    reference: z.string().trim().min(1),
    url: z.string().url().optional(),
    candidateRef: z.string().trim().min(1).optional(),
    note: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.url && entry.sourceKind !== "provided_source") {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "Only provided_source entries may include URLs",
      })
    }
  })

export const QualityDraftReviewSchema = z
  .object({
    scriptureNotes: z.array(z.string().trim().min(1)).min(1),
    researchNotes: z.array(z.string().trim().min(1)).default([]),
    theologyReview: z
      .object({
        status: z.enum(["passed", "needs_review"]),
        notes: z.array(z.string().trim().min(1)).default([]),
      })
      .strict(),
    referenceLedger: z.array(QualityDraftReferenceLedgerEntrySchema).min(1),
  })
  .strict()

export const QualityDraftPackageSchema = z
  .object({
    draft: DraftExperienceSchema,
    review: QualityDraftReviewSchema,
    imageDirection: z.string().trim().min(1).optional(),
  })
  .strict()

export type QualityDraftPackage = z.infer<typeof QualityDraftPackageSchema>
export type QualityDraftReview = z.infer<typeof QualityDraftReviewSchema>
export type QualityDraftReferenceLedgerEntry = z.infer<
  typeof QualityDraftReferenceLedgerEntrySchema
>

export function buildQualityDraftJsonSchema() {
  if (typeof z.toJSONSchema === "function") {
    return z.toJSONSchema(QualityDraftPackageSchema)
  }

  return {
    type: "object",
    additionalProperties: false,
    required: ["draft", "review"],
    properties: {
      draft: buildDraftExperienceJsonSchema(),
      review: {
        type: "object",
        additionalProperties: false,
        required: [
          "scriptureNotes",
          "researchNotes",
          "theologyReview",
          "referenceLedger",
        ],
        properties: {
          scriptureNotes: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
          researchNotes: { type: "array", items: { type: "string" } },
          theologyReview: {
            type: "object",
            additionalProperties: false,
            required: ["status", "notes"],
            properties: {
              status: { type: "string", enum: ["passed", "needs_review"] },
              notes: { type: "array", items: { type: "string" } },
            },
          },
          referenceLedger: {
            type: "array",
            minItems: 1,
            items: { type: "object" },
          },
        },
      },
      imageDirection: { type: "string" },
    },
  }
}
