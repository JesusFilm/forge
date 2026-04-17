// Zod input schemas for Experience service mutations.
//
// Validated at the top of every service method before any DB call.
// GraphQL resolvers pass raw args; services parse them here.

import { z } from "zod"
import { BlocksSchema } from "@/domain/blocks"

export const CreateExperienceInput = z.object({
  isTemplate: z.boolean().default(false),
  locale: z.string().min(1).max(35),
  slug: z.string().min(1).max(200),
  title: z.string().min(1).max(500).optional(),
  blocks: BlocksSchema.optional().default([]),
})
export type CreateExperienceInput = z.infer<typeof CreateExperienceInput>

export const UpdateExperienceLocaleInput = z.object({
  id: z.string().min(1),
  slug: z.string().min(1).max(200).optional(),
  title: z.string().max(500).optional(),
  metaDescription: z.string().max(1000).optional(),
  ogTitle: z.string().max(200).optional(),
  ogDescription: z.string().max(500).optional(),
  ogImageUrl: z.string().url().optional().nullable(),
  isHomepage: z.boolean().optional(),
  isTemplate: z.boolean().optional(),
  pathSegment: z.string().max(200).optional().nullable(),
  blocks: BlocksSchema.optional(),
})
export type UpdateExperienceLocaleInput = z.infer<
  typeof UpdateExperienceLocaleInput
>

export const PublishExperienceLocaleInput = z.object({
  id: z.string().min(1),
})
export type PublishExperienceLocaleInput = z.infer<
  typeof PublishExperienceLocaleInput
>

export const RestoreExperienceLocaleRevisionInput = z.object({
  revisionId: z.string().min(1),
})
export type RestoreExperienceLocaleRevisionInput = z.infer<
  typeof RestoreExperienceLocaleRevisionInput
>

export const ArchiveExperienceInput = z.object({
  id: z.string().min(1),
})
export type ArchiveExperienceInput = z.infer<typeof ArchiveExperienceInput>
