/**
 * Bearer-gated read surface for the ai-chat lane's persisted conversations
 * (feat-241): the listing handler behind `POST /forge-ai-chat-history-list`
 * and the replay handler behind `POST /forge-ai-chat-history-replay`, both
 * registered in `./index.ts` with per-route in-handler validation (never
 * `/api/*` middleware — that breaks Studio; see
 * docs/solutions/integration-issues/mastra-studio-api-auth-guard.md).
 *
 * Gate ladder, checked in order (KTD2): the shared lane admission preamble
 * (`refuseUnlessLaneAdmitted`, feat-283 — enable flag → 404, then the
 * dedicated `AI_CHAT_SERVICE_API_KEYS` lane bearer → 401, key sourcing inside
 * that module) → body validation → `user:`-resource refusal (R2: the
 * anonymous and dogfood fallback resources are never listable or replayable)
 * → store reads, all bounded by `TIME_BUDGET_MS.historyRead`
 * (millisecond-class queries must not inherit the 90s turn envelope).
 *
 * Replay (KTD4/KTD5): `resolveOwnedExistingThread` (feat-284) answers
 * ownership + existence from ONE `getThreadById` — missing thread →
 * `thread_not_found`, owner mismatch → `thread_forbidden`, no ceiling branch
 * on reads (`listThreads` is never called) — then a capped `recall` that
 * ALWAYS passes `resourceId` (omitting it disables the store's own ownership
 * throw) and an explicit `perPage` (the dist default returns only the last
 * 10). Messages are projected field-by-field — user/assistant text, a
 * per-message char cap, and (feat-329) the allowlisted `sources`/`video`
 * re-derived from stored tool parts. Provider metadata and raw tool payloads
 * never reach the wire.
 *
 * Logging is ENUM-only plain-string `[ai-chat-history] event=… reason=…`
 * (KTD13) — never thread ids, titles, transcript text, or exception text.
 */

import { refuseUnlessLaneAdmitted } from "./ai-chat-lane-admission"
import { settleWithinBudget, TIME_BUDGET_MS } from "./budgets"
import {
  resolveOwnedExistingThread,
  USER_RESOURCE_PREFIX,
} from "./ai-chat-thread-ownership"
import { getAiChatMemory } from "./ai-chat-memory"
// feat-329: the projections + declaration ladder are shared with the send path
// (plan P8) so the two cannot drift. This route owns only the adapter from its
// own stored-part shape and the replay-specific bounds below.
import {
  resolveTurnAttachments,
  type SeekerToolChunk,
  type SeekerWireSource,
  type SeekerWireVideo,
} from "./agents/seeker-turn-projection"
// feat-366: stored follow-up questions re-enter the shared projection through
// a SYNTHETIC chunk so `resolveTurnAttachments` stays the single
// re-validation point (KTD3). Deliberately NO flag import on this path — the
// replay of already-stored questions is not flag-gated (KD1; mirrors the
// settled PR #1836 `SEEKER_VIDEO_ENABLED` ruling), and the suite pins this
// file free of the flag tokens.
import {
  FOLLOW_UPS_MAX_QUESTIONS,
  FOLLOW_UPS_QUESTION_MAX_UNITS,
  SEEKER_FOLLOW_UPS_METADATA_KEY,
  SUGGEST_FOLLOW_UPS_TOOL_NAME,
} from "./seeker-follow-ups"

/** Default + ceiling for the listing page size (KTD6; the store has no cap of
 * its own). The chat side deliberately holds no copy of these — it consumes
 * the returned envelope. */
export const AI_CHAT_HISTORY_DEFAULT_PER_PAGE = 20
export const AI_CHAT_HISTORY_MAX_PER_PAGE = 50

/** Replay reads the last N messages of a thread (Scope: no message-level
 * pagination day one). Explicit because the dist's recall default is 10. */
export const AI_CHAT_HISTORY_REPLAY_MESSAGE_LIMIT = 200

/** Per-message cap on projected text (KTD5) so the transcript payload is
 * bounded by construction. The unit is UTF-16 code units (String.slice), ≤3
 * UTF-8 bytes each. Accepted fidelity loss: truncation. The whole-thread
 * budget this feeds is `AI_CHAT_HISTORY_WORST_CASE_THREAD_BYTES` below. */
export const AI_CHAT_HISTORY_TEXT_CAP_CHARS = 8_192

/**
 * Replay-only bounds on the feat-329 attachments. The send path's bounds do
 * NOT fit here: `MAX_PASSAGE_CODEPOINTS` (4,000/passage × 5 sources × 200
 * messages × 3 B/unit) adds ~12 MB worst case and blows the consumer's cap,
 * turning long non-Latin threads into deterministic `unavailable` replays.
 *
 * So replay enforces its OWN deterministic truncation — never a cap raise. The
 * accepted cost is a display divergence from the live turn: a replayed source
 * list can be shorter, and its snippets shorter, than what the turn showed
 * when it ran (R21-adjacent).
 */
export const AI_CHAT_HISTORY_MAX_SOURCES_PER_MESSAGE = 5

/** UTF-16 code units, like the text cap above — ≤3 UTF-8 bytes each. */
export const AI_CHAT_HISTORY_SOURCE_SNIPPET_CAP_CHARS = 512

/**
 * Cap on EVERY other variable-length attachment string: a source's
 * `sourceName` / `title` / `url`, and the video's `title`.
 *
 * These are not decoration — they are the difference between a budget and a
 * wish. Nothing upstream bounds them: the RAG tool truncates only a passage's
 * `text`, and admin truncates neither a video `title` nor a source label, so
 * without a cap here a single citation with long metadata can push a thread
 * past the consumer's byte cap. That failure is NOT a degraded render — the
 * capped read returns undefined, the proxy answers 502, replay lands in
 * `failed`, and R22 then blocks every send into that conversation: the thread
 * is permanently unreadable AND unusable. Truncating a label is strictly
 * better, and is the same replay-vs-live divergence already accepted for
 * snippets.
 */
export const AI_CHAT_HISTORY_ATTACHMENT_FIELD_CAP_CHARS = 128

/**
 * Bound on a source's `url`, which is NOT truncated — a cut URL still parses
 * as https and would render a live-looking link to a 404, the dead-caption-link
 * failure this arc already refused for videos. A source whose URL exceeds this
 * is DROPPED instead. Larger than the display cap because real citation URLs
 * are longer than their labels.
 */
export const AI_CHAT_HISTORY_SOURCE_URL_CAP_CHARS = 192

/** JSON envelope per emitted source object — keys, quotes, commas, braces.
 * Counted because the budget is compared against a SERIALIZED payload. */
export const AI_CHAT_HISTORY_SOURCE_ENVELOPE_BYTES = 128

/** Envelope + the video's pattern-bounded scalars (`videoId` ≤64, `slug` and
 * `languageSlug` ≤81, `playbackId` ≤64, `durationSeconds`) — all ASCII by
 * gate, so 1 B/unit. Its `title` is counted separately at the field cap. */
export const AI_CHAT_HISTORY_VIDEO_BYTES_ALLOWANCE = 512

/** JSON envelope per emitted message — `id`, `role`, `createdAt`, key names. */
export const AI_CHAT_HISTORY_MESSAGE_ENVELOPE_BYTES = 256

/**
 * ONE-message worst case for the feat-366 `followUps` wire field (KTD12):
 * 3 questions × 120 UTF-16 units × 3 B/unit, plus the JSON envelope (the
 * `"followUps":[…]` key, brackets, quotes, commas — ~23 B, allowed 64).
 *
 * ONE message, not 200: the wire is last-turn-only (KTD3 — only the thread's
 * final text-bearing assistant message carries the field), so this term adds
 * ~1.1 kB to the whole-thread budget instead of ~229 kB. The measured
 * maximal-thread test serializes maximal followUps on every stored assistant
 * message and asserts exactly one reaches the wire — that slice is what makes
 * this a one-message term.
 *
 * BUDGET RE-DERIVATION NOTE: any future per-message replay field must
 * re-derive `AI_CHAT_HISTORY_WORST_CASE_THREAD_BYTES` below — and re-measure
 * via the maximal-thread test — BEFORE it ships. Over-cap is not a degraded
 * render: it is 502 → replay `failed` → R22 blocks every send → the thread
 * becomes permanently unreadable and unusable. Never raise the consumer cap;
 * tighten the stored caps instead (first candidate: 2 × 80).
 */
export const AI_CHAT_HISTORY_FOLLOW_UPS_ONE_MESSAGE_BYTES =
  FOLLOW_UPS_MAX_QUESTIONS * FOLLOW_UPS_QUESTION_MAX_UNITS * 3 + 64

/**
 * The consumer's thread byte-cap, MIRRORED. `apps/chat`'s
 * `HISTORY_THREAD_MAX_RESPONSE_BYTES` is the real constant — apps cannot
 * cross-import, so this copy exists purely so the budget below is asserted
 * against something. Change both together; the byte-cap suite reads chat's
 * source file to catch a one-sided edit.
 */
export const CHAT_HISTORY_THREAD_BYTE_CAP = 8 * 1024 * 1024

/**
 * Worst-case bytes one fully-loaded replayed thread can occupy, at 3 UTF-8
 * bytes per UTF-16 code unit (the repo's worst-case sizing convention — a
 * 1 B/char reading undersizes ~3x and turns legitimate CJK/Devanagari threads
 * into false outages).
 *
 * 200 × (8,192×3 text + 5×((512+128+128+192)×3 + 128) sources +
 * (128×3 + 512) video + 256 envelope) = 8,153,600 B, under the 8,388,608 B
 * (8 MiB) consumer cap with ~230 kB of headroom.
 *
 * Every term corresponds to a bound the projection ENFORCES — that is the
 * property that makes this a budget rather than an assumption, and the
 * byte-cap suite additionally serializes a maximal payload and measures it, so
 * an uncounted field fails CI instead of shipping.
 *
 * Honest residual (pre-dates feat-329, unchanged by it): 3 B/unit is the UTF-8
 * worst case, not the JSON one — `JSON.stringify` expands control characters
 * and lone surrogates to 6 B/unit, so a pathological all-control-character
 * transcript can still exceed this. The per-message text cap that dominates
 * that case is feat-241's; bounding it is not this unit's change.
 */
// Measured (feat-366, 2026-08-18, maximal-thread test with maximal followUps
// on the final text-bearing message): 6,255,991 B serialized against the
// 8,388,608 B consumer cap — 2,132,617 B real headroom. The derived constant
// below stays the CLAIMED bound; the measurement is what catches an uncounted
// field.
export const AI_CHAT_HISTORY_WORST_CASE_THREAD_BYTES =
  AI_CHAT_HISTORY_REPLAY_MESSAGE_LIMIT *
    (AI_CHAT_HISTORY_TEXT_CAP_CHARS * 3 +
      AI_CHAT_HISTORY_MAX_SOURCES_PER_MESSAGE *
        ((AI_CHAT_HISTORY_SOURCE_SNIPPET_CAP_CHARS +
          AI_CHAT_HISTORY_ATTACHMENT_FIELD_CAP_CHARS * 2 +
          AI_CHAT_HISTORY_SOURCE_URL_CAP_CHARS) *
          3 +
          AI_CHAT_HISTORY_SOURCE_ENVELOPE_BYTES) +
      AI_CHAT_HISTORY_ATTACHMENT_FIELD_CAP_CHARS * 3 +
      AI_CHAT_HISTORY_VIDEO_BYTES_ALLOWANCE +
      AI_CHAT_HISTORY_MESSAGE_ENVELOPE_BYTES) +
  // feat-366 followUps: a whole-thread term, added ONCE (last-turn-only wire
  // — see the constant's docstring, incl. the budget re-derivation note).
  AI_CHAT_HISTORY_FOLLOW_UPS_ONE_MESSAGE_BYTES

/** Mirrors the chat proxy's MAX_CONVERSATION_ID_CHARS bound. */
const MAX_THREAD_ID_CHARS = 200

/**
 * The narrow Memory surface the history handlers need (KTD3) — structural so
 * tests fake it; the real instance from `getAiChatMemory()` satisfies it. The
 * same instance feeds `resolveOwnedExistingThread`, so ownership resolution
 * and the read path cannot diverge.
 */
export type AiChatHistoryMemory = {
  listThreads: (args: {
    filter?: { resourceId?: string }
    page?: number
    perPage?: number
    orderBy?: { field?: "createdAt" | "updatedAt"; direction?: "ASC" | "DESC" }
  }) => Promise<{
    threads: Array<{
      id: string
      title?: string | null
      updatedAt?: Date | string | null
    }>
    total: number
    page: number
    perPage: number | false
    hasMore: boolean
  }>
  getThreadById: (args: {
    threadId: string
  }) => Promise<{ resourceId?: string | null } | null>
  recall: (args: {
    threadId: string
    resourceId: string
    perPage: number
  }) => Promise<{ messages: unknown[] }>
}

/** Buffered-JSON route outcome (`{ status, body }` adapter — the repo's
 * standard non-streaming route shape; index.ts wraps it in a Response). */
export type AiChatHistoryRouteOutcome = { status: number; body: unknown }

/** One listed thread as projected onto the wire. `title` may be `""` — the
 * untitled sentinel the client turns into a date-derived fallback label. */
export type AiChatHistoryWireThread = {
  id: string
  title: string
  updatedAt: string
}

/**
 * One replayed turn as projected onto the wire (KTD5). Text plus, since
 * feat-329, the OPTIONAL attachments re-derived from the turn's stored tool
 * parts. Both are omitted (never null, never an empty array) on the turns that
 * have none — which is most of them.
 *
 * Deliberately NO `grounded`: R21 keeps engine/grounded badges off replayed
 * turns, and the sources DISCLOSURE needs only the list. Putting `grounded` on
 * this wire would ship the one field whose only consumer is the badge.
 */
export type AiChatHistoryWireMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  createdAt: string
  sources?: SeekerWireSource[]
  video?: SeekerWireVideo
  /**
   * Suggested follow-up questions (feat-366, KTD3) — present ONLY on the
   * thread's final text-bearing assistant message (older turns keep their
   * stored sets, off the wire; R3 never renders them). Omitted, never null
   * or empty. Re-validated through the shared projection on every read.
   */
  followUps?: string[]
}

/**
 * Shared handler input. Seams mirror the send route's: `getEnabled` (flag) and
 * `getServiceKeys` (lane CSV) forward to the admission module's defaults
 * (feat-283 — key sourcing lives there, so a registration cannot accidentally
 * wire the shared pool), plus `getMemory` and `budgetMs` (deterministically
 * testable timeout branch).
 */
export type AiChatHistoryHandlerInput = {
  authHeader: string | null | undefined
  readJson: () => Promise<unknown>
  getEnabled?: () => boolean
  getServiceKeys?: () => readonly string[]
  getMemory?: () => AiChatHistoryMemory
  budgetMs?: number
}

function jsonOutcome(status: number, body: unknown): AiChatHistoryRouteOutcome {
  return { status, body }
}

/** ISO-serialize a store timestamp; unparseable/absent degrades to "". */
function toIsoString(value: Date | string | null | undefined): string {
  if (value == null) return ""
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString()
}

type AiChatHistoryListBody = {
  resourceId: string
  page: number
  perPage: number
}

/**
 * Listing body guard: `resourceId` must be a string (an EMPTY string passes
 * here and is refused by the resource gate — 403, not 400); `page` an integer
 * ≥ 0; `perPage` a positive number, clamped to the ceiling.
 */
function parseListBody(value: unknown): AiChatHistoryListBody | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as { resourceId?: unknown; page?: unknown; perPage?: unknown }
  if (typeof v.resourceId !== "string") return null
  if (
    v.page !== undefined &&
    (typeof v.page !== "number" || !Number.isInteger(v.page) || v.page < 0)
  ) {
    return null
  }
  if (
    v.perPage !== undefined &&
    (typeof v.perPage !== "number" ||
      !Number.isFinite(v.perPage) ||
      v.perPage <= 0)
  ) {
    return null
  }
  const page = v.page === undefined ? 0 : v.page
  const perPage =
    v.perPage === undefined
      ? AI_CHAT_HISTORY_DEFAULT_PER_PAGE
      : Math.min(
          AI_CHAT_HISTORY_MAX_PER_PAGE,
          Math.max(1, Math.floor(v.perPage)),
        )
  return { resourceId: v.resourceId, page, perPage }
}

function parseReplayBody(
  value: unknown,
): { resourceId: string; threadId: string } | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as { resourceId?: unknown; threadId?: unknown }
  if (typeof v.resourceId !== "string") return null
  if (
    typeof v.threadId !== "string" ||
    v.threadId.length === 0 ||
    v.threadId.length > MAX_THREAD_ID_CHARS
  ) {
    return null
  }
  return { resourceId: v.resourceId, threadId: v.threadId }
}

/**
 * Project one listed thread onto the wire field-by-field — never spreads, so a
 * future store field cannot silently widen the wire. A stored `""` title
 * passes through verbatim (the client's untitled sentinel).
 */
function projectThreadRow(row: {
  id: string
  title?: string | null
  updatedAt?: Date | string | null
}): AiChatHistoryWireThread {
  return {
    id: row.id,
    title: typeof row.title === "string" ? row.title : "",
    updatedAt: toIsoString(row.updatedAt),
  }
}

/**
 * Project one stored message onto the wire (KTD5). Total: any shape mismatch
 * drops the message rather than throwing. Only `user`/`assistant` roles pass
 * (`system`/`signal` dropped); text is joined from `parts` of type `"text"`
 * only, capped per message. Provider metadata stays unrepresentable here.
 *
 * Tool-invocation parts are NOT projected by this function — but since
 * feat-329 they are no longer unrepresentable on the wire: `attachTurnAttachments`
 * folds their allowlisted `sources`/`video` onto the turn's text-bearing
 * message afterwards.
 */
function projectStoredMessage(
  candidate: unknown,
): AiChatHistoryWireMessage | null {
  if (typeof candidate !== "object" || candidate === null) return null
  const m = candidate as {
    id?: unknown
    role?: unknown
    createdAt?: unknown
    content?: unknown
  }
  if (typeof m.id !== "string" || m.id.length === 0) return null
  if (m.role !== "user" && m.role !== "assistant") return null
  const content = m.content as { parts?: unknown } | null | undefined
  const texts: string[] = []
  if (content && Array.isArray(content.parts)) {
    for (const part of content.parts) {
      if (typeof part !== "object" || part === null) continue
      const p = part as { type?: unknown; text?: unknown }
      if (
        p.type === "text" &&
        typeof p.text === "string" &&
        p.text.length > 0
      ) {
        texts.push(p.text)
      }
    }
  }
  const joined = texts.join("\n\n")
  return {
    id: m.id,
    role: m.role,
    text:
      joined.length > AI_CHAT_HISTORY_TEXT_CAP_CHARS
        ? joined.slice(0, AI_CHAT_HISTORY_TEXT_CAP_CHARS)
        : joined,
    createdAt: toIsoString(m.createdAt as Date | string | null | undefined),
  }
}

/**
 * The STORED role, read straight off the candidate — used for turn-boundary
 * detection so a message the projection REJECTS still closes its turn.
 * Boundary detection must not depend on projection succeeding: a rejected user
 * row would otherwise merge two turns and carry the earlier turn's attachments
 * onto the later turn's answer. Total: anything unexpected reads as null.
 *
 * For a row that DOES project the two roles agree by construction —
 * `projectStoredMessage` admits only `user`/`assistant` and emits `role`
 * verbatim — so this predicate is a strict superset of the projected one.
 */
function readStoredRole(candidate: unknown): string | null {
  if (typeof candidate !== "object" || candidate === null) return null
  const role = (candidate as { role?: unknown }).role
  return typeof role === "string" ? role : null
}

/**
 * Replay-path adapter (plan P8): normalize one stored message's
 * `tool-invocation` parts — `{ type: "tool-invocation", toolInvocation: {
 * toolName, result } }` — into the shared module's `{ toolName, result }`.
 *
 * That shape is a pinned dist fact (observed against @mastra/core 1.55.0 /
 * @mastra/memory 1.24.0, 2026-08-04) — the real-memory round trip in
 * `ai-chat-history-route.test.ts` is what re-verifies it on `@mastra/*` bumps.
 * Total: anything else in `parts` is ignored.
 */
function extractStoredToolChunks(candidate: unknown): SeekerToolChunk[] {
  if (typeof candidate !== "object" || candidate === null) return []
  const content = (candidate as { content?: unknown }).content as
    | { parts?: unknown }
    | null
    | undefined
  if (!content || !Array.isArray(content.parts)) return []

  const chunks: SeekerToolChunk[] = []
  for (const part of content.parts) {
    if (typeof part !== "object" || part === null) continue
    const p = part as { type?: unknown; toolInvocation?: unknown }
    if (p.type !== "tool-invocation") continue
    const invocation = p.toolInvocation as
      | { toolName?: unknown; result?: unknown }
      | null
      | undefined
    if (!invocation || typeof invocation.toolName !== "string") continue
    chunks.push({ toolName: invocation.toolName, result: invocation.result })
  }
  return chunks
}

/**
 * Replay-path adapter for stored follow-up questions (feat-366, KTD3):
 * synthesize ONE `suggestFollowUps` chunk from the stored message's
 * `content.metadata.seekerFollowUps` so `resolveTurnAttachments` resolves
 * sources, video, and followUps in one pass — the projection stays the single
 * re-validation point; this adapter validates NOTHING itself. Total: an
 * absent or junk-shaped metadata yields no chunk (the projection would drop
 * junk anyway; skipping the chunk keeps the pooled shape minimal).
 */
function extractStoredFollowUpsChunk(candidate: unknown): SeekerToolChunk[] {
  if (typeof candidate !== "object" || candidate === null) return []
  const content = (candidate as { content?: unknown }).content as
    | { metadata?: unknown }
    | null
    | undefined
  if (!content || typeof content.metadata !== "object") return []
  const stored = (content.metadata as Record<string, unknown> | null)?.[
    SEEKER_FOLLOW_UPS_METADATA_KEY
  ]
  if (stored === undefined) return []
  return [
    { toolName: SUGGEST_FOLLOW_UPS_TOOL_NAME, result: { questions: stored } },
  ]
}

/** Truncate to a UTF-16 unit cap. Total: a shorter string passes through. */
function cap(value: string, units: number): string {
  return value.length > units ? value.slice(0, units) : value
}

/**
 * Enforce the replay-only source bounds (see the constants above).
 * DETERMINISTIC: the first N sources in stored order, every variable-length
 * field cut to its cap — never a sample, never a "pick the best".
 *
 * EVERY variable-length field is bounded, not just `snippet`: an uncapped one
 * would leave the budget above unbounded, and an over-cap thread is
 * permanently unreadable, not merely truncated. Display strings TRUNCATE; the
 * `url` instead DROPS its whole source, because a cut URL is a dead link.
 * Over-long URLs are filtered BEFORE the ≤5 slice so a droppable source never
 * costs a good one its slot.
 */
function boundSources(sources: SeekerWireSource[]): SeekerWireSource[] {
  return sources
    .filter(
      (source) => source.url.length <= AI_CHAT_HISTORY_SOURCE_URL_CAP_CHARS,
    )
    .slice(0, AI_CHAT_HISTORY_MAX_SOURCES_PER_MESSAGE)
    .map((source) => ({
      sourceName: cap(
        source.sourceName,
        AI_CHAT_HISTORY_ATTACHMENT_FIELD_CAP_CHARS,
      ),
      title:
        source.title === null
          ? null
          : cap(source.title, AI_CHAT_HISTORY_ATTACHMENT_FIELD_CAP_CHARS),
      url: source.url,
      score: source.score,
      snippet: cap(source.snippet, AI_CHAT_HISTORY_SOURCE_SNIPPET_CAP_CHARS),
    }))
}

/** Bound the one unbounded field on a projected video. Its other fields are
 * already pattern-gated to ≤81 ASCII units by the shared D9 gates. */
function boundVideo(video: SeekerWireVideo): SeekerWireVideo {
  return video.title.length > AI_CHAT_HISTORY_ATTACHMENT_FIELD_CAP_CHARS
    ? {
        ...video,
        title: cap(video.title, AI_CHAT_HISTORY_ATTACHMENT_FIELD_CAP_CHARS),
      }
    : video
}

/**
 * Attach each turn's re-derived video/sources to the message that will render
 * them (feat-329, plan U4).
 *
 * TURN ASSOCIATION is the whole point: the store may split one turn's tool
 * parts onto their own tool-only assistant message (no text), and the chat
 * client drops empty-text messages for exactly that reason — so attaching
 * per-message would silently drop the attachment on precisely the turns that
 * have one. A turn is therefore the run of assistant rows since the last
 * NON-assistant row; its chunks are pooled and attached to the run's LAST
 * text-bearing assistant message. A turn with no text-bearing message has
 * nothing the user sees, so its attachments are dropped.
 *
 * Mutates nothing: returns a new array, with new objects only where an
 * attachment lands (so the no-attachment case keeps its exact 4-field shape).
 */
function attachTurnAttachments(
  entries: readonly {
    message: AiChatHistoryWireMessage | null
    chunks: SeekerToolChunk[]
    storedRole: string | null
  }[],
): AiChatHistoryWireMessage[] {
  const out = entries.map((entry) => entry.message)

  let runStart = 0
  const closeRun = (endExclusive: number): void => {
    const chunks: SeekerToolChunk[] = []
    let lastTextIndex = -1
    for (let i = runStart; i < endExclusive; i += 1) {
      const entry = entries[i]
      // An ASSISTANT row the projection rejected (missing/empty id) still
      // contributes its tool chunks: dropping them with the unrenderable
      // carrier would silently lose the whole turn's attachments. Rows of any
      // other stored role never reach here — they close the run above, so their
      // chunks are donated to no turn.
      if (entry.message === null) {
        chunks.push(...entry.chunks)
        continue
      }
      if (entry.message.role !== "assistant") continue
      chunks.push(...entry.chunks)
      if (entry.message.text.trim().length > 0) lastTextIndex = i
    }
    if (chunks.length === 0 || lastTextIndex < 0) return
    // lastTextIndex only ever points at a surviving assistant message.
    const carrier = out[lastTextIndex]
    if (carrier === null) return

    const attachments = resolveTurnAttachments(chunks)
    const sources = boundSources(attachments.sources)
    const video = attachments.video ? boundVideo(attachments.video) : undefined
    const followUps = attachments.followUps
    // Omitted, never empty/null — the wire shape stays minimal on the turns
    // that carry nothing, which is most of them. followUps attach per-turn
    // here; the LAST-TURN-ONLY wire slice below then strips every set except
    // the thread's final text-bearing assistant message's (KTD3).
    if (sources.length === 0 && !video && followUps.length === 0) return
    out[lastTextIndex] = {
      ...carrier,
      ...(sources.length > 0 ? { sources } : {}),
      ...(video ? { video } : {}),
      ...(followUps.length > 0 ? { followUps } : {}),
    }
  }

  // A run CONTINUES only across stored-ASSISTANT rows; every other row closes
  // it. Two reasons this is an "is assistant" test rather than an "is user"
  // one. First, it must read the STORED role: a row the projection rejected is
  // `null` here, and trusting the projection would fail to close the turn.
  // Second, closing only on `"user"` allowlists one literal out of a role space
  // that also holds system/signal/tool — plus rows whose role is corrupt,
  // absent, or non-string — and EVERY other value silently merged two turns,
  // moving the earlier turn's video and citations onto the later turn's answer.
  // Closing on "not assistant" fails in the safe direction: a turn that loses
  // its carrier drops its attachment rather than misattributing it, matching
  // the no-text-bearing-message rule above.
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].storedRole !== "assistant") {
      closeRun(i)
      runStart = i + 1
    }
  }
  closeRun(entries.length)

  const projected = out.filter(
    (message): message is AiChatHistoryWireMessage => message !== null,
  )

  // LAST-TURN-ONLY wire slice for followUps (feat-366, KTD3): a
  // post-projection pass, so `resolveTurnAttachments` stays the single
  // re-validation point. Only the thread's FINAL text-bearing assistant
  // message may carry the field — R3 never renders older turns' chips, so
  // putting their sets on the wire would spend budget on payload nothing
  // reads (the byte budget's followUps term is ONE message because of this
  // slice). Older turns' stored sets stay stored (KTD2 untouched).
  let finalTextBearingIndex = -1
  for (let i = projected.length - 1; i >= 0; i -= 1) {
    const candidate = projected[i]
    if (candidate.role === "assistant" && candidate.text.trim().length > 0) {
      finalTextBearingIndex = i
      break
    }
  }
  return projected.map((message, index) => {
    if (message.followUps === undefined || index === finalTextBearingIndex) {
      return message
    }
    const rest = { ...message }
    delete rest.followUps
    return rest
  })
}

/**
 * `POST /forge-ai-chat-history-list` core (R1/R2/R4/R11): paginated listing of
 * the caller's own `user:*` threads, most-recently-active first. Returns the
 * `{ status, body }` outcome; success body is
 * `{ threads: [{ id, title, updatedAt }], page, perPage, total, hasMore }`.
 */
export async function handleAiChatHistoryListRequest({
  authHeader,
  readJson,
  getEnabled,
  getServiceKeys,
  getMemory = () => getAiChatMemory(),
  budgetMs = TIME_BUDGET_MS.historyRead,
}: AiChatHistoryHandlerInput): Promise<AiChatHistoryRouteOutcome> {
  const refusal = refuseUnlessLaneAdmitted({
    authHeader,
    getEnabled,
    getServiceKeys,
  })
  if (refusal) return refusal

  const raw = await readJson().catch(() => undefined)
  const body = parseListBody(raw)
  if (!body) return jsonOutcome(400, { reason: "invalid_body" })

  // R2: only signed-in resources are listable — the shared dogfood fallback,
  // anon:* ids, and anything else un-prefixed are refused before any store I/O.
  if (!body.resourceId.startsWith(USER_RESOURCE_PREFIX)) {
    console.warn(
      "[ai-chat-history] event=resource_rejected surface=list reason=resource_forbidden",
    )
    return jsonOutcome(403, { reason: "resource_forbidden" })
  }

  const budgetSignal = AbortSignal.timeout(budgetMs)
  try {
    const result = await settleWithinBudget(
      getMemory().listThreads({
        filter: { resourceId: body.resourceId },
        // Explicit: the dist default is createdAt DESC; the sidebar contract
        // is most-recently-ACTIVE first (saveMessages bumps updatedAt).
        orderBy: { field: "updatedAt", direction: "DESC" },
        page: body.page,
        perPage: body.perPage,
      }),
      budgetSignal,
    )
    return jsonOutcome(200, {
      threads: result.threads.map(projectThreadRow),
      page: result.page,
      perPage: result.perPage,
      total: result.total,
      hasMore: result.hasMore,
    })
  } catch {
    // Fixed-vocabulary reason only — no exception text on the wire or in logs.
    const reason = budgetSignal.aborted ? "timeout" : "store_failed"
    console.warn(`[ai-chat-history] event=list_failed reason=${reason}`)
    return jsonOutcome(reason === "timeout" ? 504 : 500, { reason })
  }
}

/**
 * `POST /forge-ai-chat-history-replay` core (R2/R3/R4/R21): the projected
 * transcript of ONE owned thread. Owned-existing-thread resolver → capped
 * recall (KTD4); success body is `{ messages: [...] }`. A vanished thread is
 * an explicit `thread_not_found`, never an empty-transcript success; a store
 * failure after admission is a generic failure, never `thread_not_found`
 * (fail closed).
 */
export async function handleAiChatHistoryReplayRequest({
  authHeader,
  readJson,
  getEnabled,
  getServiceKeys,
  getMemory = () => getAiChatMemory(),
  budgetMs = TIME_BUDGET_MS.historyRead,
}: AiChatHistoryHandlerInput): Promise<AiChatHistoryRouteOutcome> {
  const refusal = refuseUnlessLaneAdmitted({
    authHeader,
    getEnabled,
    getServiceKeys,
  })
  if (refusal) return refusal

  const raw = await readJson().catch(() => undefined)
  const body = parseReplayBody(raw)
  if (!body) return jsonOutcome(400, { reason: "invalid_body" })

  if (!body.resourceId.startsWith(USER_RESOURCE_PREFIX)) {
    console.warn(
      "[ai-chat-history] event=resource_rejected surface=replay reason=resource_forbidden",
    )
    return jsonOutcome(403, { reason: "resource_forbidden" })
  }

  const budgetSignal = AbortSignal.timeout(budgetMs)
  try {
    // Inside the try (matching the list handler): a sync memory-construction
    // throw must map to store_failed, never escape the closed outcome shape.
    const memory = getMemory()
    const resolution = await settleWithinBudget(
      resolveOwnedExistingThread({
        memory,
        threadId: body.threadId,
        resource: body.resourceId,
      }),
      budgetSignal,
    )
    if (!resolution.ok) {
      console.warn(
        `[ai-chat-history] event=thread_access_rejected reason=${resolution.reason}`,
      )
      return jsonOutcome(resolution.reason === "thread_forbidden" ? 403 : 404, {
        reason: resolution.reason,
      })
    }

    // `resourceId` is ALWAYS passed — omitting it disables the store's own
    // ownership throw (the belt-and-suspenders layer under the resolver above).
    const result = await settleWithinBudget(
      memory.recall({
        threadId: body.threadId,
        resourceId: body.resourceId,
        perPage: AI_CHAT_HISTORY_REPLAY_MESSAGE_LIMIT,
      }),
      budgetSignal,
    )
    // Project first, then attach per TURN (feat-329): the tool chunks travel
    // beside their message so a tool-only step's parts can still reach the
    // text-bearing message the client actually renders. A REJECTED message
    // stays as `null` so its chunks survive; the attach pass drops it.
    const entries = result.messages.map((candidate) => ({
      message: projectStoredMessage(candidate),
      // Stored tool parts plus the synthetic follow-ups chunk (feat-366) pool
      // into one turn so the shared projection resolves everything at once.
      chunks: [
        ...extractStoredToolChunks(candidate),
        ...extractStoredFollowUpsChunk(candidate),
      ],
      storedRole: readStoredRole(candidate),
    }))
    return jsonOutcome(200, { messages: attachTurnAttachments(entries) })
  } catch {
    // Fail CLOSED: a store outage (including the resolver's getThreadById
    // throw) is a generic failure — never thread_not_found, never exception
    // text.
    const reason = budgetSignal.aborted ? "timeout" : "store_failed"
    console.warn(`[ai-chat-history] event=replay_failed reason=${reason}`)
    return jsonOutcome(reason === "timeout" ? 504 : 500, { reason })
  }
}
