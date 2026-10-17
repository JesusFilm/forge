// Branch shape of the learning-progress service against a scripted
// transaction. The SQL itself (compare-and-set, ON CONFLICT, advisory lock,
// fence) is proven against real Postgres in the sibling .db.test.ts.

import { Prisma } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

type Call = { kind: "query" | "execute"; sql: string; values: unknown[] }

const db = vi.hoisted(() => ({
  calls: [] as Array<{
    kind: "query" | "execute"
    sql: string
    values: unknown[]
  }>,
  respond: (() => []) as (sql: string) => unknown,
}))

function record(kind: Call["kind"]) {
  return async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = Prisma.sql(strings, ...values)
    db.calls.push({ kind, sql: query.text, values: query.values })
    const result = db.respond(query.text)
    if (result instanceof Error) throw result
    return result
  }
}

vi.mock("@/db/client", () => {
  const tx = {
    $queryRaw: (...args: [TemplateStringsArray, ...unknown[]]) =>
      record("query")(...args),
    $executeRaw: (...args: [TemplateStringsArray, ...unknown[]]) =>
      record("execute")(...args),
  }
  return {
    prisma: {
      ...tx,
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) =>
        run(tx),
      ),
    },
  }
})

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

const KEY = {
  courseId: "beginning-with-jesus",
  contentVersion: "2026-10-17-v1",
  lessonId: "lesson-1",
}

function save(
  overrides: Partial<WatchLearningSaveInput> = {},
): WatchLearningSaveInput {
  return {
    userId: "user-a",
    ...KEY,
    expectedRevision: 0,
    completedMovementIds: [],
    completedStepIds: [],
    completed: false,
    resumeCardId: null,
    ...overrides,
  }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    course_id: KEY.courseId,
    content_version: KEY.contentVersion,
    lesson_id: KEY.lessonId,
    completed_movement_ids: [],
    completed_step_ids: [],
    completed_at: null,
    resume_card_id: null,
    revision: 1,
    updated_at: new Date("2026-10-17T00:00:00.000Z"),
    ...overrides,
  }
}

const isLock = (sql: string) => sql.includes("pg_advisory_xact_lock")
const isFence = (sql: string) => sql.includes("FROM watch_learning_erasures")
const isWrite = (sql: string) =>
  /INSERT INTO watch_learning_progress|UPDATE watch_learning_progress/.test(sql)

beforeEach(() => {
  db.calls.length = 0
  db.respond = () => []
  vi.mocked(prisma.$transaction).mockClear()
})

describe("input validation", () => {
  it.each([
    ["unknown course", { courseId: "other-course" }],
    ["unknown content version", { contentVersion: "2025-01-01-v0" }],
    ["unknown lesson", { lessonId: "lesson-10" }],
    ["unknown movement", { completedMovementIds: ["sideways"] }],
    ["unknown step", { completedStepIds: ["back-how", "free text"] }],
    ["retired-style step", { completedStepIds: ["up-question-5"] }],
    ["navigation card as a step", { completedStepIds: ["end"] }],
    ["unknown resume card", { resumeCardId: "up-question-9" }],
    [
      "oversized step list",
      { completedStepIds: Array.from({ length: 24 }, () => "back-how") },
    ],
    ["negative revision", { expectedRevision: -1 }],
    ["fractional revision", { expectedRevision: 1.5 }],
    ["empty subject", { userId: "" }],
  ])("rejects %s without opening a transaction", async (_label, overrides) => {
    await expect(
      saveWatchLearningProgress(save(overrides)),
    ).rejects.toBeInstanceOf(WatchLearningValidationError)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(db.calls).toHaveLength(0)
  })

  it("stores ids deduplicated and in course order", async () => {
    db.respond = (sql) => (isWrite(sql) ? [row()] : [])
    await saveWatchLearningProgress(
      save({
        completedMovementIds: ["forward", "back", "back"],
        completedStepIds: ["up-watch", "back-how", "up-watch"],
        resumeCardId: "up-intro",
      }),
    )
    const write = db.calls.find((call) => isWrite(call.sql))
    expect(write?.values).toContain('{"back","forward"}')
    expect(write?.values).toContain('{"back-how","up-watch"}')
    expect(write?.values).toContain("up-intro")
  })
})

describe("saveWatchLearningProgress", () => {
  it("locks the subject and checks the deletion fence before writing", async () => {
    db.respond = (sql) => (isWrite(sql) ? [row()] : [])
    const result = await saveWatchLearningProgress(save())
    expect(result.status).toBe("SAVED")
    const order = db.calls.map(({ sql }) =>
      isLock(sql)
        ? "lock"
        : isFence(sql)
          ? "fence"
          : isWrite(sql)
            ? "write"
            : "other",
    )
    expect(order).toEqual(["lock", "fence", "write"])
    expect(db.calls[1].values).toEqual([watchLearningSubjectHash("user-a")])
  })

  it("scopes every write and lookup to the caller's subject", async () => {
    db.respond = (sql) =>
      isWrite(sql)
        ? []
        : sql.includes("SELECT course_id")
          ? [row({ revision: 4 })]
          : []
    await saveWatchLearningProgress(
      save({ userId: "user-b", expectedRevision: 3 }),
    )
    for (const call of db.calls.filter(
      ({ sql }) => !isFence(sql) && !isLock(sql),
    )) {
      expect(call.values).toContain("user-b")
      expect(call.values).not.toContain("user-a")
    }
  })

  it("refuses a write for an erased account and never reaches the write", async () => {
    db.respond = (sql) => (isFence(sql) ? [{ erased: 1 }] : [row()])
    await expect(saveWatchLearningProgress(save())).rejects.toBeInstanceOf(
      WatchLearningSubjectErasedError,
    )
    expect(db.calls.some(({ sql }) => isWrite(sql))).toBe(false)
  })

  it("updates only at the expected revision", async () => {
    db.respond = (sql) => (isWrite(sql) ? [row({ revision: 3 })] : [])
    const result = await saveWatchLearningProgress(
      save({ expectedRevision: 2 }),
    )
    const write = db.calls.find((call) => isWrite(call.sql))
    expect(write?.sql).toContain("UPDATE watch_learning_progress")
    expect(write?.sql).toMatch(/AND revision = \$\d+/)
    expect(write?.values).toContain(2)
    expect(result).toMatchObject({ status: "SAVED", progress: { revision: 3 } })
  })

  it("returns CONFLICT with the winning state instead of overwriting it", async () => {
    const winner = row({
      revision: 5,
      completed_step_ids: ["back-how"],
      completed_at: new Date("2026-10-17T01:00:00.000Z"),
      resume_card_id: "back-carrying",
    })
    db.respond = (sql) =>
      isWrite(sql) ? [] : sql.includes("SELECT course_id") ? [winner] : []
    const result = await saveWatchLearningProgress(
      save({ expectedRevision: 4 }),
    )
    expect(result).toEqual({
      status: "CONFLICT",
      progress: {
        ...KEY,
        completedMovementIds: [],
        completedStepIds: ["back-how"],
        completed: true,
        completedAt: "2026-10-17T01:00:00.000Z",
        resumeCardId: "back-carrying",
        revision: 5,
        updatedAt: "2026-10-17T00:00:00.000Z",
      },
    })
  })

  it("reports a conflict against revision 0 when the expected row does not exist", async () => {
    const result = await saveWatchLearningProgress(
      save({ expectedRevision: 2 }),
    )
    expect(result.status).toBe("CONFLICT")
    expect(result.progress).toMatchObject({ revision: 0, completed: false })
  })

  it("surfaces a database failure rather than empty progress", async () => {
    db.respond = (sql) =>
      isWrite(sql) ? new Error("connection terminated") : []
    await expect(saveWatchLearningProgress(save())).rejects.toThrow(
      "connection terminated",
    )
  })

  it("derives completion only from the explicit flag", async () => {
    db.respond = (sql) => (isWrite(sql) ? [row()] : [])
    const lesson1Steps = [
      "back-how",
      "back-carrying",
      "back-give",
      "back-want",
      "back-quiet",
      "back-went-right",
      "up-watch",
      "up-retell",
      "up-question-1",
      "up-question-2",
      "up-question-3",
      "up-question-4",
      "up-conclusion",
      "up-truth-1",
      "up-truth-2",
      "up-truth-3",
      "up-truth-4",
      "forward-trustworthy",
      "forward-differently",
      "forward-retell",
      "forward-thanks",
      "forward-lands",
      "forward-for-them",
    ]
    await saveWatchLearningProgress(
      save({ completedStepIds: lesson1Steps, resumeCardId: "end" }),
    )
    const write = db.calls.find((call) => isWrite(call.sql))
    // The `completed` boolean is the only completion input bound to SQL.
    expect(write?.values).toContain(false)
    expect(write?.values).not.toContain(true)
  })
})

describe("resetWatchLearningProgress", () => {
  it("writes an empty state through the same revision guard", async () => {
    db.respond = (sql) => (isWrite(sql) ? [row({ revision: 7 })] : [])
    const result = await resetWatchLearningProgress({
      userId: "user-a",
      ...KEY,
      expectedRevision: 6,
    })
    const write = db.calls.find((call) => isWrite(call.sql))
    expect(write?.sql).toMatch(/AND revision = \$\d+/)
    expect(write?.values).toContain(6)
    expect(write?.values).toContain("{}")
    expect(result.status).toBe("SAVED")
  })

  it("conflicts rather than erasing progress saved after the caller's read", async () => {
    db.respond = (sql) =>
      isWrite(sql)
        ? []
        : sql.includes("SELECT course_id")
          ? [row({ revision: 9, completed_step_ids: ["back-how"] })]
          : []
    const result = await resetWatchLearningProgress({
      userId: "user-a",
      ...KEY,
      expectedRevision: 8,
    })
    expect(result.status).toBe("CONFLICT")
    expect(result.progress.completedStepIds).toEqual(["back-how"])
  })
})

describe("listWatchLearningProgress", () => {
  it("rejects an unknown content version without querying", async () => {
    await expect(
      listWatchLearningProgress({
        userId: "user-a",
        courseId: KEY.courseId,
        contentVersion: "2025-01-01-v0",
      }),
    ).rejects.toBeInstanceOf(WatchLearningValidationError)
    expect(db.calls).toHaveLength(0)
  })

  it("reads only the caller's rows for that version", async () => {
    db.respond = () => [row({ revision: 2 })]
    const lessons = await listWatchLearningProgress({
      userId: "user-a",
      courseId: KEY.courseId,
      contentVersion: KEY.contentVersion,
    })
    expect(db.calls[0].values).toEqual([
      "user-a",
      KEY.courseId,
      KEY.contentVersion,
    ])
    expect(lessons).toHaveLength(1)
    expect(lessons[0].revision).toBe(2)
  })
})

describe("eraseWatchLearningProgressForSubject", () => {
  it("locks, records a hashed fence, then deletes the subject's rows", async () => {
    db.respond = (sql) => (sql.includes("DELETE FROM") ? 3 : [])
    const tx = prisma as unknown as Prisma.TransactionClient
    const result = await eraseWatchLearningProgressForSubject(tx, "user-a")
    expect(result).toEqual({ deletedCount: 3 })
    expect(
      db.calls.map(({ sql }) =>
        isLock(sql)
          ? "lock"
          : sql.includes("INSERT INTO watch_learning_erasures")
            ? "fence"
            : sql.includes("DELETE FROM watch_learning_progress")
              ? "delete"
              : "other",
      ),
    ).toEqual(["lock", "fence", "delete"])
    const fence = db.calls[1]
    expect(fence.values[0]).toBe(watchLearningSubjectHash("user-a"))
    // The fence never stores the raw subject.
    expect(fence.values).not.toContain("user-a")
  })
})
