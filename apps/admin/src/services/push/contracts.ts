import { z } from "zod"

import { PUSH_ENGLISH_LANGUAGE_SLUG } from "./language-resolution"
import { PushInputError } from "./errors"

/** KTD5 — copy is capped per language before a campaign can be saved. */
export const PUSH_COPY_TITLE_MAX_CHARS = 50
export const PUSH_COPY_BODY_MAX_CHARS = 120
/** Migration 0100 bounds both campaign arrays at 300 entries. */
export const PUSH_MAX_AUDIENCE_COUNTRIES = 300
export const PUSH_MAX_LANGUAGE_FILTER = 300
export const PUSH_MAX_COPY_ROWS = 300
export const PUSH_TEST_DEVICE_LABEL_MAX_CHARS = 120
export const PUSH_DEFAULT_LOCAL_HOUR = 9

/**
 * A Language slug. The shape stays loose on purpose: slugs arrive from Core
 * through a picker, so a strict pattern here would refuse a real language
 * long before anybody could see why.
 */
export const PushLanguageSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(191)
  .regex(/^\S+$/, "A language slug carries no spaces")

export const PushCountryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "A country is a two-letter ISO code")
  .transform((code) => code.toUpperCase())

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

export const PushCampaignCopyInputSchema = z
  .object({
    languageSlug: PushLanguageSlugSchema,
    // JS counts UTF-16 units and Postgres counts characters, so a string this
    // check admits always fits the column.
    title: z.string().trim().min(1).max(PUSH_COPY_TITLE_MAX_CHARS),
    body: z.string().trim().min(1).max(PUSH_COPY_BODY_MAX_CHARS),
  })
  .strict()
export type PushCampaignCopyInput = z.infer<typeof PushCampaignCopyInputSchema>

export const PushCampaignCopySetSchema = z
  .array(PushCampaignCopyInputSchema)
  .min(1)
  .max(PUSH_MAX_COPY_ROWS)
  .refine(
    (rows) =>
      unique(rows.map((row) => row.languageSlug)).length === rows.length,
    { message: "Each language takes one copy row" },
  )
  .refine(
    (rows) =>
      rows.some((row) => row.languageSlug === PUSH_ENGLISH_LANGUAGE_SLUG),
    { message: "English copy is required" },
  )

export const PushDestinationKindSchema = z.enum([
  "VIDEO",
  "SERIES",
  "EXPERIENCE",
])
export const PushDestinationInputSchema = z
  .object({
    kind: PushDestinationKindSchema,
    // apps/mobile/src/lib/push/announcementPayload.ts refuses any other slug
    // and routes the tap to home, so admin must not accept one. The character
    // set and the dot-segment refusal below are that parser's, kept identical.
    slug: z
      .string()
      .trim()
      .min(1)
      .max(191)
      .regex(
        /^[A-Za-z0-9._~-]+$/,
        "A destination slug carries only unreserved characters",
      )
      .refine((slug) => slug !== "." && slug !== "..", {
        message: "A destination slug is not a dot segment",
      }),
  })
  .strict()
export type PushDestinationInput = z.infer<typeof PushDestinationInputSchema>

export const PushAudienceInputSchema = z
  .object({
    scope: z.enum(["EVERYWHERE", "COUNTRIES"]),
    countries: z
      .array(PushCountryCodeSchema)
      .max(PUSH_MAX_AUDIENCE_COUNTRIES)
      .default([])
      .transform(unique),
    languageFilter: z
      .array(PushLanguageSlugSchema)
      .max(PUSH_MAX_LANGUAGE_FILTER)
      .default([])
      .transform(unique),
  })
  .strict()
  .refine(
    (audience) =>
      audience.scope === "COUNTRIES"
        ? audience.countries.length > 0
        : audience.countries.length === 0,
    { message: "Name at least one country, or choose everywhere" },
  )
/** What a caller passes: the array defaults are applied by the parse. */
export type PushAudienceInput = z.input<typeof PushAudienceInputSchema>
export type PushAudienceResolved = z.output<typeof PushAudienceInputSchema>

export const PushSendDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "A send date reads year-month-day")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    )
  }, "That day does not exist")

export const PushLocalHourSchema = z.number().int().min(0).max(23)

export const PushScheduleInputSchema = z
  .object({
    sendDate: PushSendDateSchema,
    localHour: PushLocalHourSchema.default(PUSH_DEFAULT_LOCAL_HOUR),
  })
  .strict()
export type PushScheduleInput = z.input<typeof PushScheduleInputSchema>

export const PushCampaignUpdateInputSchema = z
  .object({
    copies: PushCampaignCopySetSchema.optional(),
    destination: PushDestinationInputSchema.optional(),
    audience: PushAudienceInputSchema.optional(),
  })
  .strict()
export type PushCampaignUpdateInput = z.input<
  typeof PushCampaignUpdateInputSchema
>

// Expo's own shape: a bracketed token, or the legacy bare device UUID that
// `Expo.isExpoPushToken` still accepts. The bracket branch requires at least
// one character inside, which Expo's own check does not.
const EXPO_BRACKETED_TOKEN = /^Expo(?:nent)?PushToken\[[^\s[\]]+\]$/
const EXPO_LEGACY_DEVICE_TOKEN =
  /^[a-z\d]{8}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{12}$/i

/** True for anything shaped like a push token, so a caller can refuse it. */
export function isExpoPushTokenShape(value: unknown): boolean {
  if (typeof value !== "string") return false
  const token = value.trim()
  return (
    EXPO_BRACKETED_TOKEN.test(token) || EXPO_LEGACY_DEVICE_TOKEN.test(token)
  )
}

export const ExpoPushTokenSchema = z
  .string()
  .trim()
  .max(191)
  .refine(isExpoPushTokenShape, "That is not an Expo push token")

/**
 * The notification test ID the app shows on its Profile screen.
 *
 * Lowercase letters and digits only. A push token carries brackets or
 * dashes, so no token can pass as a test ID by accident.
 */
export const PushTestDeviceIdSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9]{8,64}$/,
    "A notification test ID is 8 to 64 lowercase letters and digits",
  )

export const PushTestDeviceAddInputSchema = z
  .object({
    testDeviceId: PushTestDeviceIdSchema,
    label: z.string().trim().min(1).max(PUSH_TEST_DEVICE_LABEL_MAX_CHARS),
  })
  .strict()
export type PushTestDeviceAddInput = z.input<
  typeof PushTestDeviceAddInputSchema
>

/**
 * A BCP-47 tag by shape only. The phone reports whatever its own settings
 * carry, and `language-resolution.ts` decides which Language it matches, so a
 * tag admin has never seen must still store. 35 characters is the column.
 */
export const PushBcp47TagSchema = z
  .string()
  .trim()
  .max(35)
  .regex(
    /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/,
    "A phone locale is a BCP-47 language tag",
  )

/** The IANA name, checked for shape here and for existence by `zone-instant`. */
export const PushTimeZoneSchema = z.string().trim().min(1).max(64)

export const PushPlatformInputSchema = z.enum(["IOS", "ANDROID"])

/** R1 and R29 — one grant covers announcements, and a revocation is reported. */
export const PushPermissionStateSchema = z.enum(["granted", "denied"])

export const PushAppBuildSchema = z.string().trim().min(1).max(64)

/**
 * The identifier the app mints once per install and keeps in its own store. A
 * token rotation on the same install carries the same id, so supersession
 * retires that install's older token and leaves the viewer's other devices be.
 */
export const PushInstallIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/, "That is not an install id")

export const PushRegistrationInputSchema = z
  .object({
    expoPushToken: ExpoPushTokenSchema,
    platform: PushPlatformInputSchema,
    appBuild: PushAppBuildSchema,
    appLanguageSlug: PushLanguageSlugSchema,
    phoneLocale: PushBcp47TagSchema,
    timeZone: PushTimeZoneSchema,
    permission: PushPermissionStateSchema,
    // The mobile payload always carries it, so supersession always has a key.
    installId: PushInstallIdSchema,
  })
  .strict()
export type PushRegistrationInput = z.infer<typeof PushRegistrationInputSchema>

/** KTD14 — 32 random bytes, base64url encoded, which is always 43 characters. */
export const PushDeliveryNonceSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{43}$/, "That is not a delivery nonce")

export const PushOpenReportInputSchema = z
  .object({ nonce: PushDeliveryNonceSchema })
  .strict()
export type PushOpenReportInput = z.infer<typeof PushOpenReportInputSchema>

/**
 * The recommendation viewer handle, when the install has one. Both halves
 * travel together: the viewer token names the identity and the session token
 * bounds the playback session, and `viewer-identity.service` verifies them.
 */
export const PushViewerHandleSchema = z
  .object({
    viewerToken: z.string().trim().min(1).max(64),
    sessionToken: z.string().trim().min(1).max(64),
  })
  .strict()
export type PushViewerHandle = z.infer<typeof PushViewerHandleSchema>

/**
 * Parses one input against its contract and turns a zod failure into the
 * typed input error. The message carries the issue messages only, never the
 * value that failed, so a token or a handle cannot echo back to a log.
 */
export function parsePushInput<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value)
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new PushInputError(
        error.issues.map((issue) => issue.message).join("; "),
      )
    }
    throw error
  }
}
