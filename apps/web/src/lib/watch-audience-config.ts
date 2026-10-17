// Watch audience definitions: the four roles, their three questions, and the
// next-step actions the answers rank. Pure, serializable data plus pure
// functions — no React, icons, route builders or environment — so a published
// Experience block can replace `WATCH_AUDIENCE_CODE_CONFIG` later through the
// same validator. Renderers own icons and build every href from the semantic
// targets here; a target the current page cannot serve is omitted, never
// linked to a placeholder.

export const WATCH_AUDIENCE_ROLE_IDS = [
  "explore",
  "grow",
  "share",
  "partner",
] as const

export type WatchAudienceRoleId = (typeof WATCH_AUDIENCE_ROLE_IDS)[number]

export const DEFAULT_WATCH_AUDIENCE_ROLE_ID: WatchAudienceRoleId = "explore"

export function isWatchAudienceRoleId(
  value: unknown,
): value is WatchAudienceRoleId {
  return (
    typeof value === "string" &&
    (WATCH_AUDIENCE_ROLE_IDS as readonly string[]).includes(value)
  )
}

/** Controls of the video the visitor is already on. Absent on the home page. */
export const WATCH_AUDIENCE_CURRENT_VIDEO_TARGETS = [
  "next-episode",
  "share",
  "download",
  "bible-quotes",
] as const

export type WatchAudienceCurrentVideoTarget =
  (typeof WATCH_AUDIENCE_CURRENT_VIDEO_TARGETS)[number]

/**
 * Where an action goes. Semantic only: the renderer builds the canonical Watch
 * route (with the visitor's audio language) from `slug`, `history` and
 * `languages`, wires `current-video` to the existing control, and opens
 * `resource` as an external link.
 */
export type WatchAudienceActionTarget =
  | { kind: "video"; slug: string }
  | { kind: "history" }
  | { kind: "languages" }
  | { kind: "current-video"; target: WatchAudienceCurrentVideoTarget }
  | { kind: "resource"; url: string }

export type WatchAudienceActionKind = WatchAudienceActionTarget["kind"]

export type WatchAudienceAction = {
  id: string
  title: string
  body: string
  target: WatchAudienceActionTarget
}

export type WatchAudienceScore = { actionId: string; weight: number }

export type WatchAudienceOption = {
  id: string
  label: string
  hint?: string
  /** A clause that completes "Because …" on the result. */
  reason: string
  scores: WatchAudienceScore[]
}

export type WatchAudienceQuestion = {
  id: string
  prompt: string
  options: WatchAudienceOption[]
}

export type WatchAudienceRoleDefinition = {
  id: WatchAudienceRoleId
  label: string
  hint: string
  /** First-person copy for the header chip. */
  chip: string
  eyebrow: string
  heading: string
  lead: string
  finish: string
  /** Exactly `WATCH_AUDIENCE_QUESTION_COUNT`, in asking order. */
  questions: WatchAudienceQuestion[]
  /** Authored order is the tie-break when scores are equal. */
  actions: WatchAudienceAction[]
}

export type WatchAudienceConfig = { roles: WatchAudienceRoleDefinition[] }

export const WATCH_AUDIENCE_QUESTION_COUNT = 3
export const WATCH_AUDIENCE_MIN_OPTIONS = 2
export const WATCH_AUDIENCE_MAX_OPTIONS = 6
export const WATCH_AUDIENCE_MAX_ACTIONS = 8
export const WATCH_AUDIENCE_MAX_WEIGHT = 10

/** Copy limits, in UTF-16 code units, bounding the persisted/rendered payload. */
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

const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
const SLUG_PATTERN = /^[a-z0-9_-]{1,100}$/
const RESOURCE_URL_MAX_LENGTH = 500
// Whitespace and control characters; the URL parser silently strips some of
// them, so the raw string is checked.
function hasUnsafeUrlCharacter(url: string): boolean {
  for (let i = 0; i < url.length; i += 1) {
    const code = url.charCodeAt(i)
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}

export type WatchAudienceIssueCode =
  | "role-set"
  | "question-count"
  | "option-count"
  | "action-count"
  | "invalid-id"
  | "duplicate-id"
  | "dangling-action"
  | "invalid-weight"
  | "copy-length"
  | "unsafe-destination"

export type WatchAudienceIssue = {
  code: WatchAudienceIssueCode
  /** Dotted path from the config root, e.g. `roles.grow.questions.0.prompt`. */
  path: string
  message: string
}

export function isSafeWatchAudienceTarget(
  target: WatchAudienceActionTarget,
): boolean {
  switch (target.kind) {
    case "history":
    case "languages":
      return true
    case "video":
      return typeof target.slug === "string" && SLUG_PATTERN.test(target.slug)
    case "current-video":
      return (
        WATCH_AUDIENCE_CURRENT_VIDEO_TARGETS as readonly string[]
      ).includes(target.target)
    case "resource":
      return isSafeResourceUrl(target.url)
    default:
      return false
  }
}

function isSafeResourceUrl(url: unknown): boolean {
  if (
    typeof url !== "string" ||
    url.length === 0 ||
    url.length > RESOURCE_URL_MAX_LENGTH ||
    hasUnsafeUrlCharacter(url)
  ) {
    return false
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

/**
 * The invariants a role set must hold, whether it comes from code or from a
 * published block: the four roles once each, exactly three questions per role,
 * bounded lists and copy, stable ids, positive integer weights that point at
 * real actions, and only safe destinations. Returns every issue found.
 */
export function validateWatchAudienceConfig(
  config: WatchAudienceConfig,
): WatchAudienceIssue[] {
  const issues: WatchAudienceIssue[] = []
  const add = (code: WatchAudienceIssueCode, path: string, message: string) =>
    issues.push({ code, path, message })

  const checkId = (id: string, seen: Set<string>, path: string) => {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      add("invalid-id", path, "ids are lowercase kebab-case, 1-64 characters")
    } else if (seen.has(id)) {
      add("duplicate-id", path, `duplicate id "${id}"`)
    }
    seen.add(id)
  }
  const checkCopy = (
    value: string | undefined,
    max: number,
    path: string,
    optional = false,
  ) => {
    if (value === undefined && optional) return
    if (
      typeof value !== "string" ||
      value.trim() === "" ||
      value.length > max
    ) {
      add("copy-length", path, `copy must be 1-${max} characters`)
    }
  }

  const roleIds = config.roles.map((role) => role.id)
  const expected = [...WATCH_AUDIENCE_ROLE_IDS].sort().join()
  if ([...roleIds].sort().join() !== expected) {
    add(
      "role-set",
      "roles",
      `roles must be exactly ${WATCH_AUDIENCE_ROLE_IDS.join(", ")}, once each`,
    )
  }

  for (const role of config.roles) {
    const rolePath = `roles.${role.id}`
    const limits = WATCH_AUDIENCE_COPY_LIMITS
    checkCopy(role.label, limits.label, `${rolePath}.label`)
    checkCopy(role.hint, limits.hint, `${rolePath}.hint`)
    checkCopy(role.chip, limits.chip, `${rolePath}.chip`)
    checkCopy(role.eyebrow, limits.eyebrow, `${rolePath}.eyebrow`)
    checkCopy(role.heading, limits.heading, `${rolePath}.heading`)
    checkCopy(role.lead, limits.lead, `${rolePath}.lead`)
    checkCopy(role.finish, limits.finish, `${rolePath}.finish`)

    if (
      role.actions.length < 1 ||
      role.actions.length > WATCH_AUDIENCE_MAX_ACTIONS
    ) {
      add(
        "action-count",
        `${rolePath}.actions`,
        `a role needs 1-${WATCH_AUDIENCE_MAX_ACTIONS} actions`,
      )
    }
    const actionIds = new Set<string>()
    role.actions.forEach((action, a) => {
      const path = `${rolePath}.actions.${a}`
      checkId(action.id, actionIds, `${path}.id`)
      checkCopy(action.title, limits.title, `${path}.title`)
      checkCopy(action.body, limits.body, `${path}.body`)
      if (!isSafeWatchAudienceTarget(action.target)) {
        add(
          "unsafe-destination",
          `${path}.target`,
          "destination is not allowed",
        )
      }
    })

    if (role.questions.length !== WATCH_AUDIENCE_QUESTION_COUNT) {
      add(
        "question-count",
        `${rolePath}.questions`,
        `a role has exactly ${WATCH_AUDIENCE_QUESTION_COUNT} questions`,
      )
    }
    const questionIds = new Set<string>()
    role.questions.forEach((question, q) => {
      const questionPath = `${rolePath}.questions.${q}`
      checkId(question.id, questionIds, `${questionPath}.id`)
      checkCopy(question.prompt, limits.prompt, `${questionPath}.prompt`)
      if (
        question.options.length < WATCH_AUDIENCE_MIN_OPTIONS ||
        question.options.length > WATCH_AUDIENCE_MAX_OPTIONS
      ) {
        add(
          "option-count",
          `${questionPath}.options`,
          `a question has ${WATCH_AUDIENCE_MIN_OPTIONS}-${WATCH_AUDIENCE_MAX_OPTIONS} options`,
        )
      }
      const optionIds = new Set<string>()
      question.options.forEach((option, o) => {
        const optionPath = `${questionPath}.options.${o}`
        checkId(option.id, optionIds, `${optionPath}.id`)
        checkCopy(option.label, limits.label, `${optionPath}.label`)
        checkCopy(option.hint, limits.hint, `${optionPath}.hint`, true)
        checkCopy(option.reason, limits.reason, `${optionPath}.reason`)
        const scored = new Set<string>()
        option.scores.forEach((score, s) => {
          const scorePath = `${optionPath}.scores.${s}`
          if (!actionIds.has(score.actionId)) {
            add(
              "dangling-action",
              scorePath,
              `unknown action "${score.actionId}"`,
            )
          } else if (scored.has(score.actionId)) {
            add(
              "duplicate-id",
              scorePath,
              `action "${score.actionId}" scored twice`,
            )
          }
          scored.add(score.actionId)
          if (
            !Number.isInteger(score.weight) ||
            score.weight < 1 ||
            score.weight > WATCH_AUDIENCE_MAX_WEIGHT
          ) {
            add(
              "invalid-weight",
              scorePath,
              `weight is an integer 1-${WATCH_AUDIENCE_MAX_WEIGHT}`,
            )
          }
        })
      })
    })
  }

  return issues
}

export function getWatchAudienceRole(
  config: WatchAudienceConfig,
  id: WatchAudienceRoleId,
): WatchAudienceRoleDefinition | null {
  return config.roles.find((role) => role.id === id) ?? null
}

export type WatchAudienceRanking = {
  action: WatchAudienceAction
  score: number
}

/**
 * Ranks a role's actions for the answers so far. `answers[i]` is the option id
 * chosen for `questions[i]`. Unknown option ids and scores for unknown actions
 * add nothing, so the result always holds exactly the role's actions; equal
 * scores keep authored order.
 */
export function rankWatchAudienceActions(
  role: WatchAudienceRoleDefinition,
  answers: readonly string[],
): WatchAudienceRanking[] {
  const scores = new Map<string, number>()
  role.questions.forEach((question, q) => {
    const option = question.options.find((o) => o.id === answers[q])
    for (const { actionId, weight } of option?.scores ?? []) {
      scores.set(actionId, (scores.get(actionId) ?? 0) + weight)
    }
  })
  return role.actions
    .map((action, index) => ({
      action,
      index,
      score: scores.get(action.id) ?? 0,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ action, score }) => ({ action, score }))
}

/** The reason clauses of the answered options, in question order. */
export function watchAudienceReasons(
  role: WatchAudienceRoleDefinition,
  answers: readonly string[],
): string[] {
  return role.questions.flatMap((question, q) => {
    const option = question.options.find((o) => o.id === answers[q])
    return option ? [option.reason] : []
  })
}

const HUB = "https://www.jesusfilm.org/resources/strategies"
const BEGINNING_WITH_JESUS = `${HUB}/training/beginning-with-jesus-replace/`
const FILM_GATHERING = `${HUB}/outreach/how-to-host-a-short-film-festival/`
const AMAZING_QUESTION = `${HUB}/outreach/using-the-amazing-question-to-share-your-faith/`

export const WATCH_AUDIENCE_CODE_CONFIG: WatchAudienceConfig = {
  roles: [
    {
      id: "explore",
      label: "Explore faith",
      hint: "new here",
      chip: "I’m exploring",
      eyebrow: "Find your next step",
      heading: "Three quick questions.",
      lead: "No right answers. We’ll point you to the one thing worth doing next.",
      finish: "Here’s where we’d start.",
      actions: [
        {
          id: "explore-short-films",
          title: "Start with a short film",
          body: "Short films that open a conversation, a few minutes each.",
          target: { kind: "video", slug: "conversation-starters" },
        },
        {
          id: "explore-full-film",
          title: "Watch the story of Jesus",
          body: "The full JESUS film, in your language.",
          target: { kind: "video", slug: "jesus" },
        },
        {
          id: "explore-next-episode",
          title: "See what happens next",
          body: "Keep going with the next film in this series.",
          target: { kind: "current-video", target: "next-episode" },
        },
        {
          id: "explore-bible-passage",
          title: "Read the passage behind it",
          body: "The Bible passages this film is drawn from.",
          target: { kind: "current-video", target: "bible-quotes" },
        },
      ],
      questions: [
        {
          id: "from",
          prompt: "Where are you starting from?",
          options: [
            {
              id: "curious",
              label: "Just curious",
              hint: "Saw this and kept watching",
              reason: "you’re curious",
              scores: [
                { actionId: "explore-short-films", weight: 2 },
                { actionId: "explore-next-episode", weight: 1 },
              ],
            },
            {
              id: "questions",
              label: "I have real questions",
              hint: "About Jesus, God, the Bible",
              reason: "you have real questions",
              scores: [
                { actionId: "explore-bible-passage", weight: 2 },
                { actionId: "explore-short-films", weight: 1 },
                { actionId: "explore-full-film", weight: 1 },
              ],
            },
            {
              id: "hope",
              label: "I need some hope",
              hint: "Something is heavy right now",
              reason: "you need some hope",
              scores: [
                { actionId: "explore-short-films", weight: 2 },
                { actionId: "explore-bible-passage", weight: 1 },
              ],
            },
            {
              id: "skeptic",
              label: "Honestly, skeptical",
              hint: "Convince me it’s worth my time",
              reason: "you’re skeptical",
              scores: [
                { actionId: "explore-short-films", weight: 2 },
                { actionId: "explore-full-film", weight: 1 },
              ],
            },
          ],
        },
        {
          id: "how",
          prompt: "How do you like to work things out?",
          options: [
            {
              id: "alone",
              label: "On my own, quietly",
              hint: "Read, think, no one watching",
              reason: "you prefer to work it out alone",
              scores: [{ actionId: "explore-bible-passage", weight: 3 }],
            },
            {
              id: "talk",
              label: "Talking it through",
              hint: "With a real person",
              reason: "you’d rather talk it through",
              scores: [{ actionId: "explore-short-films", weight: 3 }],
            },
            {
              id: "watch",
              label: "Show me the story",
              hint: "I’ll decide after I’ve seen it",
              reason: "you want to see the story first",
              scores: [
                { actionId: "explore-full-film", weight: 3 },
                { actionId: "explore-next-episode", weight: 1 },
              ],
            },
          ],
        },
        {
          id: "time",
          prompt: "How much time do you have right now?",
          options: [
            {
              id: "short",
              label: "Three minutes",
              reason: "you have a few minutes",
              scores: [
                { actionId: "explore-short-films", weight: 3 },
                { actionId: "explore-next-episode", weight: 1 },
              ],
            },
            {
              id: "medium",
              label: "Half an hour",
              reason: "you have half an hour",
              scores: [{ actionId: "explore-next-episode", weight: 3 }],
            },
            {
              id: "long",
              label: "An evening",
              reason: "you have an evening",
              scores: [{ actionId: "explore-full-film", weight: 3 }],
            },
          ],
        },
      ],
    },
    {
      id: "grow",
      label: "Grow in faith",
      hint: "following Jesus",
      chip: "I follow Jesus",
      eyebrow: "Find your next step",
      heading: "Three quick questions.",
      lead: "Tell us where you are this week and we’ll pick the next step.",
      finish: "Your next step this week.",
      actions: [
        {
          id: "grow-next-episode",
          title: "Continue with the next film",
          body: "Pick up the series where this film leaves off.",
          target: { kind: "current-video", target: "next-episode" },
        },
        {
          id: "grow-bible-passage",
          title: "Read the passage",
          body: "The Bible passages this film is drawn from.",
          target: { kind: "current-video", target: "bible-quotes" },
        },
        {
          id: "grow-share",
          title: "Send it to a friend",
          body: "Share the film as a link, no account needed.",
          target: { kind: "current-video", target: "share" },
        },
        {
          id: "grow-beginning-with-jesus",
          title: "Explore Beginning With Jesus",
          body: "A step-by-step training resource from Jesus Film Project.",
          target: { kind: "resource", url: BEGINNING_WITH_JESUS },
        },
        {
          id: "grow-history",
          title: "Pick up where you left off",
          body: "See the films you’ve been watching on this device.",
          target: { kind: "history" },
        },
      ],
      questions: [
        {
          id: "want",
          prompt: "What are you looking for right now?",
          options: [
            {
              id: "rhythm",
              label: "A daily rhythm",
              hint: "Something small, every day",
              reason: "you want a daily rhythm",
              scores: [
                { actionId: "grow-next-episode", weight: 3 },
                { actionId: "grow-history", weight: 2 },
              ],
            },
            {
              id: "study",
              label: "To understand the passage",
              hint: "What the text actually says",
              reason: "you want to understand the passage",
              scores: [
                { actionId: "grow-bible-passage", weight: 3 },
                { actionId: "grow-beginning-with-jesus", weight: 1 },
              ],
            },
            {
              id: "share",
              label: "Something to pass on",
              hint: "For a friend or my family",
              reason: "you want something to pass on",
              scores: [{ actionId: "grow-share", weight: 3 }],
            },
            {
              id: "community",
              label: "People to walk with",
              hint: "I don’t want to do this alone",
              reason: "you don’t want to do this alone",
              scores: [{ actionId: "grow-beginning-with-jesus", weight: 3 }],
            },
          ],
        },
        {
          id: "learn",
          prompt: "How do you learn best?",
          options: [
            {
              id: "watching",
              label: "Watching",
              reason: "you learn by watching",
              scores: [{ actionId: "grow-next-episode", weight: 2 }],
            },
            {
              id: "reading",
              label: "Reading",
              reason: "you learn by reading",
              scores: [{ actionId: "grow-bible-passage", weight: 2 }],
            },
            {
              id: "discussing",
              label: "Discussing",
              reason: "you learn by discussing",
              scores: [
                { actionId: "grow-beginning-with-jesus", weight: 2 },
                { actionId: "grow-share", weight: 1 },
              ],
            },
          ],
        },
        {
          id: "when",
          prompt: "When will you come back to this?",
          options: [
            {
              id: "today",
              label: "Later today",
              reason: "you’ll be back today",
              scores: [
                { actionId: "grow-bible-passage", weight: 1 },
                { actionId: "grow-share", weight: 1 },
              ],
            },
            {
              id: "week",
              label: "Through the week",
              reason: "you’ll be back this week",
              scores: [{ actionId: "grow-next-episode", weight: 2 }],
            },
            {
              id: "ongoing",
              label: "I want a habit",
              reason: "you want a habit",
              scores: [
                { actionId: "grow-history", weight: 3 },
                { actionId: "grow-next-episode", weight: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "share",
      label: "Share your faith",
      hint: "with people you know",
      chip: "I share my faith",
      eyebrow: "Find your next step",
      heading: "Three quick questions.",
      lead: "Who is it for, and how? We’ll suggest the best way to send it.",
      finish: "The best way to share it.",
      actions: [
        {
          id: "share-send-film",
          title: "Send this film",
          body: "Share the film as a link with a clean preview.",
          target: { kind: "current-video", target: "share" },
        },
        {
          id: "share-conversation-starters",
          title: "Start a conversation",
          body: "Short films that are easy to send and easy to talk about.",
          target: { kind: "video", slug: "conversation-starters" },
        },
        {
          id: "share-amazing-question",
          title: "Learn the Amazing Question",
          body: "A guide to opening a faith conversation.",
          target: { kind: "resource", url: AMAZING_QUESTION },
        },
        {
          id: "share-next-episode",
          title: "Then send the next film",
          body: "One film at a time keeps the conversation going.",
          target: { kind: "current-video", target: "next-episode" },
        },
      ],
      questions: [
        {
          id: "who",
          prompt: "Who do you have in mind?",
          options: [
            {
              id: "friend",
              label: "One friend",
              reason: "you have one friend in mind",
              scores: [{ actionId: "share-send-film", weight: 3 }],
            },
            {
              id: "family",
              label: "Family",
              reason: "you’re thinking of family",
              scores: [
                { actionId: "share-conversation-starters", weight: 2 },
                { actionId: "share-send-film", weight: 1 },
              ],
            },
            {
              id: "group",
              label: "My group or class",
              reason: "you have a group in mind",
              scores: [
                { actionId: "share-conversation-starters", weight: 2 },
                { actionId: "share-amazing-question", weight: 1 },
              ],
            },
            {
              id: "online",
              label: "People who follow me online",
              reason: "you want to reach people online",
              scores: [{ actionId: "share-send-film", weight: 3 }],
            },
          ],
        },
        {
          id: "where",
          prompt: "Where are they at?",
          options: [
            {
              id: "curious",
              label: "Curious",
              reason: "they’re curious",
              scores: [
                { actionId: "share-conversation-starters", weight: 2 },
                { actionId: "share-send-film", weight: 1 },
              ],
            },
            {
              id: "skeptical",
              label: "Skeptical",
              reason: "they’re skeptical",
              scores: [
                { actionId: "share-amazing-question", weight: 4 },
                { actionId: "share-conversation-starters", weight: 1 },
              ],
            },
            {
              id: "hurting",
              label: "Going through something",
              reason: "they’re going through something",
              scores: [
                { actionId: "share-send-film", weight: 2 },
                { actionId: "share-amazing-question", weight: 1 },
              ],
            },
            {
              id: "believer",
              label: "Already a believer",
              reason: "they already believe",
              scores: [{ actionId: "share-next-episode", weight: 3 }],
            },
          ],
        },
        {
          id: "how",
          prompt: "How will you share it?",
          options: [
            {
              id: "message",
              label: "In a message",
              reason: "you’ll send a message",
              scores: [{ actionId: "share-send-film", weight: 3 }],
            },
            {
              id: "together",
              label: "Watch it together",
              reason: "you’ll watch it together",
              scores: [
                { actionId: "share-conversation-starters", weight: 3 },
                { actionId: "share-amazing-question", weight: 1 },
              ],
            },
            {
              id: "post",
              label: "Post it",
              reason: "you’ll post it",
              scores: [
                { actionId: "share-send-film", weight: 2 },
                { actionId: "share-next-episode", weight: 1 },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "partner",
      label: "Partner with us",
      hint: "churches & ministries",
      chip: "I’m a ministry partner",
      eyebrow: "Find your next step",
      heading: "Three quick questions.",
      lead: "Tell us about the setting and we’ll pull the right materials.",
      finish: "What to download first.",
      actions: [
        {
          id: "partner-download",
          title: "Download this film",
          body: "Choose a quality and language to keep it offline.",
          target: { kind: "current-video", target: "download" },
        },
        {
          id: "partner-language",
          title: "Find the language you need",
          body: "Browse every language the films are available in.",
          target: { kind: "languages" },
        },
        {
          id: "partner-film-gathering",
          title: "Host a film gathering",
          body: "A guide to showing short films to a group.",
          target: { kind: "resource", url: FILM_GATHERING },
        },
        {
          id: "partner-beginning-with-jesus",
          title: "Explore Beginning With Jesus",
          body: "A step-by-step training resource from Jesus Film Project.",
          target: { kind: "resource", url: BEGINNING_WITH_JESUS },
        },
        {
          id: "partner-share",
          title: "Share it online",
          body: "A link with a clean preview for your community.",
          target: { kind: "current-video", target: "share" },
        },
      ],
      questions: [
        {
          id: "plan",
          prompt: "What are you planning?",
          options: [
            {
              id: "service",
              label: "A service or event",
              reason: "you’re planning an event",
              scores: [
                { actionId: "partner-film-gathering", weight: 3 },
                { actionId: "partner-download", weight: 1 },
              ],
            },
            {
              id: "groups",
              label: "Small groups",
              reason: "you’re running small groups",
              scores: [{ actionId: "partner-beginning-with-jesus", weight: 3 }],
            },
            {
              id: "language",
              label: "Outreach in another language",
              reason: "you’re reaching another language",
              scores: [
                { actionId: "partner-language", weight: 3 },
                { actionId: "partner-download", weight: 1 },
              ],
            },
            {
              id: "campaign",
              label: "An online campaign",
              reason: "you’re running an online campaign",
              scores: [{ actionId: "partner-share", weight: 3 }],
            },
          ],
        },
        {
          id: "size",
          prompt: "How many people?",
          options: [
            {
              id: "small",
              label: "Under 20",
              reason: "it’s a small group",
              scores: [{ actionId: "partner-beginning-with-jesus", weight: 2 }],
            },
            {
              id: "mid",
              label: "20 to 200",
              reason: "it’s a room of people",
              scores: [{ actionId: "partner-film-gathering", weight: 2 }],
            },
            {
              id: "large",
              label: "Hundreds or more",
              reason: "it’s hundreds of people",
              scores: [
                { actionId: "partner-film-gathering", weight: 2 },
                { actionId: "partner-download", weight: 1 },
              ],
            },
          ],
        },
        {
          id: "offline",
          prompt: "Will you have reliable internet where you show it?",
          options: [
            {
              id: "yes",
              label: "Yes, we’ll stream",
              reason: "you’ll stream it",
              scores: [{ actionId: "partner-share", weight: 2 }],
            },
            {
              id: "no",
              label: "No, we need it offline",
              reason: "you need it offline",
              scores: [{ actionId: "partner-download", weight: 3 }],
            },
            {
              id: "unsure",
              label: "Not sure yet",
              reason: "you’re not sure about internet",
              scores: [
                { actionId: "partner-download", weight: 1 },
                { actionId: "partner-share", weight: 1 },
              ],
            },
          ],
        },
      ],
    },
  ],
}

/**
 * What a Watch surface knows about the published configuration, resolved by
 * `lib/watch-audience-content.ts`. `absent` means no authored configuration
 * exists for the requested locale (or Admin predates the block): the code
 * definitions above stand in until one is published. `rejected` and
 * `unavailable` mean an authored configuration exists but cannot be shown;
 * the frame is omitted and never replaced by the baked-in questions.
 */
export type WatchAudienceResolution =
  | { kind: "authored"; config: WatchAudienceConfig; identity: string }
  | { kind: "rejected" }
  | { kind: "unavailable" }
  | { kind: "absent" }

export type WatchAudienceFrame = {
  config: WatchAudienceConfig
  /** Changes whenever the configuration does, so the frame remounts and answers reset. */
  identity: string
}

export function watchAudienceFrame(
  resolution: WatchAudienceResolution | undefined,
): WatchAudienceFrame | null {
  if (resolution?.kind === "authored") {
    return { config: resolution.config, identity: resolution.identity }
  }
  if (resolution === undefined || resolution.kind === "absent") {
    return { config: WATCH_AUDIENCE_CODE_CONFIG, identity: "code" }
  }
  return null
}
