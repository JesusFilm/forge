import { CombinedGraphQLErrors } from "@apollo/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

const admin = vi.hoisted(() => ({
  query: vi.fn(),
  mutate: vi.fn(),
  tokens: [] as string[],
}))

vi.mock("@/lib/admin-client", () => ({
  createUserAdminClient: (accessToken: string) => {
    admin.tokens.push(accessToken)
    return { query: admin.query, mutate: admin.mutate }
  },
}))

import {
  fetchLearningProgress,
  resetLearningProgress,
  saveLearningProgress,
} from "./watch-learning-progress"

const KEY = {
  courseId: "beginning-with-jesus",
  contentVersion: "2026-10-17-v1",
}

const PROGRESS = {
  ...KEY,
  lessonId: "lesson-1",
  completedMovementIds: ["back"],
  completedStepIds: ["back-how"],
  completed: false,
  completedAt: null,
  resumeCardId: "back-carrying",
  revision: 2,
  updatedAt: "2026-10-17T00:00:00.000Z",
}

const SAVE = {
  ...KEY,
  lessonId: "lesson-1",
  expectedRevision: 1,
  completedMovementIds: ["back"],
  completedStepIds: ["back-how"],
  completed: false,
  resumeCardId: "back-carrying",
}

function graphQLError(code: string) {
  return new CombinedGraphQLErrors({
    errors: [{ message: code, extensions: { code } }],
  })
}

beforeEach(() => {
  admin.query.mockReset()
  admin.mutate.mockReset()
  admin.tokens.length = 0
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("watch learning progress Admin bridge", () => {
  it("reads with a client bound to the caller's own token and sends no user id", async () => {
    admin.query.mockResolvedValue({
      data: { myWatchLearningProgress: [PROGRESS] },
    })
    const result = await fetchLearningProgress("token-a", KEY)
    expect(result).toEqual({ ok: true, lessons: [PROGRESS] })
    expect(admin.tokens).toEqual(["token-a"])
    expect(admin.query.mock.calls[0][0]).toMatchObject({
      variables: KEY,
      fetchPolicy: "no-cache",
    })
    expect(JSON.stringify(admin.query.mock.calls[0][0].variables)).not.toMatch(
      /user/i,
    )
  })

  it("passes saves through and reports a conflict with the server state", async () => {
    admin.mutate.mockResolvedValue({
      data: {
        saveMyWatchLearningProgress: {
          status: "CONFLICT",
          progress: { ...PROGRESS, revision: 5 },
        },
      },
    })
    const result = await saveLearningProgress("token-a", SAVE)
    expect(admin.mutate.mock.calls[0][0].variables).toEqual({ input: SAVE })
    expect(result).toEqual({
      ok: true,
      status: "conflict",
      progress: { ...PROGRESS, revision: 5 },
    })
  })

  it("sends the expected revision with a reset", async () => {
    admin.mutate.mockResolvedValue({
      data: {
        resetMyWatchLearningProgress: {
          status: "SAVED",
          progress: { ...PROGRESS, completedStepIds: [], revision: 3 },
        },
      },
    })
    const result = await resetLearningProgress("token-a", {
      ...KEY,
      lessonId: "lesson-1",
      expectedRevision: 2,
    })
    expect(admin.mutate.mock.calls[0][0].variables).toEqual({
      ...KEY,
      lessonId: "lesson-1",
      expectedRevision: 2,
    })
    expect(result).toMatchObject({ ok: true, status: "saved" })
  })

  it.each([
    ["BAD_USER_INPUT", "invalid"],
    ["FORBIDDEN", "forbidden"],
    ["UNAUTHENTICATED", "unauthorized"],
  ])("classifies Admin's %s as %s", async (code, reason) => {
    admin.mutate.mockRejectedValue(graphQLError(code))
    await expect(saveLearningProgress("token-a", SAVE)).resolves.toEqual({
      ok: false,
      reason,
    })
  })

  it("reports a database or network failure as upstream, never as empty progress", async () => {
    admin.query.mockRejectedValue(new Error("fetch failed"))
    await expect(fetchLearningProgress("token-a", KEY)).resolves.toEqual({
      ok: false,
      reason: "upstream",
    })
    admin.query.mockRejectedValue(graphQLError("INTERNAL_SERVER_ERROR"))
    await expect(fetchLearningProgress("token-a", KEY)).resolves.toEqual({
      ok: false,
      reason: "upstream",
    })
    admin.query.mockResolvedValue({ data: { myWatchLearningProgress: null } })
    await expect(fetchLearningProgress("token-a", KEY)).resolves.toEqual({
      ok: false,
      reason: "upstream",
    })
  })
})
