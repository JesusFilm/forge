import { z } from "zod"

/**
 * Typed boundary between devotional business logic and Workspace-authored data.
 * U4 supplies an implementation backed by the reconciled Workspace catalog.
 * This module deliberately has no filesystem, repository-root, or environment
 * fallback: a missing required document is a pre-side-effect failure.
 */

export const DEVOTIONAL_AUTHORED_PATHS = {
  prompts: "/inputs/prompts/generation.json",
  safety: "/inputs/safety/rubric.json",
  holidays: "/inputs/calendar/holidays.json",
  voices: "/inputs/voices/profiles.json",
  music: "/inputs/music/profiles.json",
  render: "/inputs/render/styles.json",
  narration: "/inputs/render/narration.json",
  brand: "/inputs/brand/profile.json",
  videoCatalog: "/inputs/video/jesus-film-catalog.json",
  videoPassages: "/inputs/video/jesus-film-passages.json",
  webBible: "/inputs/scripture/web-bible.json",
} as const

export type DevotionalAuthoredPath =
  (typeof DEVOTIONAL_AUTHORED_PATHS)[keyof typeof DEVOTIONAL_AUTHORED_PATHS]

export type DevotionalAuthoredDocument = {
  path: string
  text: string
  digest: string
  etag?: string
  modifiedAt?: Date
}

export type DevotionalAuthoredDataReader = {
  readRequired(
    path: DevotionalAuthoredPath,
  ): Promise<DevotionalAuthoredDocument>
}

export class DevotionalAuthoredDataError extends Error {
  constructor(
    readonly code: "missing" | "invalid",
    readonly path: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`${path}: ${message}`)
    this.name = "DevotionalAuthoredDataError"
  }
}

const PromptSchema = z.string().trim().min(1).max(32_000)
const PromptBundleSchema = z
  .object({
    prompts: z
      .object({
        scripture: PromptSchema,
        modernizer: PromptSchema,
        highlighter: PromptSchema,
        ranker: PromptSchema,
        copy: PromptSchema,
        writer: PromptSchema,
        hookNews: PromptSchema,
        hookQuestion: PromptSchema,
        safety: PromptSchema,
        videoMatcher: PromptSchema,
        // `.optional()` because `prompts` is `.strict()` and the DEPLOYED
        // document predates these two keys: making them required would make the
        // live Workspace unreadable the moment this ships. The consumers fall
        // back to their in-code prompt when a key is absent, which is a
        // transitional state, not the design — retire the fallback (and drop
        // `.optional()`) once the deployed document carries both.
        conclusion: PromptSchema.optional(),
        pointPicker: PromptSchema.optional(),
      })
      .strict(),
    generation: z
      .object({
        hookStyles: z.array(z.string().trim().min(1).max(500)).min(1).max(32),
        blockOrders: z
          .array(
            z
              .array(
                z.enum([
                  "hook",
                  "scripture",
                  "video",
                  "reflection",
                  "questions",
                ]),
              )
              .min(4)
              .max(5),
          )
          .min(1)
          .max(32),
        partnerDomains: z
          .array(
            z
              .string()
              .trim()
              .min(1)
              .regex(/^[a-z0-9.-]+$/),
          )
          .max(64),
      })
      .strict(),
  })
  .strict()

const HolidaySchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(500),
  })
  .strict()

const HolidaysSchema = z
  .object({
    holidays: z.record(z.string().regex(/^\d{2}-\d{2}$/), HolidaySchema),
  })
  .strict()

const VoiceSettingsSchema = z
  .object({
    stability: z.number().min(0).max(1),
    similarity_boost: z.number().min(0).max(1),
    style: z.number().min(0).max(1),
    use_speaker_boost: z.boolean(),
  })
  .strict()

const VoicesSchema = z
  .object({
    profiles: z.record(z.string().trim().min(1), z.string().trim().min(1)),
    settings: VoiceSettingsSchema,
    rotation: z.array(z.string().trim().min(1)).min(1).max(64),
    filterRotation: z.array(z.string().trim().min(1)).min(1).max(64),
  })
  .strict()

const NarrationSchema = z
  .object({
    months: z.array(z.string().trim().min(1)).length(12),
    weekdays: z.array(z.string().trim().min(1)).length(7),
    templates: z
      .object({
        coverWithDate: z.string().trim().min(1),
        coverWithoutDate: z.string().trim().min(1),
        scripture: z.string().trim().min(1),
        reflectionOpen: z.string().trim().min(1),
        questionsLead: z.string().trim().min(1),
      })
      .strict(),
    coverVoiceSettings: VoiceSettingsSchema,
  })
  .strict()

const BrandSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    rightsAssertion: z.string().trim().min(1).max(1_000),
  })
  .strict()

const RenderDocumentSchema = z
  .object({
    filters: z
      .record(z.string(), z.unknown())
      .refine(
        (value) => Object.keys(value).length > 0,
        "at least one render filter is required",
      ),
    layouts: z
      .record(z.string(), z.unknown())
      .refine(
        (value) => Object.keys(value).length > 0,
        "at least one render layout is required",
      ),
    nativeLayouts: z
      .record(z.string(), z.string())
      .refine(
        (value) => Object.keys(value).length > 0,
        "native render layout mappings are required",
      ),
  })
  .strict()

export const MUSIC_MOOD_IDS = ["peace", "hope", "lament", "awe"] as const
export type MusicMoodId = (typeof MUSIC_MOOD_IDS)[number]

const MusicSchema = z
  .object({
    moods: z.record(
      z.enum(MUSIC_MOOD_IDS),
      z.string().trim().min(1).max(4_000),
    ),
    defaultLengthMs: z.number().int().min(3_000).max(600_000),
  })
  .strict()

/** The immutable minimum cannot be weakened by editable Workspace policy. */
export const IMMUTABLE_MIN_SAFETY_CONFIDENCE = 0.6

const SafetyPolicySchema = z
  .object({
    minimumConfidence: z.number().min(0).max(1),
    prompt: PromptSchema,
  })
  .strict()

export type PromptBundle = z.infer<typeof PromptBundleSchema>
export type HolidayTable = z.infer<typeof HolidaysSchema>["holidays"]
export type VoiceProfiles = z.infer<typeof VoicesSchema>
export type NarrationPolicy = z.infer<typeof NarrationSchema>
export type BrandProfile = z.infer<typeof BrandSchema>
export type RenderDocument = z.infer<typeof RenderDocumentSchema>
export type MusicProfiles = z.infer<typeof MusicSchema>
export type SafetyPolicy = z.infer<typeof SafetyPolicySchema> & {
  effectiveMinimumConfidence: number
}

function parseJson<T>(
  document: DevotionalAuthoredDocument,
  schema: z.ZodType<T>,
): T {
  let value: unknown
  try {
    value = JSON.parse(document.text)
  } catch (error) {
    throw new DevotionalAuthoredDataError(
      "invalid",
      document.path,
      "expected valid JSON",
      error,
    )
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new DevotionalAuthoredDataError(
      "invalid",
      document.path,
      parsed.error.issues.map((issue) => issue.message).join("; "),
      parsed.error,
    )
  }
  return parsed.data
}

async function required<T>(
  reader: DevotionalAuthoredDataReader,
  path: DevotionalAuthoredPath,
  schema: z.ZodType<T>,
): Promise<T> {
  let document: DevotionalAuthoredDocument
  try {
    document = await reader.readRequired(path)
  } catch (error) {
    if (error instanceof DevotionalAuthoredDataError) throw error
    throw new DevotionalAuthoredDataError(
      "missing",
      path,
      "required Workspace input is unavailable",
      error,
    )
  }
  if (document.path !== path) {
    throw new DevotionalAuthoredDataError(
      "invalid",
      path,
      `reader returned unexpected path ${document.path}`,
    )
  }
  return parseJson(document, schema)
}

export function requireAuthoredPrompt(
  prompt: string | undefined,
  path = DEVOTIONAL_AUTHORED_PATHS.prompts,
): string {
  const parsed = PromptSchema.safeParse(prompt)
  if (!parsed.success) {
    throw new DevotionalAuthoredDataError(
      "missing",
      path,
      "required authored prompt is unavailable",
    )
  }
  return parsed.data
}

export async function loadPromptBundle(
  reader: DevotionalAuthoredDataReader,
): Promise<PromptBundle> {
  return required(reader, DEVOTIONAL_AUTHORED_PATHS.prompts, PromptBundleSchema)
}

export async function loadHolidayTable(
  reader: DevotionalAuthoredDataReader,
): Promise<HolidayTable> {
  return (
    await required(reader, DEVOTIONAL_AUTHORED_PATHS.holidays, HolidaysSchema)
  ).holidays
}

export async function loadVoiceProfiles(
  reader: DevotionalAuthoredDataReader,
): Promise<VoiceProfiles> {
  return required(reader, DEVOTIONAL_AUTHORED_PATHS.voices, VoicesSchema)
}

export async function loadMusicProfiles(
  reader: DevotionalAuthoredDataReader,
): Promise<MusicProfiles> {
  return required(reader, DEVOTIONAL_AUTHORED_PATHS.music, MusicSchema)
}

export async function loadNarrationPolicy(
  reader: DevotionalAuthoredDataReader,
): Promise<NarrationPolicy> {
  return required(reader, DEVOTIONAL_AUTHORED_PATHS.narration, NarrationSchema)
}

export async function loadBrandProfile(
  reader: DevotionalAuthoredDataReader,
): Promise<BrandProfile> {
  return required(reader, DEVOTIONAL_AUTHORED_PATHS.brand, BrandSchema)
}

/** Composition/Worker performs the complete trusted-boundary validation. */
export async function loadRenderDocument(
  reader: DevotionalAuthoredDataReader,
): Promise<RenderDocument> {
  return required(
    reader,
    DEVOTIONAL_AUTHORED_PATHS.render,
    RenderDocumentSchema,
  )
}

export async function loadSafetyPolicy(
  reader: DevotionalAuthoredDataReader,
): Promise<SafetyPolicy> {
  const policy = await required(
    reader,
    DEVOTIONAL_AUTHORED_PATHS.safety,
    SafetyPolicySchema,
  )
  return {
    ...policy,
    effectiveMinimumConfidence: Math.max(
      IMMUTABLE_MIN_SAFETY_CONFIDENCE,
      policy.minimumConfidence,
    ),
  }
}

export const _internal = {
  PromptBundleSchema,
  HolidaysSchema,
  VoicesSchema,
  NarrationSchema,
  BrandSchema,
  RenderDocumentSchema,
  MusicSchema,
  SafetyPolicySchema,
}
