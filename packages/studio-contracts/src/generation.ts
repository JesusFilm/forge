import { z } from "zod"
import { studioChatSchema, studioProposalSchema } from "./agent"
export const studioGenerationOutputSchema = z
  .object({
    text: z.string().max(16000),
    proposals: z.array(studioProposalSchema).max(32),
    diagnostics: z.array(z.string().max(2000)).max(64),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(value)).length > 262144)
      ctx.addIssue({
        code: "custom",
        message: "Generation result exceeds 256 KiB",
      })
  })
/** Explicit production only. Calendar planners must never dispatch this contract. */
export const studioGenerationBatchSchema = z
  .object({
    requests: z.array(studioChatSchema).min(1).max(8),
    confirmed: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.requests.map((r) => r.projectId)).size !==
      value.requests.length
    )
      ctx.addIssue({
        code: "custom",
        message: "One admitted revision per project per batch",
      })
    if (new TextEncoder().encode(JSON.stringify(value)).length > 65536)
      ctx.addIssue({
        code: "custom",
        message: "Generation batch exceeds 64 KiB",
      })
  })
