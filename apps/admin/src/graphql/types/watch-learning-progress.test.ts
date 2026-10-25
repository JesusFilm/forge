// Isolated-schema tests for learning progress (feat-731). The type is not yet
// imported by `schema.ts` (coordinator registers it with the stage-5 schema
// change), so a schema is built from the shared builder with only this file
// registered. Real scope-auth runs: every case executes through `execute`
// with a principal on the context.

import { execute, parse, printSchema } from "graphql"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Pothos loads GraphQL through Node. Share that instance instead of Vitest's
// transformed ESM one, whose schema classes belong to another realm.
vi.mock("graphql", async () => {
  const { createRequire } = await import("node:module")
  return createRequire(import.meta.url)("graphql") as typeof import("graphql")
})

const service = vi.hoisted(() => ({
  listWatchLearningProgress: vi.fn(),
  saveWatchLearningProgress: vi.fn(),
  resetWatchLearningProgress: vi.fn(),
}))

vi.mock("@/services/watch-learning-progress.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/watch-learning-progress.service")
  >("@/services/watch-learning-progress.service")
  return { ...actual, ...service }
})

vi.mock("@/db/client", () => ({ prisma: {} }))

import { builder } from "@/graphql/builder"
import "@/graphql/types/watch-learning-progress"
import {
  CONSUMER_BEARER_PRINCIPAL,
  MOBILE_USER_PRINCIPAL,
  WEB_USER_PRINCIPAL,
  type Principal,
} from "@/auth/principal"
import {
  WatchLearningSubjectErasedError,
  WatchLearningValidationError,
} from "@/services/watch-learning-progress.service"

const schema = builder.toSchema()
const sdl = printSchema(schema)

const USER_A = WEB_USER_PRINCIPAL({ subject: "auth-user-a" })
const USER_B = WEB_USER_PRINCIPAL({ subject: "auth-user-b" })

const PROGRESS = {
  courseId: "beginning-with-jesus",
  contentVersion: "2026-10-17-v1",
  lessonId: "lesson-1",
  completedMovementIds: [],
  completedStepIds: ["back-how"],
  completed: false,
  completedAt: null,
  resumeCardId: "back-carrying",
  revision: 1,
  updatedAt: "2026-10-17T00:00:00.000Z",
}

const LIST = /* GraphQL */ `
  query {
    myWatchLearningProgress(
      courseId: "beginning-with-jesus"
      contentVersion: "2026-10-17-v1"
    ) {
      lessonId
      completedStepIds
      revision
    }
  }
`

const SAVE = /* GraphQL */ `
  mutation Save($input: WatchLearningProgressSaveInput!) {
    saveMyWatchLearningProgress(input: $input) {
      status
      progress {
        lessonId
        revision
        completed
      }
    }
  }
`

const RESET = /* GraphQL */ `
  mutation {
    resetMyWatchLearningProgress(
      courseId: "beginning-with-jesus"
      contentVersion: "2026-10-17-v1"
      lessonId: "lesson-1"
      expectedRevision: 3
    ) {
      status
      progress {
        revision
      }
    }
  }
`

const SAVE_INPUT = {
  courseId: "beginning-with-jesus",
  contentVersion: "2026-10-17-v1",
  lessonId: "lesson-1",
  expectedRevision: 0,
  completedMovementIds: [],
  completedStepIds: ["back-how"],
  completed: false,
  resumeCardId: "back-carrying",
}

function run(
  document: string,
  user: Principal | null,
  variableValues?: Record<string, unknown>,
) {
  return execute({
    schema,
    document: parse(document),
    variableValues,
    contextValue: { user },
  })
}

beforeEach(() => {
  service.listWatchLearningProgress.mockReset().mockResolvedValue([PROGRESS])
  service.saveWatchLearningProgress
    .mockReset()
    .mockResolvedValue({ status: "SAVED", progress: PROGRESS })
  service.resetWatchLearningProgress.mockReset().mockResolvedValue({
    status: "SAVED",
    progress: { ...PROGRESS, revision: 4, completedStepIds: [] },
  })
})

describe("public contract", () => {
  it("pins the agreed non-null result contract under the shared builder", () => {
    const progress = schema.getType("WatchLearningLessonProgress")
    if (!progress || !("getFields" in progress))
      throw new Error("Missing progress type")
    const fields = progress.getFields()
    for (const name of ["courseId", "contentVersion", "lessonId"])
      expect(String(fields[name].type)).toBe("String!")
    expect(String(fields.completedMovementIds.type)).toBe("[String!]!")
    expect(String(fields.completedStepIds.type)).toBe("[String!]!")
    expect(String(fields.completed.type)).toBe("Boolean!")
    expect(String(fields.revision.type)).toBe("Int!")
    expect(
      String(schema.getQueryType()!.getFields().myWatchLearningProgress.type),
    ).toBe("[WatchLearningLessonProgress!]!")
    for (const name of [
      "saveMyWatchLearningProgress",
      "resetMyWatchLearningProgress",
    ])
      expect(String(schema.getMutationType()!.getFields()[name].type)).toBe(
        "WatchLearningSaveResult!",
      )
    const saved = schema.getType("WatchLearningSaveResult")
    if (!saved || !("getFields" in saved))
      throw new Error("Missing save result")
    expect(String(saved.getFields().status.type)).toBe(
      "WatchLearningSaveStatus!",
    )
    expect(String(saved.getFields().progress.type)).toBe(
      "WatchLearningLessonProgress!",
    )
  })

  it("accepts no user id from the caller anywhere", () => {
    expect(sdl).not.toMatch(/userId|subject|authUserId/i)
  })

  it("keeps the input to bounded ids and flags — no free text or JSON", () => {
    const input = schema.getType("WatchLearningProgressSaveInput")
    expect(
      input && "getFields" in input
        ? Object.keys(input.getFields()).sort()
        : [],
    ).toEqual(
      [
        "courseId",
        "contentVersion",
        "lessonId",
        "expectedRevision",
        "completedMovementIds",
        "completedStepIds",
        "completed",
        "resumeCardId",
      ].sort(),
    )
    expect(sdl).not.toMatch(/JSON/)
  })
})

describe("own-data access", () => {
  it("reads with the subject from the verified principal", async () => {
    const result = await run(LIST, USER_A)
    expect(result.errors).toBeUndefined()
    expect(service.listWatchLearningProgress).toHaveBeenCalledWith({
      userId: "auth-user-a",
      courseId: "beginning-with-jesus",
      contentVersion: "2026-10-17-v1",
    })
  })

  it("writes and resets only under the caller's own subject", async () => {
    await run(SAVE, USER_B, { input: SAVE_INPUT })
    await run(RESET, USER_B)
    expect(service.saveWatchLearningProgress).toHaveBeenCalledWith({
      userId: "auth-user-b",
      ...SAVE_INPUT,
    })
    expect(service.resetWatchLearningProgress).toHaveBeenCalledWith({
      userId: "auth-user-b",
      courseId: "beginning-with-jesus",
      contentVersion: "2026-10-17-v1",
      lessonId: "lesson-1",
      expectedRevision: 3,
    })
  })

  it.each<[string, Principal | null]>([
    ["anonymous", null],
    ["ADMIN (no editorial override)", { id: "admin-1", role: "ADMIN" }],
    ["EDITOR", { id: "editor-1", role: "EDITOR" }],
    ["SYSTEM", { id: null, role: "SYSTEM" }],
    ["WORKFLOW_TRIGGER", { id: null, role: "WORKFLOW_TRIGGER" }],
    ["consumer bearer", CONSUMER_BEARER_PRINCIPAL({ rateLimitBucketKey: "c" })],
    ["mobile user", MOBILE_USER_PRINCIPAL({ subject: "auth-user-a" })],
  ])(
    "denies %s on every operation without calling the service",
    async (_label, user) => {
      const results = await Promise.all([
        run(LIST, user),
        run(SAVE, user, { input: SAVE_INPUT }),
        run(RESET, user),
      ])
      for (const result of results) {
        expect(result.errors?.length).toBeGreaterThan(0)
        expect(result.data).toBeNull()
      }
      expect(service.listWatchLearningProgress).not.toHaveBeenCalled()
      expect(service.saveWatchLearningProgress).not.toHaveBeenCalled()
      expect(service.resetWatchLearningProgress).not.toHaveBeenCalled()
    },
  )
})

describe("result and error mapping", () => {
  it("returns a conflict with the server state rather than an error", async () => {
    service.saveWatchLearningProgress.mockResolvedValue({
      status: "CONFLICT",
      progress: { ...PROGRESS, revision: 6, completed: true },
    })
    const result = await run(SAVE, USER_A, { input: SAVE_INPUT })
    expect(result.errors).toBeUndefined()
    expect(result.data?.saveMyWatchLearningProgress).toEqual({
      status: "CONFLICT",
      progress: { lessonId: "lesson-1", revision: 6, completed: true },
    })
  })

  it("maps rejected ids to BAD_USER_INPUT", async () => {
    service.saveWatchLearningProgress.mockRejectedValue(
      new WatchLearningValidationError("Unknown step id"),
    )
    const result = await run(SAVE, USER_A, { input: SAVE_INPUT })
    expect(result.errors?.[0].extensions?.code).toBe("BAD_USER_INPUT")
  })

  it("maps an erased account to FORBIDDEN", async () => {
    service.saveWatchLearningProgress.mockRejectedValue(
      new WatchLearningSubjectErasedError(),
    )
    const result = await run(SAVE, USER_A, { input: SAVE_INPUT })
    expect(result.errors?.[0].extensions?.code).toBe("FORBIDDEN")
  })

  it("surfaces a database failure as an error, never empty progress", async () => {
    service.listWatchLearningProgress.mockRejectedValue(
      new Error("connection terminated"),
    )
    const result = await run(LIST, USER_A)
    expect(result.errors?.length).toBeGreaterThan(0)
    expect(result.data?.myWatchLearningProgress ?? null).toBeNull()
  })
})
