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
  metaDescription: z.string().max(1000).optional(),
  blocks: BlocksSchema.optional().default([]),
})
export type CreateExperienceInput = z.infer<typeof CreateExperienceInput>

export const DuplicateExperienceInput = z.object({
  id: z.string().min(1),
})
export type DuplicateExperienceInput = z.infer<typeof DuplicateExperienceInput>

export const CreateExperienceLocaleInput = z.object({
  experienceId: z.string().min(1),
  locale: z.string().min(1).max(35),
  slug: z.string().min(1).max(200),
  title: z.string().max(500).optional(),
  metaDescription: z.string().max(1000).optional(),
  ogTitle: z.string().max(200).optional(),
  ogDescription: z.string().max(500).optional(),
  ogImageUrl: z.string().url().optional().nullable(),
  isHomepage: z.boolean().optional(),
  pathSegment: z.string().max(200).optional().nullable(),
  blocks: BlocksSchema.optional().default([]),
})
export type CreateExperienceLocaleInput = z.infer<
  typeof CreateExperienceLocaleInput
>

export const UpdateExperienceLocaleInput = z.object({
  id: z.string().min(1),
  slug: z.string().min(1).max(200).optional(),
  title: z.string().max(500).optional(),
  metaDescription: z.string().max(1000).optional(),
  ogTitle: z.string().max(200).optional(),
  ogDescription: z.string().max(500).optional(),
  ogImageUrl: z.string().url().optional().nullable(),
  isHomepage: z.boolean().optional(),
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

export const DiscardExperienceLocaleDraftInput = z.object({
  id: z.string().min(1),
})
export type DiscardExperienceLocaleDraftInput = z.infer<
  typeof DiscardExperienceLocaleDraftInput
>

/** The complete locale-owned state persisted in an ExperienceLocale draft. */
export const ExperienceLocaleDraftDataSchema = z.object({
  slug: z.string().min(1).max(200),
  isHomepage: z.boolean(),
  pathSegment: z.string().max(200).nullable(),
  title: z.string().max(500).nullable(),
  metaDescription: z.string().max(1000).nullable(),
  ogTitle: z.string().max(200).nullable(),
  ogDescription: z.string().max(500).nullable(),
  ogImageUrl: z.string().url().nullable(),
  blocks: BlocksSchema,
})
export type ExperienceLocaleDraftData = z.infer<
  typeof ExperienceLocaleDraftDataSchema
>

export const ExperienceLocaleDraftSnapshotSchema = z.object({
  v: z.literal(1),
  data: ExperienceLocaleDraftDataSchema,
})

export const RestoreExperienceLocaleRevisionInput = z.object({
  revisionId: z.string().min(1),
})
export type RestoreExperienceLocaleRevisionInput = z.infer<
  typeof RestoreExperienceLocaleRevisionInput
>

/**
 * Chat-driven mutation input. Mirrors {@link UpdateExperienceLocaleInput}
 * but with slug + isHomepage + pathSegment + ogTitle + ogDescription +
 * isTemplate intentionally OMITTED — the chat panel may only touch the
 * core editable surface (title, metaDescription, blocks, ogImageUrl).
 * Slug specifically is barred per U6/U7 of the experience-ai-chat plan.
 *
 * Validated at the top of `ExperienceService.applyChatMutation`. The
 * upstream Codex envelope is also `.strict()`-validated so unknown keys
 * never reach this schema, but this acts as a defense-in-depth boundary
 * for any future caller of `applyChatMutation`.
 */
export const ChatMutationInput = z.object({
  id: z.string().min(1),
  title: z.string().max(500).optional(),
  metaDescription: z.string().max(1000).nullable().optional(),
  ogImageUrl: z.string().url().nullable().optional(),
  blocks: BlocksSchema.optional(),
})
export type ChatMutationInput = z.infer<typeof ChatMutationInput>

export const ArchiveExperienceInput = z.object({
  id: z.string().min(1),
})
export type ArchiveExperienceInput = z.infer<typeof ArchiveExperienceInput>
