import { z } from "zod"

export const sharedAgentCapabilityFlagsSchema = z.object({
  supportsSessions: z.boolean().default(true),
  supportsWriteback: z.boolean().default(false),
  supportsVideoContext: z.boolean().default(false),
})

export type SharedAgentCapabilityFlags = z.infer<
  typeof sharedAgentCapabilityFlagsSchema
>

export const sharedAgentRecommendationSchema = z.object({
  label: z.string().trim().min(1).max(160),
  rationale: z.string().trim().min(1).max(2_000),
  appliesTo: z.array(z.string().trim().min(1).max(64)).default([]),
})

export type SharedAgentRecommendation = z.infer<
  typeof sharedAgentRecommendationSchema
>

export const sharedAgentDraftPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().min(1).max(8_000).optional(),
    slug: z.string().trim().min(1).max(255).optional(),
    snippet: z.string().trim().min(1).max(500).optional(),
    imageAlt: z.string().trim().min(1).max(255).optional(),
    targetLanguage: z.string().trim().min(1).max(64).optional(),
  })
  .refine(
    (value) =>
      value.title != null ||
      value.description != null ||
      value.slug != null ||
      value.snippet != null ||
      value.imageAlt != null,
    {
      message: "Draft patch must include at least one editable video field.",
    },
  )

export type SharedAgentDraftPatch = z.infer<typeof sharedAgentDraftPatchSchema>

export const sharedAgentStructuredResultSchema = z.object({
  summary: z.string().trim().min(1).max(1_500),
  markdown: z.string().trim().min(1).max(12_000),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  recommendations: z.array(sharedAgentRecommendationSchema).default([]),
  draftPatch: sharedAgentDraftPatchSchema.optional(),
  followupActions: z.array(z.string().trim().min(1).max(500)).default([]),
})

export type SharedAgentStructuredResult = z.infer<
  typeof sharedAgentStructuredResultSchema
>
