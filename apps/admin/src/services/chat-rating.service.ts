/**
 * Chat-rating service — the boundary between the REST routes and
 * Mastra's scores storage for 👍/👎 ratings on workflow-generated
 * assistant messages in the experience-editor AI chat panel.
 *
 * Contract:
 *
 *   submitRating({ messageId, score, comment }, deps) → RatingState
 *   clearRating({ messageId }, deps)                  → RatingState (cleared)
 *   listRatingsForThread({ threadId }, deps)          → Record<messageId, RatingState | null>
 *
 * All three paths:
 * 1. Load the ExperienceChatMessage (and its locale/experience for ABAC).
 * 2. Verify `producedBy` is in `RATABLE_PRODUCERS`.
 * 3. ABAC-check the principal via `canEditExperienceLocale`.
 * 4. Write/read via Mastra's `scores` storage domain.
 *
 * Mutability is **append-and-latest-wins**: every click writes a new
 * `mastra.scores` row. The "current rating" for a `(messageId, userId)`
 * pair is the latest row by `createdAt`. Clearing writes a record with
 * `metadata.cleared: true` — the read path treats `cleared === true`
 * as "no current rating" and returns the cleared state.
 *
 * Failure modes are typed:
 *   - MessageNotFoundError    — 404 at the REST layer
 *   - NotRatableError         — 422 (producedBy outside ratable set / null)
 *   - ForbiddenError          — 403 (principal lacks canEditExperienceLocale)
 *   - CommentTooLongError     — 400
 *   - ScoresStoreUnavailable  — 500 (Mastra getStorage() returned undefined)
 *
 * Error classes follow the typed-discriminator-not-regex discipline
 * captured in
 * `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md`
 * — never match on `err.message`.
 */

import type { Mastra } from "@mastra/core"
import type { PrismaClient } from "@prisma/client"

import type { Principal } from "@/auth/principal"
import { canEditExperienceLocale } from "@/auth/permissions"
import {
  CHAT_RATING_ENTITY_KIND,
  CHAT_THUMB_RATING_SCORER_ID,
  chatThumbRatingScorerDescriptor,
  type ChatRatingScore,
} from "@/mastra/scorers/chat-thumb-rating"
import {
  CHAT_RATING_COMMENT_MAX_LENGTH,
  RATABLE_PRODUCERS,
  isRatableProducer,
} from "./chat-rating.constants"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Current rating state for one (message, user) pair. `null` means
 * "no rating" (either never rated, or the latest record is a clear).
 */
export type RatingState = {
  score: ChatRatingScore
  comment: string | null
  updatedAt: string
}

export type SubmitRatingInput = {
  messageId: string
  score: ChatRatingScore
  comment?: string | null
}

export type ClearRatingInput = {
  messageId: string
}

export type ListRatingsForThreadInput = {
  threadId: string
}

export type ChatRatingDeps = {
  prisma: Pick<PrismaClient, "experienceChatMessage" | "experienceChatThread">
  mastra: Mastra
  principal: Principal
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class MessageNotFoundError extends Error {
  readonly name = "MessageNotFoundError"
  constructor(readonly messageId: string) {
    super(`Chat message not found: ${messageId}`)
  }
}

export class NotRatableError extends Error {
  readonly name = "NotRatableError"
  constructor(
    readonly messageId: string,
    readonly producedBy: string | null,
  ) {
    super(
      `Chat message ${messageId} is not ratable (producedBy=${producedBy ?? "null"})`,
    )
  }
}

export class ForbiddenError extends Error {
  readonly name = "ForbiddenError"
  constructor(message = "Forbidden") {
    super(message)
  }
}

export class CommentTooLongError extends Error {
  readonly name = "CommentTooLongError"
  constructor(readonly length: number) {
    super(
      `Comment exceeds ${CHAT_RATING_COMMENT_MAX_LENGTH}-char cap (got ${length})`,
    )
  }
}

export class ScoresStoreUnavailableError extends Error {
  readonly name = "ScoresStoreUnavailableError"
  constructor() {
    super("Mastra scores storage is unavailable")
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type ResolvedMessage = {
  id: string
  producedBy: string
  threadId: string
  localeForAuth: { status: "DRAFT" | "PUBLISHED" | "ARCHIVED" } & {
    experience: { ownerId: string | null; archivedAt: Date | null }
  }
}

function requireAuthenticatedRater(
  principal: ChatRatingDeps["principal"],
): string {
  if (principal.id === null) {
    // The route layer requires resolvePrincipalFromRequest to return
    // an authenticated principal before reaching this service. A null
    // id here would mean a SYSTEM/PUBLIC tier reached us — refuse
    // rather than write a score with raterUserId=null.
    throw new ForbiddenError("Anonymous principals cannot rate")
  }
  return principal.id
}

async function resolveMessageForRating(
  messageId: string,
  deps: ChatRatingDeps,
): Promise<ResolvedMessage> {
  const message = await deps.prisma.experienceChatMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      producedBy: true,
      threadId: true,
      thread: {
        select: {
          experienceLocale: {
            select: {
              status: true,
              experience: {
                select: { ownerId: true, archivedAt: true },
              },
            },
          },
        },
      },
    },
  })
  if (!message) throw new MessageNotFoundError(messageId)
  if (!isRatableProducer(message.producedBy)) {
    throw new NotRatableError(messageId, message.producedBy)
  }
  if (
    !canEditExperienceLocale(deps.principal, message.thread.experienceLocale)
  ) {
    throw new ForbiddenError()
  }
  return {
    id: message.id,
    producedBy: message.producedBy as string,
    threadId: message.threadId,
    localeForAuth: message.thread.experienceLocale,
  }
}

async function getScoresStore(mastra: Mastra) {
  const storage = mastra.getStorage()
  if (!storage) throw new ScoresStoreUnavailableError()
  const scores = await storage.getStore("scores")
  if (!scores) throw new ScoresStoreUnavailableError()
  return scores
}

function normalizeComment(comment: string | null | undefined): string | null {
  if (comment === null || comment === undefined) return null
  const trimmed = comment.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > CHAT_RATING_COMMENT_MAX_LENGTH) {
    throw new CommentTooLongError(trimmed.length)
  }
  return trimmed
}

type ScoreRecord = {
  createdAt: Date | string
  score: number
  metadata?: unknown
}

function pickLatestForRater(
  rows: ReadonlyArray<ScoreRecord>,
  raterUserId: string,
): ScoreRecord | null {
  const matching = rows.filter((row) => {
    const md = row.metadata as { raterUserId?: string } | undefined
    return md?.raterUserId === raterUserId
  })
  if (matching.length === 0) return null
  // Descending sort by createdAt; latest wins. Stable for ties.
  return matching
    .slice()
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0]!
}

function resolveRatingState(latest: ScoreRecord | null): RatingState | null {
  if (latest === null) return null
  const md = latest.metadata as
    | { cleared?: boolean; comment?: string | null }
    | undefined
  if (md?.cleared === true) return null
  const rawScore = latest.score
  if (rawScore !== 0 && rawScore !== 1) {
    // Defensive: unexpected score value — treat as no rating.
    return null
  }
  return {
    score: rawScore as ChatRatingScore,
    comment: md?.comment ?? null,
    updatedAt: new Date(latest.createdAt).toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function submitRating(
  input: SubmitRatingInput,
  deps: ChatRatingDeps,
): Promise<RatingState | null> {
  const raterUserId = requireAuthenticatedRater(deps.principal)
  const comment = normalizeComment(input.comment)
  const message = await resolveMessageForRating(input.messageId, deps)
  const scores = await getScoresStore(deps.mastra)

  await scores.saveScore({
    scorerId: CHAT_THUMB_RATING_SCORER_ID,
    scorer: { ...chatThumbRatingScorerDescriptor },
    source: "LIVE",
    // No Mastra workflow runId is surfaced through the chat-message
    // row in v1; use the messageId as a synthetic so Mastra's
    // schema-required `runId: string` field stays populated. Studio's
    // run-pivot loses one click of navigation; the entityId pivot
    // still works.
    runId: message.id,
    entityId: message.id,
    entity: { messageId: message.id, producedBy: message.producedBy },
    score: input.score,
    output: { messageId: message.id },
    metadata: {
      raterUserId,
      comment,
      producedBy: message.producedBy,
      entityKind: CHAT_RATING_ENTITY_KIND,
      cleared: false,
    },
  })

  return readState(message.id, deps)
}

export async function clearRating(
  input: ClearRatingInput,
  deps: ChatRatingDeps,
): Promise<RatingState | null> {
  const raterUserId = requireAuthenticatedRater(deps.principal)
  const message = await resolveMessageForRating(input.messageId, deps)
  const scores = await getScoresStore(deps.mastra)

  await scores.saveScore({
    scorerId: CHAT_THUMB_RATING_SCORER_ID,
    scorer: { ...chatThumbRatingScorerDescriptor },
    source: "LIVE",
    runId: message.id,
    entityId: message.id,
    entity: { messageId: message.id, producedBy: message.producedBy },
    // Mastra's saveScorePayloadSchema requires `score: number`. The
    // sentinel for "cleared" is metadata.cleared — see the scorer
    // module's contract doc.
    score: 0,
    output: { messageId: message.id },
    metadata: {
      raterUserId,
      comment: null,
      producedBy: message.producedBy,
      entityKind: CHAT_RATING_ENTITY_KIND,
      cleared: true,
    },
  })

  return readState(message.id, deps)
}

/**
 * Internal: read the latest rating state for the active principal
 * against one message. Used after writes to return a consistent
 * post-save state.
 */
async function readState(
  messageId: string,
  deps: ChatRatingDeps,
): Promise<RatingState | null> {
  const scores = await getScoresStore(deps.mastra)
  const result = await scores.listScoresByScorerId({
    scorerId: CHAT_THUMB_RATING_SCORER_ID,
    entityId: messageId,
    pagination: { page: 0, perPage: 100 },
  })
  return resolveRatingState(
    pickLatestForRater(
      result.scores,
      requireAuthenticatedRater(deps.principal),
    ),
  )
}

export async function listRatingsForThread(
  input: ListRatingsForThreadInput,
  deps: ChatRatingDeps,
): Promise<Record<string, RatingState>> {
  // Thread-level ABAC: confirm the principal can edit any message in
  // this thread by loading the locale once via the thread row. The
  // per-message resolveMessageForRating check is redundant for the
  // listing path (every message in the same thread shares a locale),
  // so we hoist the check.
  const thread = await deps.prisma.experienceChatThread.findUnique({
    where: { id: input.threadId },
    select: {
      experienceLocale: {
        select: {
          status: true,
          experience: { select: { ownerId: true, archivedAt: true } },
        },
      },
    },
  })
  if (!thread) return {}
  if (!canEditExperienceLocale(deps.principal, thread.experienceLocale)) {
    throw new ForbiddenError()
  }

  const messages = await deps.prisma.experienceChatMessage.findMany({
    where: { threadId: input.threadId, producedBy: { not: null } },
    select: { id: true, producedBy: true },
  })
  const ratableMessageIds = messages
    .filter((m) => isRatableProducer(m.producedBy))
    .map((m) => m.id)

  if (ratableMessageIds.length === 0) return {}

  const scores = await getScoresStore(deps.mastra)
  // One round-trip per ratable message. Threads are bounded (~10s of
  // ratable messages tops); a single listScoresByScorerId with
  // entityId filter is the cleanest API and Mastra storage is local
  // to the same Postgres.
  const states: Record<string, RatingState> = {}
  await Promise.all(
    ratableMessageIds.map(async (messageId) => {
      const result = await scores.listScoresByScorerId({
        scorerId: CHAT_THUMB_RATING_SCORER_ID,
        entityId: messageId,
        pagination: { page: 0, perPage: 100 },
      })
      const state = resolveRatingState(
        pickLatestForRater(
          result.scores,
          requireAuthenticatedRater(deps.principal),
        ),
      )
      if (state !== null) states[messageId] = state
    }),
  )
  return states
}

// Re-exports so callers don't reach into chat-rating.constants:
export { RATABLE_PRODUCERS, isRatableProducer, CHAT_RATING_COMMENT_MAX_LENGTH }
