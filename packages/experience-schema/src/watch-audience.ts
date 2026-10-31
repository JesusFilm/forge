import { z } from "zod"

export const WATCH_AUDIENCE_ROLE_IDS = [
  "explore",
  "grow",
  "share",
  "partner",
] as const
export const WATCH_AUDIENCE_QUESTION_COUNT = 3
export const WATCH_AUDIENCE_MIN_OPTIONS = 2
export const WATCH_AUDIENCE_MAX_OPTIONS = 6
export const WATCH_AUDIENCE_MAX_ACTIONS = 8
export const WATCH_AUDIENCE_MAX_WEIGHT = 10
export const WATCH_AUDIENCE_COPY_LIMITS = {
  label: 60,
  hint: 80,
  chip: 40,
  eyebrow: 40,
  heading: 80,
  lead: 200,
  finish: 80,
  prompt: 100,
  reason: 80,
  title: 80,
  body: 160,
} as const
const id = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{0,63}$/,
    "Use a lowercase kebab-case ID (1–64 characters)",
  )
const copy = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => s.trim().length > 0, "Copy cannot be blank")
const targetShape = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("video"), slug: z.string().max(100) }).strict(),
  z.object({ kind: z.literal("history") }).strict(),
  z.object({ kind: z.literal("languages") }).strict(),
  z
    .object({
      kind: z.literal("current-video"),
      target: z.enum(["next-episode", "share", "download", "bible-quotes"]),
    })
    .strict(),
  z.object({ kind: z.literal("resource"), url: z.string().max(500) }).strict(),
])
export type WatchAudienceActionTarget = z.infer<typeof targetShape>
export function isSafeWatchAudienceTarget(
  target: WatchAudienceActionTarget,
): boolean {
  switch (target.kind) {
    case "history":
    case "languages":
    case "current-video":
      return true
    case "video":
      return /^[a-z0-9_-]{1,100}$/.test(target.slug)
    case "resource": {
      const url = target.url
      if (!/^https:\/\//.test(url)) return false
      for (let i = 0; i < url.length; i++) {
        const code = url.charCodeAt(i)
        if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return false
      }
      try {
        const parsed = new URL(url)
        return (
          parsed.protocol === "https:" &&
          parsed.hostname !== "" &&
          parsed.username === "" &&
          parsed.password === ""
        )
      } catch {
        return false
      }
    }
  }
}
const score = z
  .object({
    actionId: id,
    weight: z.number().int().min(1).max(WATCH_AUDIENCE_MAX_WEIGHT),
  })
  .strict()
const option = z
  .object({
    id,
    label: copy(WATCH_AUDIENCE_COPY_LIMITS.label),
    hint: copy(WATCH_AUDIENCE_COPY_LIMITS.hint).optional(),
    reason: copy(WATCH_AUDIENCE_COPY_LIMITS.reason),
    scores: z.array(score).max(WATCH_AUDIENCE_MAX_ACTIONS),
  })
  .strict()
const question = z
  .object({
    id,
    prompt: copy(WATCH_AUDIENCE_COPY_LIMITS.prompt),
    options: z
      .array(option)
      .min(WATCH_AUDIENCE_MIN_OPTIONS)
      .max(WATCH_AUDIENCE_MAX_OPTIONS),
  })
  .strict()
const role = z
  .object({
    id: z.enum(WATCH_AUDIENCE_ROLE_IDS),
    label: copy(WATCH_AUDIENCE_COPY_LIMITS.label),
    hint: copy(WATCH_AUDIENCE_COPY_LIMITS.hint),
    chip: copy(WATCH_AUDIENCE_COPY_LIMITS.chip),
    eyebrow: copy(WATCH_AUDIENCE_COPY_LIMITS.eyebrow),
    heading: copy(WATCH_AUDIENCE_COPY_LIMITS.heading),
    lead: copy(WATCH_AUDIENCE_COPY_LIMITS.lead),
    finish: copy(WATCH_AUDIENCE_COPY_LIMITS.finish),
    questions: z.array(question).length(WATCH_AUDIENCE_QUESTION_COUNT),
    actions: z
      .array(
        z
          .object({
            id,
            title: copy(WATCH_AUDIENCE_COPY_LIMITS.title),
            body: copy(WATCH_AUDIENCE_COPY_LIMITS.body),
            target: targetShape,
          })
          .strict(),
      )
      .min(1)
      .max(WATCH_AUDIENCE_MAX_ACTIONS),
  })
  .strict()

/** Same structural bounds and references on read and write. Only destination
 * safety differs: historical reads may drop unsafe actions; writes refuse them. */
const storedConfiguration = z
  .object({ roles: z.array(role).length(WATCH_AUDIENCE_ROLE_IDS.length) })
  .strict()
  .superRefine((config, ctx) => {
    const unique = (ids: string[], path: (string | number)[]) => {
      const seen = new Set<string>()
      ids.forEach((value, i) => {
        if (seen.has(value))
          ctx.addIssue({
            code: "custom",
            path: [...path, i, "id"],
            message: `Duplicate ID: ${value}`,
          })
        seen.add(value)
      })
    }
    unique(
      config.roles.map((r) => r.id),
      ["roles"],
    )
    config.roles.forEach((r, ri) => {
      const path = ["roles", ri]
      unique(
        r.actions.map((a) => a.id),
        [...path, "actions"],
      )
      unique(
        r.questions.map((q) => q.id),
        [...path, "questions"],
      )
      const actions = new Set(r.actions.map((a) => a.id))
      r.questions.forEach((q, qi) => {
        unique(
          q.options.map((o) => o.id),
          [...path, "questions", qi, "options"],
        )
        q.options.forEach((o, oi) => {
          const seen = new Set<string>()
          o.scores.forEach((s, si) => {
            if (!actions.has(s.actionId) || seen.has(s.actionId))
              ctx.addIssue({
                code: "custom",
                path: [
                  ...path,
                  "questions",
                  qi,
                  "options",
                  oi,
                  "scores",
                  si,
                  "actionId",
                ],
                message: `Unknown or duplicate action reference: ${s.actionId}`,
              })
            seen.add(s.actionId)
          })
        })
      })
    })
  })
export const WatchAudienceConfigurationSchema = storedConfiguration.superRefine(
  (config, ctx) => {
    config.roles.forEach((r, ri) =>
      r.actions.forEach((a, ai) => {
        if (!isSafeWatchAudienceTarget(a.target))
          ctx.addIssue({
            code: "custom",
            path: ["roles", ri, "actions", ai, "target"],
            message:
              "Use a catalog slug or an absolute HTTPS URL without credentials, whitespace or control characters",
          })
      }),
    )
  },
)
export type WatchAudienceConfig = z.infer<
  typeof WatchAudienceConfigurationSchema
>
export type WatchAudienceRoleDefinition = WatchAudienceConfig["roles"][number]
export type WatchAudienceRoleId = WatchAudienceRoleDefinition["id"]
export const WatchAudienceBlockSchema = z
  .object({
    t: z.literal("watchAudience"),
    sectionKey: id,
    configuration: WatchAudienceConfigurationSchema,
  })
  .strict()
export type WatchAudienceBlock = z.infer<typeof WatchAudienceBlockSchema>

/** Returns null for rejected authored content, never a baked-in replacement. */
export function projectWatchAudienceConfiguration(
  value: unknown,
): WatchAudienceConfig | null {
  const parsed = storedConfiguration.safeParse(value)
  if (!parsed.success) return null
  for (const r of parsed.data.roles) {
    r.actions = r.actions.filter((a) => isSafeWatchAudienceTarget(a.target))
    const safeIds = new Set(r.actions.map((a) => a.id))
    for (const q of r.questions)
      for (const o of q.options)
        o.scores = o.scores.filter((s) => safeIds.has(s.actionId))
  }
  const safe = WatchAudienceConfigurationSchema.safeParse(parsed.data)
  return safe.success ? safe.data : null
}

/** Editor insertion defaults only; public reads never call this factory. */
export function createWatchAudienceConfiguration(): WatchAudienceConfig {
  return {
    roles: WATCH_AUDIENCE_ROLE_IDS.map((id) => ({
      id,
      label: {
        explore: "Explore",
        grow: "Grow",
        share: "Share",
        partner: "Partner",
      }[id],
      hint: "Choose the next step that fits you",
      chip: `I want to ${id}`,
      eyebrow: "Your next step",
      heading: `Find a way to ${id}`,
      lead: "Answer three questions to find a helpful next step.",
      finish: "See my next steps",
      actions: [
        {
          id: "browse-languages",
          title: "Explore languages",
          body: "Find films in a language you understand.",
          target: { kind: "languages" },
        },
        {
          id: "view-history",
          title: "Continue watching",
          body: "Return to the films you have watched.",
          target: { kind: "history" },
        },
      ],
      questions: [
        "What would help you today?",
        "How would you like to begin?",
        "What would you like to do next?",
      ].map((prompt, i) => ({
        id: `${id}-question-${i + 1}`,
        prompt,
        options: [
          {
            id: "discover",
            label: "Discover something new",
            reason: "you want to discover something new",
            scores: [{ actionId: "browse-languages", weight: 2 }],
          },
          {
            id: "continue",
            label: "Continue my journey",
            reason: "you want to continue your journey",
            scores: [{ actionId: "view-history", weight: 2 }],
          },
        ],
      })),
    })),
  }
}
