// Published Watch audience configuration: the one source both Watch surfaces
// read. Admin projects the published default-template `watchAudience` block
// through `WatchSetting.watchAudience(locale)`; this module loads it once per
// locale (shared by home and video), turns the wire JSON into the U1
// `WatchAudienceConfig`, and re-applies the destination checks the editor
// enforced at save so MCP-written or historical JSON cannot reach a link.
//
// Read policy (mirrors Admin's projection):
//   - STRICT NULL: the requested locale only. No locale, homepage or draft
//     fallback. A null/absent block keeps the temporary code fallback.
//   - A present-but-unusable authored block is `rejected`/`unavailable`: the
//     frame is omitted, never replaced by the baked-in questions.
// No headers, cookies or session are read, so the result is safe in ISR.

import {
  WatchAudienceConfigurationSchema,
  isSafeWatchAudienceTarget,
} from "@forge/experience-schema"

import type { ErrorLike } from "@apollo/client"
import { cache } from "react"
import { unstable_cache } from "next/cache"
import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"
import { visit, type DocumentNode } from "graphql"

import client from "@/lib/admin-client"
import { WATCH_CACHE_TAGS } from "@/lib/watch-cache-tags"
import { logWatchServerEvent } from "@/lib/watch-observability"
import {
  WATCH_AUDIENCE_CURRENT_VIDEO_TARGETS,
  WATCH_AUDIENCE_MAX_ACTIONS,
  WATCH_AUDIENCE_MAX_OPTIONS,
  WATCH_AUDIENCE_QUESTION_COUNT,
  WATCH_AUDIENCE_ROLE_IDS,
  isWatchAudienceRoleId,
  validateWatchAudienceConfig,
  type WatchAudienceAction,
  type WatchAudienceActionTarget,
  type WatchAudienceConfig,
  type WatchAudienceCurrentVideoTarget,
  type WatchAudienceOption,
  type WatchAudienceQuestion,
  type WatchAudienceResolution,
  type WatchAudienceRoleDefinition,
} from "@/lib/watch-audience-config"

/**
 * Publication or a default-template change emits the existing `watch-setting`
 * revalidation, which expires `settings`; `experience` covers a direct
 * Experience revalidation of the template.
 */
export const WATCH_AUDIENCE_CACHE_TAGS = [
  WATCH_CACHE_TAGS.settings,
  WATCH_CACHE_TAGS.experience,
] as const

/**
 * UTF-16 units. The largest legal payload (4 roles × 8 actions × 3 questions
 * × 6 options with all copy at its limit) is well under 100 000 units; the cap
 * only exists to refuse a pathological body before it is parsed.
 */
export const MAX_WATCH_AUDIENCE_JSON_LENGTH = 262_144

const GET_WATCH_AUDIENCE = adminGraphql(`
  query GetWatchAudience($locale: String!) {
    watchSetting(locale: $locale) {
      watchAudience(locale: $locale) {
        configJson
        sourceLocale
        sourceBlockId
        rejected
      }
    }
  }
`)

type WatchAudienceWire = NonNullable<
  NonNullable<
    AdminResultOf<typeof GET_WATCH_AUDIENCE>["watchSetting"]
  >["watchAudience"]
>

export class WatchAudienceLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "WatchAudienceLoadError"
  }
}

export type ParsedWatchAudience =
  | { ok: true; config: WatchAudienceConfig; droppedActions: number }
  | { ok: false; reason: string }

type Rec = Record<string, unknown>

const isRec = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isCurrentVideoTarget = (
  value: unknown,
): value is WatchAudienceCurrentVideoTarget =>
  typeof value === "string" &&
  (WATCH_AUDIENCE_CURRENT_VIDEO_TARGETS as readonly string[]).includes(value)

function coerceTarget(raw: unknown): WatchAudienceActionTarget | null {
  if (!isRec(raw)) return null
  switch (raw.kind) {
    case "video":
      return typeof raw.slug === "string"
        ? { kind: "video", slug: raw.slug }
        : null
    case "history":
      return { kind: "history" }
    case "languages":
      return { kind: "languages" }
    case "current-video":
      return isCurrentVideoTarget(raw.target)
        ? { kind: "current-video", target: raw.target }
        : null
    case "resource":
      return typeof raw.url === "string"
        ? { kind: "resource", url: raw.url }
        : null
    // An unknown kind is a different contract, not an unsafe destination.
    default:
      return null
  }
}

function coerceAction(raw: unknown): WatchAudienceAction | null {
  if (!isRec(raw)) return null
  const target = coerceTarget(raw.target)
  if (
    typeof raw.id !== "string" ||
    typeof raw.title !== "string" ||
    typeof raw.body !== "string" ||
    !target
  ) {
    return null
  }
  return { id: raw.id, title: raw.title, body: raw.body, target }
}

function coerceOption(raw: unknown): WatchAudienceOption | null {
  if (
    !isRec(raw) ||
    typeof raw.id !== "string" ||
    typeof raw.label !== "string" ||
    typeof raw.reason !== "string" ||
    !Array.isArray(raw.scores) ||
    raw.scores.length > WATCH_AUDIENCE_MAX_ACTIONS ||
    (raw.hint !== undefined && typeof raw.hint !== "string")
  ) {
    return null
  }
  const scores: WatchAudienceOption["scores"] = []
  for (const score of raw.scores) {
    if (
      !isRec(score) ||
      typeof score.actionId !== "string" ||
      typeof score.weight !== "number"
    ) {
      return null
    }
    scores.push({ actionId: score.actionId, weight: score.weight })
  }
  return {
    id: raw.id,
    label: raw.label,
    ...(raw.hint === undefined ? {} : { hint: raw.hint }),
    reason: raw.reason,
    scores,
  }
}

function coerceQuestion(raw: unknown): WatchAudienceQuestion | null {
  if (
    !isRec(raw) ||
    typeof raw.id !== "string" ||
    typeof raw.prompt !== "string" ||
    !Array.isArray(raw.options) ||
    raw.options.length > WATCH_AUDIENCE_MAX_OPTIONS
  ) {
    return null
  }
  const options = raw.options.map(coerceOption)
  if (options.some((option) => option === null)) return null
  return {
    id: raw.id,
    prompt: raw.prompt,
    options: options as WatchAudienceOption[],
  }
}

function coerceRole(raw: unknown): WatchAudienceRoleDefinition | null {
  if (
    !isRec(raw) ||
    !isWatchAudienceRoleId(raw.id) ||
    !Array.isArray(raw.actions) ||
    raw.actions.length > WATCH_AUDIENCE_MAX_ACTIONS ||
    !Array.isArray(raw.questions) ||
    raw.questions.length !== WATCH_AUDIENCE_QUESTION_COUNT
  ) {
    return null
  }
  const copy = [
    raw.label,
    raw.hint,
    raw.chip,
    raw.eyebrow,
    raw.heading,
    raw.lead,
    raw.finish,
  ]
  if (copy.some((value) => typeof value !== "string")) return null
  const actions = raw.actions.map(coerceAction)
  const questions = raw.questions.map(coerceQuestion)
  if (actions.includes(null) || questions.includes(null)) return null
  return {
    id: raw.id,
    label: raw.label as string,
    hint: raw.hint as string,
    chip: raw.chip as string,
    eyebrow: raw.eyebrow as string,
    heading: raw.heading as string,
    lead: raw.lead as string,
    finish: raw.finish as string,
    questions: questions as WatchAudienceQuestion[],
    actions: actions as WatchAudienceAction[],
  }
}

/**
 * Bounded structural parse, then the same safety pass Admin's read projection
 * runs: drop actions whose destination is unsafe together with every score
 * that pointed at them, and re-validate the remainder with the shared U1
 * validator. Unknown fields are ignored (a newer Admin may add some); unknown
 * target kinds, bad cardinality, dangling references or a role left with no
 * action reject the whole configuration. Order and weights are preserved.
 */
export function parseWatchAudienceConfig(raw: unknown): ParsedWatchAudience {
  if (!isRec(raw) || !Array.isArray(raw.roles)) {
    return { ok: false, reason: "roles-missing" }
  }
  if (raw.roles.length !== WATCH_AUDIENCE_ROLE_IDS.length) {
    return { ok: false, reason: "role-set" }
  }
  const roles = raw.roles.map(coerceRole)
  if (roles.includes(null)) return { ok: false, reason: "malformed-structure" }

  let droppedActions = 0
  const config: WatchAudienceConfig = {
    roles: (roles as WatchAudienceRoleDefinition[]).map((role) => {
      const actions = role.actions.filter((action) =>
        isSafeWatchAudienceTarget(action.target),
      )
      if (actions.length === role.actions.length) return role
      droppedActions += role.actions.length - actions.length
      const kept = new Set(actions.map((action) => action.id))
      const dropped = new Set(
        role.actions.map((action) => action.id).filter((id) => !kept.has(id)),
      )
      // Only scores of a dropped action go; a reference to an id that never
      // existed stays so validation rejects it.
      return {
        ...role,
        actions,
        questions: role.questions.map((question) => ({
          ...question,
          options: question.options.map((option) => ({
            ...option,
            scores: option.scores.filter(
              (score) => !dropped.has(score.actionId),
            ),
          })),
        })),
      }
    }),
  }

  const [issue] = validateWatchAudienceConfig(config)
  if (issue) return { ok: false, reason: `${issue.code}:${issue.path}` }
  const shared = WatchAudienceConfigurationSchema.safeParse(config)
  if (!shared.success) return { ok: false, reason: "invalid-configuration" }
  return { ok: true, config: shared.data, droppedActions }
}

export function parseWatchAudienceJson(json: string): ParsedWatchAudience {
  if (json.length > MAX_WATCH_AUDIENCE_JSON_LENGTH) {
    return { ok: false, reason: "too-large" }
  }
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    // Never echo the parser error: it can embed a fragment of the body.
    return { ok: false, reason: "invalid-json" }
  }
  return parseWatchAudienceConfig(raw)
}

// FNV-1a over UTF-16 units. Identity only: it makes a configuration change
// remount the frame (answers reset); it is not a security control.
function fingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/** Wire projection -> what a surface renders. Never invents a replacement. */
export function projectWatchAudience(
  wire: Pick<
    WatchAudienceWire,
    "configJson" | "rejected" | "sourceLocale" | "sourceBlockId"
  > | null,
): WatchAudienceResolution {
  if (!wire) return { kind: "absent" }
  if (wire.rejected || wire.configJson == null) return { kind: "rejected" }
  const parsed = parseWatchAudienceJson(wire.configJson)
  if (!parsed.ok) return { kind: "rejected" }
  return {
    kind: "authored",
    config: parsed.config,
    identity: `${wire.sourceLocale}:${wire.sourceBlockId}:${fingerprint(
      JSON.stringify(parsed.config),
    )}`,
  }
}

type GraphqlErrorCandidate = {
  readonly message?: unknown
  readonly path?: unknown
  readonly extensions?: unknown
}

type LagCandidate = { error?: ErrorLike | null; errors?: unknown[] | undefined }

function graphqlErrorsOf(result: LagCandidate): GraphqlErrorCandidate[] {
  const direct = Array.isArray(result.errors) ? result.errors : []
  const nested =
    typeof result.error === "object" &&
    result.error !== null &&
    "errors" in result.error &&
    Array.isArray(result.error.errors)
      ? result.error.errors
      : []
  return [...direct, ...nested].filter(
    (entry): entry is GraphqlErrorCandidate =>
      typeof entry === "object" && entry !== null,
  )
}

// A validation failure carries no execution path; an execution error (a
// resolver that threw) does and is never schema lag.
function isValidationShaped(entry: GraphqlErrorCandidate): boolean {
  if (entry.path != null) return false
  const code =
    typeof entry.extensions === "object" &&
    entry.extensions !== null &&
    "code" in entry.extensions
      ? entry.extensions.code
      : undefined
  return code === undefined || code === "GRAPHQL_VALIDATION_FAILED"
}

function messagesMatching(
  result: LagCandidate,
  patterns: readonly RegExp[],
): { errors: number; matched: boolean } {
  const errors = graphqlErrorsOf(result)
  if (errors.length === 0 || !errors.every(isValidationShaped)) {
    return { errors: errors.length, matched: false }
  }
  return {
    errors: errors.length,
    matched: errors.every((entry) =>
      patterns.some(
        (pattern) =>
          typeof entry.message === "string" && pattern.test(entry.message),
      ),
    ),
  }
}

// graphql-js validation messages, pinned against the real SDL in the tests.
const WATCH_AUDIENCE_FIELD_LAG_MESSAGES = [
  /^Cannot query field "watchAudience" on type "WatchSetting"\./,
  /^Unknown argument "locale" on field "WatchSetting\.watchAudience"\./,
  /^Cannot query field "(configJson|sourceLocale|sourceBlockId|rejected)" on type "WatchAudienceConfiguration"\./,
]
const WATCH_AUDIENCE_BLOCK_LAG_MESSAGES = [
  /^Unknown type "WatchAudienceBlock"\./,
]

/** True only when EVERY error says Admin predates `WatchSetting.watchAudience`. */
export function isWatchAudienceFieldSchemaLag(result: LagCandidate): boolean {
  return messagesMatching(result, WATCH_AUDIENCE_FIELD_LAG_MESSAGES).matched
}

/**
 * Errors an Admin that predates the `WatchAudienceBlock` union member returns
 * for a selection that spreads it. `partitionWatchAudienceBlockLag` splits
 * them from the others so the existing category-rail ladder can classify the
 * remainder unchanged.
 */
export function partitionWatchAudienceBlockLag(result: LagCandidate): {
  audience: boolean
  rest: LagCandidate
} {
  const errors = graphqlErrorsOf(result)
  const isAudience = (entry: GraphqlErrorCandidate) =>
    isValidationShaped(entry) &&
    typeof entry.message === "string" &&
    WATCH_AUDIENCE_BLOCK_LAG_MESSAGES.some((pattern) =>
      pattern.test(entry.message as string),
    )
  const audienceErrors = errors.filter(isAudience)
  return {
    audience: audienceErrors.length > 0,
    rest: { errors: errors.filter((entry) => !isAudience(entry)) },
  }
}

/**
 * The same selection without the `WatchAudienceBlock` union member and its
 * fragment definition, for an Admin that predates the block. Derived from the
 * current document so the two can never drift; everything else is untouched.
 */
export function omitWatchAudienceSelection<T extends DocumentNode>(
  document: T,
): T {
  const dropped = new Set(
    document.definitions.flatMap((definition) =>
      definition.kind === "FragmentDefinition" &&
      definition.typeCondition.name.value === "WatchAudienceBlock"
        ? [definition.name.value]
        : [],
    ),
  )
  const omitted = visit(document, {
    InlineFragment(node) {
      return node.typeCondition?.name.value === "WatchAudienceBlock"
        ? null
        : undefined
    },
    FragmentDefinition(node) {
      return dropped.has(node.name.value) ? null : undefined
    },
  })
  return omitted as T
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * One query, requested locale only. Resolves `absent` for an Admin that
 * predates the field (every error is the known field-lag validation message);
 * anything else - network, timeout, an execution error, an unrelated
 * validation error - rejects with a `WatchAudienceLoadError` so it stays
 * diagnosable instead of passing for "no configuration".
 */
export async function loadWatchAudience(
  locale: string,
): Promise<WatchAudienceResolution> {
  let thrown: unknown = null
  const result = await client
    .query({
      query: GET_WATCH_AUDIENCE,
      variables: { locale },
      fetchPolicy: "no-cache",
    })
    .catch((error: unknown) => {
      thrown = error
      return null
    })
  if (result === null) {
    if (isWatchAudienceFieldSchemaLag({ error: thrown as ErrorLike })) {
      return { kind: "absent" }
    }
    throw new WatchAudienceLoadError(
      `Watch audience query failed: ${toError(thrown).message}`,
      { cause: thrown },
    )
  }

  const candidate = result as LagCandidate
  if (isWatchAudienceFieldSchemaLag(candidate)) return { kind: "absent" }
  const errors = graphqlErrorsOf(candidate)
  if (errors.length > 0 || candidate.error) {
    const message =
      errors
        .map((entry) =>
          typeof entry.message === "string" ? entry.message : "Unknown",
        )
        .join("; ") ||
      (candidate.error ? toError(candidate.error).message : "Unknown")
    throw new WatchAudienceLoadError(`Watch audience query failed: ${message}`)
  }
  return projectWatchAudience(result.data?.watchSetting?.watchAudience ?? null)
}

const fetchWatchAudience = unstable_cache(
  loadWatchAudience,
  ["watch-audience", "v1"],
  { revalidate: 60, tags: [...WATCH_AUDIENCE_CACHE_TAGS] },
)

/**
 * Home and video resolve the same locale through this one cached load, so a
 * render pass issues at most one query and both surfaces show one definition.
 * A load failure omits the frame (`unavailable`) and logs the cause; it never
 * falls back to the baked-in questions, because an authored configuration may
 * exist behind the failure.
 */
export const resolveWatchAudience = cache(
  async (locale: string): Promise<WatchAudienceResolution> => {
    try {
      return await fetchWatchAudience(locale)
    } catch (error) {
      logWatchServerEvent(
        "watch_audience.load_failed",
        { locale, error: toError(error) },
        { level: "error" },
      )
      return { kind: "unavailable" }
    }
  },
)
