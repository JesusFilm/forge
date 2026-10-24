import { z } from "zod"

import { ABSOLUTE_PUBLIC_WATCH_QUERY_SET_VERSION } from "./absolute-query-set"

const RelevanceGradeSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
])

export const AbsoluteRelevanceJudgmentsSchema = z.record(
  z.string().trim().min(1).max(128),
  z.record(z.string().trim().min(1).max(256), RelevanceGradeSchema),
)

export const AbsoluteRelevanceJudgmentSetSchema = z
  .object({
    version: z.string().trim().min(1).max(128),
    querySetVersion: z.literal(ABSOLUTE_PUBLIC_WATCH_QUERY_SET_VERSION),
    judgments: AbsoluteRelevanceJudgmentsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value.judgments).length > 150) {
      context.addIssue({
        code: "custom",
        message: "A relevance judgment set may contain at most 150 cases",
      })
    }
    for (const [caseId, judgments] of Object.entries(value.judgments)) {
      if (Object.keys(judgments).length > 100) {
        context.addIssue({
          code: "custom",
          message: `Relevance case ${caseId} may contain at most 100 result judgments`,
        })
      }
    }
  })

export type AbsoluteRelevanceJudgments = z.infer<
  typeof AbsoluteRelevanceJudgmentsSchema
>
export type AbsoluteRelevanceJudgmentSet = z.infer<
  typeof AbsoluteRelevanceJudgmentSetSchema
>

// Deliberately incomplete until the remote candidate results have been reviewed.
// A complete reviewed set is supplied to Mastra during development iteration and
// committed here only when the candidate is frozen for the held-out release gate.
export const repositoryAbsoluteRelevanceJudgmentSet = {
  version: "public-watch-qrels/unreviewed-v1",
  querySetVersion: ABSOLUTE_PUBLIC_WATCH_QUERY_SET_VERSION,
  judgments: {},
} satisfies AbsoluteRelevanceJudgmentSet
