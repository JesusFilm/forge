import { z } from "zod"

export const categorySchema = z.enum(["problem", "confusing", "idea", "praise"])
export const platformSchema = z.enum(["apple-tv", "android-tv", "not-sure"])
export const featureSchema = z.enum([
  "home",
  "search",
  "playback",
  "audio",
  "subtitles",
  "my-list",
  "interactive",
  "other",
])
export const playerSchema = z.enum([
  "native-a",
  "native-b",
  "native-android",
  "react-native",
  "unknown",
])

export const tvContextSchema = z
  .object({
    platform: platformSchema,
    appVersion: z.string().trim().max(32).optional(),
    build: z.string().trim().max(32).optional(),
    screen: z.string().trim().max(64).optional(),
    player: playerSchema.optional(),
    feature: featureSchema.optional(),
    filmTitle: z.string().trim().max(160).optional(),
    audioLanguage: z.string().trim().max(80).optional(),
    subtitleLanguage: z.string().trim().max(80).optional(),
    timestamp: z.string().trim().max(16).optional(),
  })
  .strict()

export const submissionSchema = z
  .object({
    category: categorySchema,
    flow: z.literal("photo").optional(),
    message: z.string().trim().min(10).max(2000),
    expected: z.string().trim().max(1000).optional(),
    steps: z.string().trim().max(1000).optional(),
    blocked: z.boolean().optional(),
    tvContext: tvContextSchema,
    phoneContext: z
      .object({ browser: z.string().max(80), os: z.string().max(80) })
      .strict()
      .optional(),
    consentPhoneContext: z.boolean(),
    name: z.string().trim().max(100).optional(),
    email: z.union([z.email().max(254), z.literal("")]).optional(),
    uploadIds: z.array(z.uuid()).max(4),
    idempotencyKey: z.uuid(),
    website: z.string().max(100).optional(),
    turnstileToken: z.string().max(2048),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.flow === "photo" && value.uploadIds.length !== 1)
      context.addIssue({
        code: "custom",
        path: ["uploadIds"],
        message: "A photo is required",
      })
  })

export type Category = z.infer<typeof categorySchema>
export type TvContext = z.infer<typeof tvContextSchema>
export type Submission = z.infer<typeof submissionSchema>

export const imageMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const
export const videoMimeTypes = ["video/mp4", "video/quicktime"] as const
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024
export const REPORT_MAX_BYTES = 60 * 1024 * 1024

export const uploadReservationSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    type: z.enum([...imageMimeTypes, ...videoMimeTypes]),
    size: z.number().int().positive(),
  })
  .strict()
  .refine(
    (value) =>
      value.size <=
      (value.type.startsWith("image/") ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES),
  )

export function readQrContext(input: URLSearchParams): TvContext {
  const platform = platformSchema.safeParse(input.get("platform"))
  const player = playerSchema.safeParse(input.get("player"))
  const clean = (key: string, max: number) => {
    const value = input.get(key)
    const safe =
      key === "filmTitle"
        ? value &&
          !/[<>]/.test(value) &&
          !value.split("").some((char) => char.charCodeAt(0) < 32)
        : key === "timestamp"
          ? value && /^[0-9:.-]+$/.test(value)
          : value && /^[a-zA-Z0-9 ._/-]+$/.test(value)
    return value && value.length <= max && safe ? value : undefined
  }
  return {
    platform: platform.success ? platform.data : "not-sure",
    ...(player.success ? { player: player.data } : {}),
    ...(clean("appVersion", 32) ? { appVersion: clean("appVersion", 32) } : {}),
    ...(clean("build", 32) ? { build: clean("build", 32) } : {}),
    ...(clean("screen", 64) ? { screen: clean("screen", 64) } : {}),
    ...(clean("filmTitle", 160) ? { filmTitle: clean("filmTitle", 160) } : {}),
    ...(clean("timestamp", 16) ? { timestamp: clean("timestamp", 16) } : {}),
  }
}
