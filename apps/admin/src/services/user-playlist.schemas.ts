import { z } from "zod"

export const USER_PLAYLIST_LIMITS = Object.freeze({
  playlistsPerOwner: 20,
  maxBlocks: 50,
  itemsPerBlock: 100,
  totalItems: 500,
  title: 120,
  description: 2_000,
  text: 2_000,
  blockTitle: 120,
})

function hasWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

const ACTIVE_CONTENT_PATTERN =
  /(?:https?:\/\/|www\.|javascript:|data:|<[^>]*>|```|!\[[^\]]*\]\(|\[[^\]]+\]\(|(?:^|\n)\s{0,3}(?:#{1,6}\s|>\s|[-+*]\s|\d+\.\s)|(?:\*\*|__|~~).+(?:\*\*|__|~~))/i

function inertPlainText(max: number) {
  return z
    .string()
    .max(max)
    .refine(hasWellFormedUnicode, "Malformed Unicode is not allowed")
    .refine(
      (value) => !ACTIVE_CONTENT_PATTERN.test(value),
      "Markup, links, URLs, scripts, and embeds are not allowed",
    )
}

const requiredPlainText = (max: number) => inertPlainText(max).trim().min(1)

const canonicalMediaId = z
  .string()
  .min(1)
  .max(191)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Invalid canonical media ID")

const bcp47Locale = z
  .string()
  .min(2)
  .max(35)
  .refine((value) => {
    if (value.trim() !== value || value.includes("_")) return false
    try {
      return Intl.getCanonicalLocales(value).length === 1
    } catch {
      return false
    }
  }, "Invalid BCP-47 locale")

const isoCountry = z
  .string()
  .regex(/^[A-Z]{2}$/, "Country must be an ISO 3166-1 alpha-2 code")

export const UserPlaylistTextBlockSchema = z
  .object({
    t: z.literal("text"),
    text: requiredPlainText(USER_PLAYLIST_LIMITS.text),
  })
  .strict()

export const UserPlaylistMediaItemSchema = z
  .object({ videoId: canonicalMediaId })
  .strict()

const mediaItems = z
  .array(UserPlaylistMediaItemSchema)
  .min(1)
  .max(USER_PLAYLIST_LIMITS.itemsPerBlock)

export const UserPlaylistMediaCollectionBlockSchema = z
  .object({
    t: z.literal("mediaCollection"),
    title: requiredPlainText(USER_PLAYLIST_LIMITS.blockTitle).optional(),
    items: mediaItems,
  })
  .strict()

export const UserPlaylistVideoCarouselBlockSchema = z
  .object({
    t: z.literal("videoCarousel"),
    title: requiredPlainText(USER_PLAYLIST_LIMITS.blockTitle).optional(),
    items: mediaItems,
  })
  .strict()

export const UserPlaylistBlockSchema = z.discriminatedUnion("t", [
  UserPlaylistTextBlockSchema,
  UserPlaylistMediaCollectionBlockSchema,
  UserPlaylistVideoCarouselBlockSchema,
])

export type UserPlaylistBlock = z.infer<typeof UserPlaylistBlockSchema>

export const UserPlaylistSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    blocks: z
      .array(UserPlaylistBlockSchema)
      .max(USER_PLAYLIST_LIMITS.maxBlocks),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const totalItems = snapshot.blocks.reduce(
      (count, block) => count + ("items" in block ? block.items.length : 0),
      0,
    )
    if (totalItems > USER_PLAYLIST_LIMITS.totalItems) {
      context.addIssue({
        code: "custom",
        message: `A playlist may reference at most ${USER_PLAYLIST_LIMITS.totalItems} media items`,
        path: ["blocks"],
      })
    }
  })

export type UserPlaylistSnapshot = z.infer<typeof UserPlaylistSnapshotSchema>

export const UserPlaylistAcceptanceSchema = z
  .object({
    termsVersion: z.string().trim().min(1).max(64),
    privacyVersion: z.string().trim().min(1).max(64),
    communityGuidelinesVersion: z.string().trim().min(1).max(64),
  })
  .strict()

export type UserPlaylistAcceptance = z.infer<
  typeof UserPlaylistAcceptanceSchema
>

const playlistFields = {
  title: requiredPlainText(USER_PLAYLIST_LIMITS.title),
  description: inertPlainText(USER_PLAYLIST_LIMITS.description).default(""),
  locale: bcp47Locale,
  countryCode: isoCountry.nullable().optional(),
  blocks: z.array(UserPlaylistBlockSchema).max(USER_PLAYLIST_LIMITS.maxBlocks),
}

export const CreateUserPlaylistInputSchema = z
  .object({
    ...playlistFields,
    acceptance: UserPlaylistAcceptanceSchema,
  })
  .strict()
  .transform((input) => ({
    ...input,
    countryCode: input.countryCode ?? null,
    snapshot: UserPlaylistSnapshotSchema.parse({
      schemaVersion: 1,
      blocks: input.blocks,
    }),
  }))

export type CreateUserPlaylistInput = z.input<
  typeof CreateUserPlaylistInputSchema
>
export type ParsedCreateUserPlaylistInput = z.output<
  typeof CreateUserPlaylistInputSchema
>

export const UpdateUserPlaylistInputSchema = z
  .object({
    id: z.string().min(1).max(191),
    expectedVersion: z.number().int().positive(),
    ...playlistFields,
  })
  .strict()
  .transform((input) => ({
    ...input,
    countryCode: input.countryCode ?? null,
    snapshot: UserPlaylistSnapshotSchema.parse({
      schemaVersion: 1,
      blocks: input.blocks,
    }),
  }))

export type UpdateUserPlaylistInput = z.input<
  typeof UpdateUserPlaylistInputSchema
>

export const UserPlaylistIdOperationSchema = z
  .object({ id: z.string().min(1).max(191) })
  .strict()

export const VersionedUserPlaylistIdOperationSchema = z
  .object({
    id: z.string().min(1).max(191),
    expectedVersion: z.number().int().positive(),
  })
  .strict()

export function mediaIdsFromSnapshot(snapshot: UserPlaylistSnapshot): string[] {
  return [
    ...new Set(
      snapshot.blocks.flatMap((block) =>
        "items" in block ? block.items.map((item) => item.videoId) : [],
      ),
    ),
  ]
}
