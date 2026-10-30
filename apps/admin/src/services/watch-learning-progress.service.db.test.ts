// Real-PostgreSQL contract for account learning progress (feat-731).
//
//   WATCH_LEARNING_PROGRESS_DB_TEST=1 DATABASE_URL=<disposable admin db> \
//     pnpm --filter @forge/admin exec vitest run \
//     src/services/watch-learning-progress.service.db.test.ts
//
// Needs the watch_learning_progress / watch_learning_erasures migration.
// Concurrency cases need committed rows on separate connections, so they
// cannot run inside one rolled-back transaction; every case uses fresh random
// subjects and afterAll deletes exactly those subjects' rows and fence rows.
// Mocked suites prove branch shape; this one proves the compare-and-set,
// ON CONFLICT, advisory lock, and deletion fence against the real engine.

import { randomUUID } from "node:crypto"
import { afterAll, describe, expect, it } from "vitest"

import { prisma } from "@/db/client"
import {
  WatchLearningSubjectErasedError,
  WatchLearningValidationError,
  eraseWatchLearningProgressForSubject,
  listWatchLearningProgress,
  resetWatchLearningProgress,
  saveWatchLearningProgress,
  watchLearningSubjectHash,
  type WatchLearningSaveInput,
} from "./watch-learning-progress.service"

const RUN_REAL_DB_TEST =
  process.env.WATCH_LEARNING_PROGRESS_DB_TEST?.trim() === "1"

const KEY = {
  courseId: "beginning-with-jesus",
  contentVersion: "2026-10-17-v1",
  lessonId: "lesson-1",
}

const subjects: string[] = []

function subject() {
  const id = `u8-db-test-${randomUUID()}`
  subjects.push(id)
  return id
}

function save(
  userId: string,
  overrides: Partial<WatchLearningSaveInput> = {},
): WatchLearningSaveInput {
  return {
    userId,
    ...KEY,
    expectedRevision: 0,
    completedMovementIds: [],
    completedStepIds: [],
    completed: false,
    resumeCardId: null,
    ...overrides,
  }
}

async function rowsFor(userId: string) {
  return prisma.$queryRaw<Array<{ lesson_id: string; revision: number }>>`
    SELECT lesson_id, revision FROM watch_learning_progress
    WHERE user_id = ${userId}`
}

describe.skipIf(!RUN_REAL_DB_TEST)(
  "watch learning progress (real Postgres)",
  () => {
    afterAll(async () => {
      if (subjects.length === 0) return
      await prisma.$executeRaw`
      DELETE FROM watch_learning_progress WHERE user_id = ANY(${subjects}::text[])`
      await prisma.$executeRaw`
      DELETE FROM watch_learning_erasures
      WHERE subject_hash = ANY(${subjects.map(watchLearningSubjectHash)}::text[])`
    })

    it("persists one user's lesson and hides it from every other subject", async () => {
      const userA = subject()
      const userB = subject()
      const saved = await saveWatchLearningProgress(
        save(userA, {
          completedMovementIds: ["back"],
          completedStepIds: ["back-how", "back-carrying"],
          resumeCardId: "back-give",
        }),
      )
      expect(saved.status).toBe("SAVED")
      expect(saved.progress.revision).toBe(1)

      const own = await listWatchLearningProgress({ userId: userA, ...KEY })
      expect(own).toHaveLength(1)
      expect(own[0]).toMatchObject({
        completedMovementIds: ["back"],
        completedStepIds: ["back-how", "back-carrying"],
        resumeCardId: "back-give",
        completed: false,
      })

      expect(
        await listWatchLearningProgress({ userId: userB, ...KEY }),
      ).toEqual([])
      // B writing the same lesson creates B's own row; A's is untouched.
      await saveWatchLearningProgress(
        save(userB, { completedStepIds: ["up-watch"] }),
      )
      const again = await listWatchLearningProgress({ userId: userA, ...KEY })
      expect(again[0].completedStepIds).toEqual(["back-how", "back-carrying"])
      expect(again[0].revision).toBe(1)
    })

    it("lets exactly one of two racing writes at the same revision win", async () => {
      const userId = subject()
      await saveWatchLearningProgress(save(userId))
      const [left, right] = await Promise.all([
        saveWatchLearningProgress(
          save(userId, { expectedRevision: 1, completedStepIds: ["back-how"] }),
        ),
        saveWatchLearningProgress(
          save(userId, { expectedRevision: 1, completedStepIds: ["up-watch"] }),
        ),
      ])
      expect([left.status, right.status].sort()).toEqual(["CONFLICT", "SAVED"])
      const winner = left.status === "SAVED" ? left : right
      const loser = left.status === "SAVED" ? right : left
      // The loser is handed the winner's state, not a silent overwrite.
      expect(loser.progress).toEqual(winner.progress)
      expect((await rowsFor(userId))[0].revision).toBe(2)
    })

    it("lets exactly one of two racing first writes create the row", async () => {
      const userId = subject()
      const results = await Promise.all([
        saveWatchLearningProgress(
          save(userId, { completedStepIds: ["back-how"] }),
        ),
        saveWatchLearningProgress(
          save(userId, { completedStepIds: ["up-watch"] }),
        ),
      ])
      expect(results.map((r) => r.status).sort()).toEqual(["CONFLICT", "SAVED"])
      expect(await rowsFor(userId)).toHaveLength(1)
    })

    it("keeps a reset row so a stale pre-reset write cannot restore old state", async () => {
      const userId = subject()
      await saveWatchLearningProgress(
        save(userId, { completedStepIds: ["back-how"], completed: true }),
      )
      const reset = await resetWatchLearningProgress({
        userId,
        ...KEY,
        expectedRevision: 1,
      })
      expect(reset.status).toBe("SAVED")
      expect(reset.progress).toMatchObject({
        revision: 2,
        completedStepIds: [],
        completed: false,
        completedAt: null,
        resumeCardId: null,
      })

      // A device that read revision 1 before the reset tries to save.
      const stale = await saveWatchLearningProgress(
        save(userId, {
          expectedRevision: 1,
          completedStepIds: ["back-how", "back-give"],
          completed: true,
        }),
      )
      expect(stale.status).toBe("CONFLICT")
      expect(stale.progress.completedStepIds).toEqual([])
      expect(stale.progress.completed).toBe(false)
      expect(await rowsFor(userId)).toEqual([
        { lesson_id: "lesson-1", revision: 2 },
      ])
    })

    it("conflicts a reset issued against a stale read instead of erasing newer progress", async () => {
      const userId = subject()
      await saveWatchLearningProgress(save(userId))
      await saveWatchLearningProgress(
        save(userId, { expectedRevision: 1, completedStepIds: ["back-how"] }),
      )
      const reset = await resetWatchLearningProgress({
        userId,
        ...KEY,
        expectedRevision: 1,
      })
      expect(reset.status).toBe("CONFLICT")
      expect(reset.progress.completedStepIds).toEqual(["back-how"])
    })

    it("never touches another lesson or content version", async () => {
      const userId = subject()
      await saveWatchLearningProgress(
        save(userId, { lessonId: "lesson-2", completedStepIds: ["back-how"] }),
      )
      await resetWatchLearningProgress({ userId, ...KEY, expectedRevision: 0 })
      const lessons = await listWatchLearningProgress({ userId, ...KEY })
      const lesson2 = lessons.find((lesson) => lesson.lessonId === "lesson-2")
      expect(lesson2?.completedStepIds).toEqual(["back-how"])
      await expect(
        listWatchLearningProgress({
          userId,
          courseId: KEY.courseId,
          contentVersion: "2025-01-01-v0",
        }),
      ).rejects.toBeInstanceOf(WatchLearningValidationError)
    })

    it("rejects unknown ids and oversized state with no partial write", async () => {
      const userId = subject()
      await expect(
        saveWatchLearningProgress(save(userId, { completedStepIds: ["nope"] })),
      ).rejects.toBeInstanceOf(WatchLearningValidationError)
      await expect(
        saveWatchLearningProgress(
          save(userId, {
            completedStepIds: Array.from({ length: 100 }, () => "back-how"),
          }),
        ),
      ).rejects.toBeInstanceOf(WatchLearningValidationError)
      expect(await rowsFor(userId)).toEqual([])
    })

    it("keeps the first completion time across later saves", async () => {
      const userId = subject()
      const first = await saveWatchLearningProgress(
        save(userId, { completed: true }),
      )
      const second = await saveWatchLearningProgress(
        save(userId, {
          expectedRevision: 1,
          completed: true,
          resumeCardId: "end",
        }),
      )
      expect(second.progress.completedAt).toBe(first.progress.completedAt)
    })

    it("erases with the account and refuses any later write for that subject", async () => {
      const userId = subject()
      const other = subject()
      await saveWatchLearningProgress(
        save(userId, { completedStepIds: ["back-how"] }),
      )
      await saveWatchLearningProgress(save(other))

      const erased = await prisma.$transaction((tx) =>
        eraseWatchLearningProgressForSubject(tx, userId),
      )
      expect(erased.deletedCount).toBe(1)
      expect(await rowsFor(userId)).toEqual([])
      expect(await rowsFor(other)).toHaveLength(1)

      await expect(
        saveWatchLearningProgress(save(userId)),
      ).rejects.toBeInstanceOf(WatchLearningSubjectErasedError)
      await expect(
        resetWatchLearningProgress({ userId, ...KEY, expectedRevision: 0 }),
      ).rejects.toBeInstanceOf(WatchLearningSubjectErasedError)
      expect(await rowsFor(userId)).toEqual([])
    })

    it("blocks a write already in flight during erasure from resurrecting the row", async () => {
      const userId = subject()
      let releaseErasure: () => void = () => {}
      const erasureHolding = new Promise<void>((resolve) => {
        releaseErasure = resolve
      })
      let erasureLocked: () => void = () => {}
      const locked = new Promise<void>((resolve) => {
        erasureLocked = resolve
      })

      const erasure = prisma.$transaction(
        async (tx) => {
          const result = await eraseWatchLearningProgressForSubject(tx, userId)
          erasureLocked()
          await erasureHolding
          return result
        },
        { timeout: 30_000 },
      )
      await locked
      // Starts while erasure holds the subject lock; it must wait, then see
      // the committed fence.
      const inFlight = saveWatchLearningProgress(
        save(userId, { completedStepIds: ["back-how"] }),
      )
      await new Promise((resolve) => setTimeout(resolve, 200))
      releaseErasure()
      await erasure
      await expect(inFlight).rejects.toBeInstanceOf(
        WatchLearningSubjectErasedError,
      )
      expect(await rowsFor(userId)).toEqual([])
    })

    it("rolls the erasure back with its transaction", async () => {
      const userId = subject()
      await saveWatchLearningProgress(save(userId))
      class Abort extends Error {}
      await expect(
        prisma.$transaction(async (tx) => {
          await eraseWatchLearningProgressForSubject(tx, userId)
          throw new Abort()
        }),
      ).rejects.toBeInstanceOf(Abort)
      expect(await rowsFor(userId)).toHaveLength(1)
      // No fence either: the account still exists and can keep saving.
      const next = await saveWatchLearningProgress(
        save(userId, { expectedRevision: 1, completedStepIds: ["back-how"] }),
      )
      expect(next.status).toBe("SAVED")
    })
  },
)
