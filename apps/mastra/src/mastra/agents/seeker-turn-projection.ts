/**
 * Shared turn-attachment projection for the seeker (feat-329, plan P8).
 *
 * ONE home for the wire projections and the resolution ladder, consumed by BOTH
 * paths that must not drift:
 *
 *   - `agents/seeker-route.ts` (LIVE turns) — normalizes `toolResults` chunks
 *     shaped `{ payload: { toolName, result } }`.
 *   - `ai-chat-history-route.ts` (REPLAY) — normalizes stored assistant message
 *     parts shaped `{ type: "tool-invocation", toolInvocation: { toolName,
 *     result } }`.
 *
 * The two native shapes are structurally different, so each route supplies its
 * OWN thin adapter down to `SeekerToolChunk` and only the projection +
 * resolution is shared. That split is the point: a change to what a featured
 * video may contain, or to the declaration ladder, lands on both paths at once,
 * while neither path pretends the other's storage shape is its own.
 *
 * PURE AND TOTAL — no I/O, no logging, no env reads. Every shape mismatch
 * degrades to "attach nothing", never a throw. Logging deliberately lives at
 * the CALLERS: the send path emits the operator-facing `[seeker-route]` lines
 * once per live turn, while replay re-resolves EVERY stored turn on every
 * thread open and must stay silent — the same rejection was already logged when
 * the turn was live, so repeating it per replay would be a burst of stale
 * history. `resolveTurnAttachments` therefore RETURNS the rejection reason and
 * the E7 signal rather than emitting them.
 */

import {
  projectFollowUps,
  SUGGEST_FOLLOW_UPS_TOOL_NAME,
} from "../seeker-follow-ups"
import {
  FEATURABLE_AVAILABILITY_KIND,
  PLAYBACK_ID_PATTERN,
  SLUG_PATTERN,
  VIDEO_ID_PATTERN,
} from "../seeker-video-gates"
import { FEATURE_VIDEO_TOOL_NAME } from "../tools/feature-video"
import { SEEKER_SEARCH_VIDEOS_TOOL_NAME } from "../tools/seeker-search-videos"

/** Tool NAME the sources projection keys on. Imported constants cover the two
 * video tools; `retrieveAnswer` has no tool-module constant to import. */
export const RETRIEVE_ANSWER_TOOL_NAME = "retrieveAnswer"

/**
 * One tool result, normalized out of a route's native shape. `result` stays
 * `unknown`: a tool whose `execute` THREW persists its error MESSAGE here as a
 * plain string (observed on the real store, 2026-08-04), so a non-object result
 * is a production shape, not a hypothetical.
 */
export type SeekerToolChunk = { toolName: string; result: unknown }

/** A single source as projected onto the wire (KTD4 allowlist). */
export type SeekerWireSource = {
  sourceName: string
  title: string | null
  url: string
  score: number
  snippet: string
}

/**
 * The declared video as projected onto the wire (feat-327, plan D9). Exactly
 * these six fields — `toStrictEqual`-pinned. No URL field exists on the wire at
 * all: chat builds the watch URL client-side from the validated slugs.
 */
export type SeekerWireVideo = {
  videoId: string
  title: string
  slug: string
  playbackId: string
  durationSeconds: number | null
  languageSlug: string | null
}

/** Why a `featureVideo` declaration attached nothing (plan D4's ladder). */
export type SeekerVideoRejection =
  | "malformed"
  | "id_not_in_results"
  | "projection_failed"

/**
 * Everything one turn's tool chunks yield. `video` is OMITTED (never null) when
 * nothing valid was declared; `videoRejection` is present only when a
 * declaration EXISTED and failed — a turn with no declaration at all (the
 * normal case) reports neither.
 */
export type SeekerTurnAttachments = {
  sources: SeekerWireSource[]
  grounded: boolean
  video?: SeekerWireVideo
  videoRejection?: SeekerVideoRejection
  /**
   * Suggested follow-up questions (feat-366, KTD3/KTD4) — empty when the turn
   * carries none. The WIRE omits the field when empty (R7); callers own that
   * omission, matching how `video` is omitted at the frame assembly.
   */
  followUps: string[]
  /** E7 signal: the turn used a video tool but never called retrieveAnswer. */
  ungroundedVideoTurn: boolean
}

/**
 * Project a single retrieveAnswer source onto the wire field-by-field (KTD4).
 * Never spreads — a future field added to the tool's source shape cannot
 * silently widen the wire. `snippet` is the tool's already-capped `text`.
 * Returns null when the candidate is not a well-shaped source object.
 */
export function projectSource(candidate: unknown): SeekerWireSource | null {
  if (typeof candidate !== "object" || candidate === null) return null
  const s = candidate as {
    text?: unknown
    sourceName?: unknown
    title?: unknown
    url?: unknown
    score?: unknown
  }
  if (typeof s.sourceName !== "string") return null
  if (typeof s.url !== "string") return null
  if (typeof s.score !== "number") return null
  return {
    sourceName: s.sourceName,
    title: typeof s.title === "string" ? s.title : null,
    url: s.url,
    score: s.score,
    snippet: typeof s.text === "string" ? s.text : "",
  }
}

/**
 * Project one `searchVideos` candidate row onto the wire field-by-field
 * (plan D9). Never spreads, so a future field on the tool's output cannot
 * silently widen the wire, and re-asserts every condition the tool boundary
 * already enforced (belt-and-braces: the route treats tool payloads as
 * untrusted).
 *
 * Returns null — meaning "not featurable" — when the row is not a well-shaped
 * object, when any required string is missing, when `playbackId` or either slug
 * fails its pattern gate, or when `availability.kind` is not `target_audio`
 * (which also fail-closes an unknown/absent kind).
 *
 * D9 SHAPE GATES, shared with the tool boundary (`../seeker-video-gates` —
 * read it for why each pattern is what it is, and for the 2026-08-04
 * production evidence affirming the slug pattern). The tool now drops
 * non-conforming rows too, so in practice these re-checks fire only when a
 * tool payload is not what the route was promised — which is exactly the
 * assumption D9 refuses to make. Sharing the CONSTANTS is not skipping the
 * CHECK: this function re-validates the declared row over an `unknown`
 * payload regardless of what any upstream filter claims to have done. On the
 * REPLAY path that matters more, not less: a stored row was written by
 * whatever gates shipped the day the turn ran.
 *
 * `languageSlug` is nullable: absent is legitimate (chat falls back to the
 * default-language watch URL). But a PRESENT value that fails the slug pattern
 * rejects the whole row rather than degrading to null — a malformed slug is a
 * contract violation, not a missing field.
 */
export function projectVideo(candidate: unknown): SeekerWireVideo | null {
  if (typeof candidate !== "object" || candidate === null) return null
  const v = candidate as {
    videoId?: unknown
    title?: unknown
    slug?: unknown
    playbackId?: unknown
    durationSeconds?: unknown
    languageSlug?: unknown
    availability?: unknown
  }
  if (typeof v.videoId !== "string" || !VIDEO_ID_PATTERN.test(v.videoId)) {
    return null
  }
  if (typeof v.title !== "string" || v.title.length === 0) return null
  if (typeof v.slug !== "string" || !SLUG_PATTERN.test(v.slug)) return null
  if (
    typeof v.playbackId !== "string" ||
    !PLAYBACK_ID_PATTERN.test(v.playbackId)
  ) {
    return null
  }

  const availability = v.availability as { kind?: unknown } | null | undefined
  if (availability?.kind !== FEATURABLE_AVAILABILITY_KIND) return null

  let languageSlug: string | null = null
  if (v.languageSlug != null) {
    if (
      typeof v.languageSlug !== "string" ||
      !SLUG_PATTERN.test(v.languageSlug)
    ) {
      return null
    }
    languageSlug = v.languageSlug
  }

  return {
    videoId: v.videoId,
    title: v.title,
    slug: v.slug,
    playbackId: v.playbackId,
    // Finite and non-negative, not merely `typeof === "number"`: NaN and
    // Infinity both serialize to JSON `null` on the wire — a silent lie about a
    // field the renderer formats — and a negative duration is not a duration.
    durationSeconds:
      typeof v.durationSeconds === "number" &&
      Number.isFinite(v.durationSeconds) &&
      v.durationSeconds >= 0
        ? v.durationSeconds
        : null,
    languageSlug,
  }
}

/**
 * Extract `{ sources, grounded }` from one turn's chunks. Reads the LAST
 * `retrieveAnswer` chunk, projects its `result.sources` through the allowlist,
 * and sets `grounded` only when that result's `status === "ok"`. Pure + total:
 * any shape mismatch degrades to `{ sources: [], grounded: false }`.
 */
function extractSources(chunks: readonly SeekerToolChunk[]): {
  sources: SeekerWireSource[]
  grounded: boolean
} {
  let last: SeekerToolChunk | undefined
  for (const chunk of chunks) {
    if (chunk.toolName === RETRIEVE_ANSWER_TOOL_NAME) last = chunk
  }
  if (!last) return { sources: [], grounded: false }
  const result = last.result as { status?: unknown; sources?: unknown }
  const rawSources = Array.isArray(result?.sources) ? result.sources : []
  const sources = rawSources
    .map(projectSource)
    .filter((s): s is SeekerWireSource => s !== null)
  return { sources, grounded: result?.status === "ok" }
}

/**
 * Resolve this turn's featured video from its chunks (feat-327, plan D4/P3).
 *
 * The model DECLARES; it never authors. Resolution is:
 *   1. union every `searchVideos` result row from the turn, keyed by videoId —
 *      both the raw ids the model was shown and their projected,
 *      pattern-gated, target_audio-only counterparts. On a videoId collision a
 *      later call's row replaces an earlier one ONLY when it also projects
 *      successfully; a later row that fails a gate leaves the earlier valid
 *      projection standing rather than downgrading the turn to no video;
 *   2. take the LAST `featureVideo` declaration;
 *   3. attach iff the declared id resolves in the PROJECTED union.
 *
 * Keeping both maps is what makes the failure ladder honest: an id the model
 * never saw (`id_not_in_results`) is a different operator signal from an id it
 * saw whose row failed the gates (`projection_failed`).
 *
 * Every rung attaches nothing and NEVER produces an error frame (plan D4). The
 * reason is RETURNED, not logged — see the module docstring for why replay must
 * stay silent.
 *
 * Note for operators: `id_not_in_results` also fires on legitimate "show me
 * that one again" turns, because the union is turn-scoped by design —
 * frequency, not existence, is the signal.
 */
function resolveDeclaredVideo(chunks: readonly SeekerToolChunk[]): {
  video?: SeekerWireVideo
  rejection?: SeekerVideoRejection
} {
  const seenIds = new Set<string>()
  const projected = new Map<string, SeekerWireVideo>()
  let declaration: SeekerToolChunk | undefined

  for (const chunk of chunks) {
    if (chunk.toolName === SEEKER_SEARCH_VIDEOS_TOOL_NAME) {
      const result = chunk.result as { videos?: unknown }
      const rows = Array.isArray(result?.videos) ? result.videos : []
      for (const row of rows) {
        const id = (row as { videoId?: unknown } | null)?.videoId
        if (typeof id === "string" && id.length > 0) seenIds.add(id)
        const video = projectVideo(row)
        // A later call's row replaces an earlier one only when it ALSO
        // projects — a later gate failure never downgrades a turn that already
        // had a valid candidate for that id.
        if (video) projected.set(video.videoId, video)
      }
    } else if (chunk.toolName === FEATURE_VIDEO_TOOL_NAME) {
      declaration = chunk
    }
  }

  if (!declaration) return {}

  const declared = (declaration.result as { videoId?: unknown } | null)?.videoId
  if (typeof declared !== "string" || declared.length === 0) {
    return { rejection: "malformed" }
  }

  const video = projected.get(declared)
  if (video) return { video }

  return {
    rejection: seenIds.has(declared)
      ? "projection_failed"
      : "id_not_in_results",
  }
}

/**
 * Resolve a turn's suggested follow-up questions from its chunks (feat-366,
 * KTD3). Reads the LAST `suggestFollowUps` chunk (last-wins, matching
 * `extractSources`) and re-validates its `result.questions` through the
 * shared drop-never-repair projection. Pure + total: any shape mismatch
 * degrades to [].
 *
 * Scope, stated precisely (review-corrected): only the REPLAY adapter
 * synthesizes this chunk (from stored `content.metadata.seekerFollowUps`) —
 * the chunk name is never a real tool; the generator is zero-tool (KTD5).
 * The LIVE path never carries such a chunk: the route's terminal frame takes
 * its questions straight from the generation outcome, which
 * `generateSeekerFollowUps` already ran through the same `projectFollowUps`.
 * So the single re-validation point both paths share is the pure
 * `projectFollowUps` function — live via the generator, replay via this
 * resolver — and `SeekerTurnAttachments.followUps` is populated only on
 * replay (always `[]` on live turns).
 */
export function resolveStoredFollowUps(
  chunks: readonly SeekerToolChunk[],
): string[] {
  let last: SeekerToolChunk | undefined
  for (const chunk of chunks) {
    if (chunk.toolName === SUGGEST_FOLLOW_UPS_TOOL_NAME) last = chunk
  }
  if (!last) return []
  const result = last.result as { questions?: unknown } | null | undefined
  return projectFollowUps(result?.questions)
}

/**
 * Resolve one turn's wire attachments from its normalized tool chunks — the
 * single entry point both routes call after adapting their native shape.
 *
 * Pure and total; see the module docstring for the caller-owned logging split.
 */
export function resolveTurnAttachments(
  chunks: readonly SeekerToolChunk[],
): SeekerTurnAttachments {
  const { sources, grounded } = extractSources(chunks)
  const { video, rejection } = resolveDeclaredVideo(chunks)
  const followUps = resolveStoredFollowUps(chunks)

  let usedVideoTool = false
  let retrieved = false
  for (const chunk of chunks) {
    if (
      chunk.toolName === SEEKER_SEARCH_VIDEOS_TOOL_NAME ||
      chunk.toolName === FEATURE_VIDEO_TOOL_NAME
    ) {
      usedVideoTool = true
    } else if (chunk.toolName === RETRIEVE_ANSWER_TOOL_NAME) {
      retrieved = true
    }
  }

  return {
    sources,
    grounded,
    ...(video ? { video } : {}),
    ...(rejection ? { videoRejection: rejection } : {}),
    followUps,
    ungroundedVideoTurn: usedVideoTool && !retrieved,
  }
}
