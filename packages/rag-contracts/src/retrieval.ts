import { z } from "zod"

export const citationSchema = z
  .object({
    sourceKey: z.string(),
    sourceName: z.string(),
    title: z.string().nullable(),
    url: z.string(),
  })
  .strict()

export const retrievalPolicySchema = z
  .object({
    allowedSourceKeys: z.array(z.string()).optional(),
    preferSourceKey: z.string().optional(),
    language: z.string().optional(),
    category: z.string().optional(),
    topK: z.number().int().positive().max(50).optional(),
    minScore: z.number().min(0).max(1).optional(),
    includeDocument: z.boolean().optional(),
  })
  .strict()

export const rankedResultSchema = z
  .object({
    chunkId: z.string(),
    score: z.number(),
    text: z.string(),
    ord: z.number().int(),
    tags: z.array(z.string()),
    citation: citationSchema,
    document: z.string().optional(),
  })
  .strict()

export const searchRequestSchema = z
  .object({
    query: z.string().min(1).max(2000),
    policy: retrievalPolicySchema.optional(),
  })
  .strict()

export const searchResponseSchema = z
  .object({ results: z.array(rankedResultSchema) })
  .strict()

export type Citation = z.infer<typeof citationSchema>
export type RetrievalPolicy = z.infer<typeof retrievalPolicySchema>
export type RankedResult = z.infer<typeof rankedResultSchema>
export type SearchRequest = z.infer<typeof searchRequestSchema>
export type SearchResponse = z.infer<typeof searchResponseSchema>
