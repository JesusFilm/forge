// Account-owned learning progress (feat-731, KTD8–KTD9).
//
// Every function takes the Auth subject from the caller's verified principal;
// nothing here accepts it from request input. Ids are checked against the
// code-owned course allowlist before any SQL runs, so a rejected write never
// partially lands.
//
// Raw SQL on purpose: a save is a compare-and-set on `revision`, and the
// account-deletion fence needs a per-subject advisory lock shared by saves,
// resets and erasure. Holding that lock is what stops a request that was
// already in flight when the account was deleted from re-creating a row after
// the erasure committed: the write either finishes before the erasure takes
// the lock (and is deleted by it), or runs after and finds the fence row.

import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"

import { prisma } from "@/db/client"
import { toPgArray } from "@/db/pgvector"
import {
  WATCH_LEARNING_MOVEMENT_IDS,
  findWatchLearningLesson,
  isKnownWatchLearningCourseVersion,
} from "@/services/watch-learning-course"

/** Client input naming something the course allowlist does not know. */
export class WatchLearningValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WatchLearningValidationError"
  }
}

/** An account erasure attempt fenced this subject; deletion may have aborted. */
export class WatchLearningSubjectErasedError extends Error {
  constructor() {
    super("Learning progress is unavailable after an account erasure attempt")
    this.name = "WatchLearningSubjectErasedError"
  }
}

type Db = Prisma.TransactionClient

export type WatchLearningLessonKey = {
  courseId: string
  contentVersion: string
  lessonId: string
}

export type WatchLearningProgressState = {
  completedMovementIds: string[]
  completedStepIds: string[]
  /** Explicit completion only — never inferred from steps or position. */
  completed: boolean
  resumeCardId: string | null
}

export type WatchLearningProgressView = WatchLearningLessonKey &
  WatchLearningProgressState & {
    completedAt: string | null
    /** 0 means no stored row. */
    revision: number
    updatedAt: string | null
  }

export type WatchLearningSaveInput = WatchLearningLessonKey &
  WatchLearningProgressState & {
    userId: string
    /** The revision the client last read; 0 when it read no row. */
    expectedRevision: number
  }

export type WatchLearningSaveResult = {
  status: "SAVED" | "CONFLICT"
  /** The stored state after the call: the new row, or the one that won. */
  progress: WatchLearningProgressView
}

type ProgressRow = {
  course_id: string
  content_version: string
  lesson_id: string
  completed_movement_ids: string[]
  completed_step_ids: string[]
  completed_at: Date | null
  resume_card_id: string | null
  revision: number
  updated_at: Date
}

const RETURNING = Prisma.sql`course_id, content_version, lesson_id,
  completed_movement_ids, completed_step_ids, completed_at, resume_card_id,
  revision, updated_at`

// The columns are TIMESTAMP(3) holding UTC wall-clock (what Prisma writes);
// parsing as timestamptz first keeps the write independent of session TimeZone.
function utc(date: Date) {
  return Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`
}

function textArray(ids: readonly string[]) {
  return Prisma.sql`${toPgArray(ids)}::text[]`
}

function toView(row: ProgressRow): WatchLearningProgressView {
  return {
    courseId: row.course_id,
    contentVersion: row.content_version,
    lessonId: row.lesson_id,
    completedMovementIds: row.completed_movement_ids,
    completedStepIds: row.completed_step_ids,
    completed: row.completed_at !== null,
    completedAt: row.completed_at?.toISOString() ?? null,
    resumeCardId: row.resume_card_id,
    revision: row.revision,
    updatedAt: row.updated_at.toISOString(),
  }
}

function emptyView(key: WatchLearningLessonKey): WatchLearningProgressView {
  return {
    ...key,
    completedMovementIds: [],
    completedStepIds: [],
    completed: false,
    completedAt: null,
    resumeCardId: null,
    revision: 0,
    updatedAt: null,
  }
}

/**
 * Bounded, allowlisted, canonical-order copy of the state. Arrays longer
 * than the lesson's own id list are rejected outright rather than deduped,
 * so the payload size stays bounded by the course definition.
 */
export function normalizeWatchLearningState(
  key: WatchLearningLessonKey,
  state: WatchLearningProgressState,
): WatchLearningProgressState {
  const lesson = findWatchLearningLesson(
    key.courseId,
    key.contentVersion,
    key.lessonId,
  )
  if (!lesson) throw new WatchLearningValidationError("Unknown lesson")

  return {
    completedMovementIds: canonicalIds(
      state.completedMovementIds,
      WATCH_LEARNING_MOVEMENT_IDS,
      "movement",
    ),
    completedStepIds: canonicalIds(
      state.completedStepIds,
      lesson.stepIds,
      "step",
    ),
    completed: state.completed === true,
    resumeCardId:
      state.resumeCardId == null
        ? null
        : canonicalIds([state.resumeCardId], lesson.cardIds, "card")[0],
  }
}

function canonicalIds(
  ids: readonly string[],
  known: readonly string[],
  label: string,
): string[] {
  if (ids.length > known.length) {
    throw new WatchLearningValidationError(`Too many ${label} ids`)
  }
  const requested = new Set(ids)
  for (const id of requested) {
    if (!known.includes(id)) {
      throw new WatchLearningValidationError(`Unknown ${label} id`)
    }
  }
  return known.filter((id) => requested.has(id))
}

function requireSubject(userId: string) {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new WatchLearningValidationError("Missing subject")
  }
}

export function watchLearningSubjectHash(userId: string): string {
  return createHash("sha256").update(userId).digest("hex")
}

async function lockSubject(db: Db, userId: string) {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`watch-learning:${userId}`}, 0))::text`
}

async function assertSubjectNotErased(db: Db, userId: string) {
  const fence = await db.$queryRaw<Array<{ erased: number }>>`
    SELECT 1 AS erased FROM watch_learning_erasures
    WHERE subject_hash = ${watchLearningSubjectHash(userId)}
    LIMIT 1`
  if (fence.length > 0) throw new WatchLearningSubjectErasedError()
}

async function readRow(
  db: Db,
  userId: string,
  key: WatchLearningLessonKey,
): Promise<ProgressRow | null> {
  const rows = await db.$queryRaw<ProgressRow[]>`
    SELECT ${RETURNING} FROM watch_learning_progress
    WHERE user_id = ${userId} AND course_id = ${key.courseId}
      AND content_version = ${key.contentVersion}
      AND lesson_id = ${key.lessonId}`
  return rows[0] ?? null
}

export async function listWatchLearningProgress({
  userId,
  courseId,
  contentVersion,
}: {
  userId: string
  courseId: string
  contentVersion: string
}): Promise<WatchLearningProgressView[]> {
  requireSubject(userId)
  if (!isKnownWatchLearningCourseVersion(courseId, contentVersion)) {
    throw new WatchLearningValidationError("Unknown course version")
  }
  const rows = await prisma.$queryRaw<ProgressRow[]>`
    SELECT ${RETURNING} FROM watch_learning_progress
    WHERE user_id = ${userId} AND course_id = ${courseId}
      AND content_version = ${contentVersion}
    ORDER BY lesson_id`
  return rows.map(toView)
}

export async function saveWatchLearningProgress(
  input: WatchLearningSaveInput,
): Promise<WatchLearningSaveResult> {
  requireSubject(input.userId)
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  ) {
    throw new WatchLearningValidationError("Invalid expected revision")
  }
  const key: WatchLearningLessonKey = {
    courseId: input.courseId,
    contentVersion: input.contentVersion,
    lessonId: input.lessonId,
  }
  const state = normalizeWatchLearningState(key, input)
  const { userId, expectedRevision } = input

  return prisma.$transaction(async (tx) => {
    await lockSubject(tx, userId)
    await assertSubjectNotErased(tx, userId)

    const now = utc(new Date())
    const written =
      expectedRevision === 0
        ? await tx.$queryRaw<ProgressRow[]>`
            INSERT INTO watch_learning_progress (
              id, user_id, course_id, content_version, lesson_id,
              completed_movement_ids, completed_step_ids, completed_at,
              resume_card_id, revision, created_at, updated_at
            ) VALUES (
              gen_random_uuid()::text, ${userId}, ${key.courseId},
              ${key.contentVersion}, ${key.lessonId},
              ${textArray(state.completedMovementIds)},
              ${textArray(state.completedStepIds)},
              CASE WHEN ${state.completed} THEN ${now} ELSE NULL END,
              ${state.resumeCardId}, 1, ${now}, ${now}
            )
            ON CONFLICT (user_id, course_id, content_version, lesson_id)
              DO NOTHING
            RETURNING ${RETURNING}`
        : await tx.$queryRaw<ProgressRow[]>`
            UPDATE watch_learning_progress SET
              completed_movement_ids = ${textArray(state.completedMovementIds)},
              completed_step_ids = ${textArray(state.completedStepIds)},
              -- Keep the first completion time across later saves.
              completed_at = CASE WHEN ${state.completed}
                THEN COALESCE(completed_at, ${now}) ELSE NULL END,
              resume_card_id = ${state.resumeCardId},
              revision = revision + 1,
              updated_at = ${now}
            WHERE user_id = ${userId} AND course_id = ${key.courseId}
              AND content_version = ${key.contentVersion}
              AND lesson_id = ${key.lessonId}
              AND revision = ${expectedRevision}
            RETURNING ${RETURNING}`

    if (written[0]) return { status: "SAVED", progress: toView(written[0]) }

    const current = await readRow(tx, userId, key)
    return {
      status: "CONFLICT",
      progress: current ? toView(current) : emptyView(key),
    }
  })
}

/**
 * Clears a lesson but keeps its row and bumps the revision, so a write still
 * carrying the pre-reset revision conflicts instead of restoring old state.
 * Guarded by the same expected revision as a save: a reset issued against a
 * stale read conflicts rather than erasing progress another device saved
 * since. It only ever touches the one (course, version, lesson) row named.
 */
export async function resetWatchLearningProgress(
  input: WatchLearningLessonKey & { userId: string; expectedRevision: number },
): Promise<WatchLearningSaveResult> {
  return saveWatchLearningProgress({
    ...input,
    completedMovementIds: [],
    completedStepIds: [],
    completed: false,
    resumeCardId: null,
  })
}

/**
 * Account-deletion erasure. Runs inside the caller's transaction so it
 * commits or rolls back with the rest of the account's watch data, and
 * records the fence row that refuses any later write for this subject.
 */
export async function eraseWatchLearningProgressForSubject(
  tx: Db,
  userId: string,
): Promise<{ deletedCount: number }> {
  requireSubject(userId)
  await lockSubject(tx, userId)
  await tx.$executeRaw`
    INSERT INTO watch_learning_erasures (subject_hash, erased_at)
    VALUES (${watchLearningSubjectHash(userId)}, ${utc(new Date())})
    ON CONFLICT (subject_hash) DO NOTHING`
  const deletedCount = await tx.$executeRaw`
    DELETE FROM watch_learning_progress WHERE user_id = ${userId}`
  return { deletedCount }
}
