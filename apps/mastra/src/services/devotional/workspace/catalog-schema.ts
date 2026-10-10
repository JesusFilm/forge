import { z } from "zod"

import { DEVOTIONAL_INPUT_CATEGORIES } from "./schemas"

export const CatalogDocumentSchema = z
  .object({
    path: z.string().startsWith("/inputs/"),
    category: z.enum(DEVOTIONAL_INPUT_CATEGORIES),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    size: z.number().int().nonnegative(),
    modifiedAt: z.string().datetime(),
    etag: z.string().optional(),
    title: z.string().min(1),
    content: z.string().min(1),
  })
  .strict()

export type CatalogDocument = z.infer<typeof CatalogDocumentSchema>

export const CatalogHeadSchema = z
  .object({
    generation: z.number().int().positive(),
    committedAt: z.string().datetime(),
    inventoryDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    documents: z.array(CatalogDocumentSchema),
  })
  .strict()

export type CatalogHead = z.infer<typeof CatalogHeadSchema>
