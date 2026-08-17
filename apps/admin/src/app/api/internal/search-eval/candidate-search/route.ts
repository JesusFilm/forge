import { z } from "zod"

import { createCandidateSearchEvalPostHandler } from "../create-candidate-search-eval-handler"

const CandidateSearchEvalInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    locale: z.string().trim().min(1).max(32),
    languageSlug: z.string().trim().min(1).max(128).optional(),
    clientRequestId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,80}$/)
      .optional(),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).optional(),
    mode: z.literal("modern").default("modern"),
    contentType: z.enum(["video", "experience"]).nullable().optional(),
  })
  .strict()

export const POST = createCandidateSearchEvalPostHandler({
  source: "EVALUATION",
  schema: CandidateSearchEvalInputSchema,
  rateLimitRoute: "candidate-search-eval-search",
  invalidInputError: "Invalid Candidate search eval input",
  unavailableError: "Candidate search eval is temporarily unavailable",
})
