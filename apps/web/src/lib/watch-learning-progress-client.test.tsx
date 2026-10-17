// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createLearningProgressClient,
  fetchLearningTransport,
  parseServerLesson,
  readWatchGrowReturn,
  watchGrowLoginUrl,
  withoutWatchGrowReturn,
  type LearningRequest,
  type LearningResponse,
} from "./watch-learning-progress-client"

type Call = {
  request: LearningRequest
  resolve: (response: LearningResponse) => void
  reject: (error: unknown) => void
}

function fakeTransport() {
  const calls: Call[] = []
  const transport = vi.fn(
    (request: LearningRequest) =>
      new Promise<LearningResponse>((resolve, reject) => {
        calls.push({ request, resolve, reject })
      }),
  )
  return { calls, transport }
}

const KEY = {
  courseId: "beginning-with-jesus",
  contentVersion: "2026-10-17-v1",
} as const

function lesson(overrides: Record<string, unknown> = {}) {
  return {
    ...KEY,
    lessonId: "lesson-1",
    completedMovementIds: [],
    completedStepIds: [],
    completed: false,
    completedAt: null,
    resumeCardId: null,
    revision: 0,
    updatedAt: null,
    ...overrides,
  }
}

async function flush() {
  for (let index = 0; index < 5; index++) await Promise.resolve()
}

async function signIn(
  client: ReturnType<typeof createLearningProgressClient>,
  calls: Call[],
  lessons: unknown[] = [],
  userId = "user-a",
) {
  client.setAccount({ kind: "signed-in", userId })
  const get = calls.at(-1)!
  expect(get.request.method).toBe("GET")
  get.resolve({
    status: 200,
    body: { authenticated: true, userId, lessons },
  })
  await flush()
}

beforeEach(() => {
  vi.useRealTimers()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("default transport", () => {
  it("uses the same-origin private route with structured JSON only", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ status: "saved", progress: lesson() }),
    )
    vi.stubGlobal("fetch", fetchMock)
    await fetchLearningTransport({ method: "GET" })
    const [getUrl, getInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(new URL(getUrl).pathname).toBe("/watch/api/learning-progress")
    expect(new URL(getUrl).origin).toBe(window.location.origin)
    expect(new URL(getUrl).searchParams.get("courseId")).toBe(KEY.courseId)
    expect(getInit).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
    })
    await fetchLearningTransport({
      method: "POST",
      keepalive: true,
      subject: "user-a",
      body: {
        ...KEY,
        lessonId: "lesson-1",
        expectedRevision: 0,
        completedMovementIds: [],
        completedStepIds: [],
        completed: false,
        resumeCardId: null,
      },
    })
    const [, postInit] = fetchMock.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ]
    expect(postInit.method).toBe("POST")
    expect(postInit.keepalive).toBe(true)
    // The loaded account travels as a header precondition, never in the body.
    expect(new Headers(postInit.headers).get("x-watch-learning-subject")).toBe(
      "user-a",
    )
    expect(Object.keys(JSON.parse(postInit.body as string)).sort()).toEqual(
      [
        "completed",
        "completedMovementIds",
        "completedStepIds",
        "contentVersion",
        "courseId",
        "expectedRevision",
        "lessonId",
        "resumeCardId",
      ].sort(),
    )
  })
})

describe("anonymous progress", () => {
  it("stays local and unsaved; no request is ever made", () => {
    const { transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    client.setAccount({ kind: "anonymous" })
    client.change("lesson-1", {
      completedStepIds: ["back-how"],
      completed: false,
    })
    client.setResume("lesson-1", "end")
    client.flush({ keepalive: true })
    const view = client.getSnapshot().lessons["lesson-1"]!
    expect(view).toMatchObject({
      status: "unsaved",
      completed: false,
      completedStepIds: ["back-how"],
      resumeCardId: "end",
    })
    expect(transport).not.toHaveBeenCalled()
  })
})

describe("signed-in saving", () => {
  it("sends only explicit structured state with the read revision; reaching the end never completes", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls)
    // Navigation alone (no stored row, no explicit change) writes nothing.
    client.setResume("lesson-1", "end")
    client.flush()
    expect(calls).toHaveLength(1)

    client.change("lesson-1", {
      completedStepIds: [
        "back-went-right",
        "back-how",
        "back-how",
        "retired-step",
      ],
      completed: false,
    })
    const post = calls.at(-1)!
    expect(post.request).toMatchObject({
      method: "POST",
      body: {
        ...KEY,
        lessonId: "lesson-1",
        expectedRevision: 0,
        completedStepIds: ["back-how", "back-went-right"],
        completedMovementIds: [],
        completed: false,
        resumeCardId: "end",
      },
    })
    expect(JSON.stringify(post.request)).not.toMatch(/reflection|note|text/i)
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
    post.resolve({
      status: 200,
      body: {
        status: "saved",
        progress: lesson({
          completedStepIds: ["back-how", "back-went-right"],
          resumeCardId: "end",
          revision: 1,
        }),
      },
    })
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saved",
      saved: true,
      completed: false,
    })
  })

  it("coalesces resume writes for saved lessons and flushes them on close with keepalive", async () => {
    vi.useFakeTimers()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [lesson({ revision: 3 })])
    client.setResume("lesson-1", "back-how")
    client.setResume("lesson-1", "back-carrying")
    expect(calls).toHaveLength(1)
    client.flush({ keepalive: true })
    expect(calls).toHaveLength(2)
    expect(calls[1]!.request).toMatchObject({
      method: "POST",
      keepalive: true,
      body: { expectedRevision: 3, resumeCardId: "back-carrying" },
    })
    calls[1]!.resolve({
      status: 200,
      body: {
        status: "saved",
        progress: lesson({ resumeCardId: "back-carrying", revision: 4 }),
      },
    })
    await flush()
    client.setResume("lesson-1", "back-give")
    await vi.advanceTimersByTimeAsync(1499)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls[2]!.request).toMatchObject({
      body: { expectedRevision: 4, resumeCardId: "back-give" },
    })
  })

  it("queues a change made during a save and sends it with the new revision", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls)
    client.change("lesson-1", {
      completedStepIds: ["back-how"],
      completed: false,
    })
    client.change("lesson-1", {
      completedStepIds: ["back-how"],
      completed: true,
    })
    expect(calls).toHaveLength(2)
    calls[1]!.resolve({
      status: 200,
      body: {
        status: "saved",
        progress: lesson({ completedStepIds: ["back-how"], revision: 1 }),
      },
    })
    await flush()
    expect(calls).toHaveLength(3)
    expect(calls[2]!.request).toMatchObject({
      body: { expectedRevision: 1, completed: true },
    })
  })
})

describe("failures and conflicts", () => {
  it("keeps offline changes visibly unsaved and retries only on request", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls)
    client.change("lesson-1", {
      completedStepIds: ["back-how"],
      completed: false,
    })
    calls.at(-1)!.reject(new TypeError("Failed to fetch"))
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "error",
      error: "network",
      completedStepIds: ["back-how"],
    })
    expect(calls).toHaveLength(2)
    calls.at(-1)
    client.retry("lesson-1")
    expect(calls).toHaveLength(3)
    calls[2]!.resolve({ status: 502, body: { error: "upstream" } })
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "error",
      error: "upstream",
    })
  })

  it("on conflict keeps unsaved state, never resends by itself, and lets the visitor choose", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [lesson({ revision: 2 })])
    client.change("lesson-1", {
      completedStepIds: ["back-how"],
      completed: true,
    })
    calls[1]!.resolve({
      status: 200,
      body: {
        status: "conflict",
        progress: lesson({ completedStepIds: ["up-watch"], revision: 5 }),
      },
    })
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "conflict",
      completedStepIds: ["back-how"],
      completed: true,
    })
    client.change("lesson-1", { completedStepIds: [], completed: true })
    expect(calls).toHaveLength(2)

    client.keepMine("lesson-1")
    expect(calls[2]!.request).toMatchObject({
      body: { expectedRevision: 5, completedStepIds: [], completed: true },
    })
    calls[2]!.resolve({
      status: 200,
      body: {
        status: "conflict",
        progress: lesson({ completedStepIds: ["up-watch"], revision: 6 }),
      },
    })
    await flush()
    client.useSaved("lesson-1")
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saved",
      completedStepIds: ["up-watch"],
      completed: false,
    })
  })

  it("never lets a resume write scheduled during a save send over that save's conflict", async () => {
    vi.useFakeTimers()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [lesson({ revision: 2 })])
    client.change("lesson-1", {
      completedStepIds: ["back-how"],
      completed: false,
    })
    // Reading on while the save is in flight schedules a resume write.
    client.setResume("lesson-1", "back-carrying")
    calls[1]!.resolve({
      status: 200,
      body: {
        status: "conflict",
        progress: lesson({ completedStepIds: ["up-watch"], revision: 5 }),
      },
    })
    await flush()
    await vi.advanceTimersByTimeAsync(2000)
    expect(calls.map((call) => call.request.method)).toEqual(["GET", "POST"])
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "conflict",
      completedStepIds: ["back-how"],
      resumeCardId: "back-carrying",
    })

    client.keepMine("lesson-1")
    expect(calls[2]!.request).toMatchObject({
      method: "POST",
      body: {
        expectedRevision: 5,
        completedStepIds: ["back-how"],
        resumeCardId: "back-carrying",
      },
    })
    calls[2]!.resolve({
      status: 200,
      body: {
        status: "saved",
        progress: lesson({
          completedStepIds: ["back-how"],
          resumeCardId: "back-carrying",
          revision: 6,
        }),
      },
    })
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saved")
  })

  it("never lets a pending resume write resend a failed save on pagehide; Retry sends it", async () => {
    vi.useFakeTimers()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [lesson({ revision: 2 })])
    client.change("lesson-1", {
      completedStepIds: ["back-how"],
      completed: false,
    })
    client.setResume("lesson-1", "back-carrying")
    calls[1]!.reject(new TypeError("Failed to fetch"))
    await flush()
    client.flush({ keepalive: true })
    await vi.advanceTimersByTimeAsync(2000)
    expect(calls).toHaveLength(2)
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "error",
      error: "network",
    })
    client.retry("lesson-1")
    expect(calls[2]!.request).toMatchObject({
      method: "POST",
      body: {
        expectedRevision: 2,
        completedStepIds: ["back-how"],
        resumeCardId: "back-carrying",
      },
    })
  })

  it("keeps a conflict waiting for a choice when the course re-reads the same account", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [
      lesson({ completedStepIds: ["back-how"], revision: 1 }),
    ])
    client.change("lesson-1", {
      completedStepIds: ["back-how", "back-give"],
      completed: true,
    })
    // Another device reset the lesson meanwhile.
    calls[1]!.resolve({
      status: 200,
      body: { status: "conflict", progress: lesson({ revision: 2 }) },
    })
    await flush()
    // Another explicit change while the choice is pending is kept, not armed.
    client.change("lesson-1", {
      completedStepIds: ["back-how", "back-give", "back-went-right"],
      completed: true,
    })

    // Closing and re-opening the course re-checks the same session.
    client.setAccount({ kind: "checking" })
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    const read = calls.at(-1)!
    expect(read.request.method).toBe("GET")
    read.resolve({
      status: 200,
      body: {
        authenticated: true,
        userId: "user-a",
        lessons: [lesson({ revision: 2 })],
      },
    })
    await flush()
    expect(calls.filter((call) => call.request.method === "POST")).toHaveLength(
      1,
    )
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "conflict",
      operation: "save",
      completedStepIds: ["back-how", "back-give", "back-went-right"],
      completed: true,
    })

    client.keepMine("lesson-1")
    expect(calls.at(-1)!.request).toMatchObject({
      method: "POST",
      body: { expectedRevision: 2, completed: true },
    })
  })

  it("keeps a reset conflict waiting for a choice across a re-read", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [
      lesson({ completedStepIds: ["back-how"], revision: 2 }),
    ])
    client.reset("lesson-1")
    const newer = lesson({
      completedStepIds: ["back-how", "up-watch"],
      revision: 3,
    })
    calls[1]!.resolve({
      status: 200,
      body: { status: "conflict", progress: newer },
    })
    await flush()
    client.setAccount({ kind: "checking" })
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    calls.at(-1)!.resolve({
      status: 200,
      body: { authenticated: true, userId: "user-a", lessons: [newer] },
    })
    await flush()
    expect(calls.map((call) => call.request.method)).toEqual([
      "GET",
      "DELETE",
      "GET",
    ])
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "conflict",
      operation: "reset",
      completedStepIds: ["back-how", "up-watch"],
    })
    client.useSaved("lesson-1")
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saved")
    expect(calls).toHaveLength(3)
  })

  it("holds a change made while the session is re-checked during a conflict", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [lesson({ revision: 1 })])
    client.change("lesson-1", {
      completedStepIds: ["back-how"],
      completed: false,
    })
    calls[1]!.resolve({
      status: 200,
      body: { status: "conflict", progress: lesson({ revision: 2 }) },
    })
    await flush()
    client.setAccount({ kind: "checking" })
    client.change("lesson-1", {
      completedStepIds: ["back-how", "back-give"],
      completed: false,
    })
    client.setAccount({ kind: "unavailable" })
    client.change("lesson-1", {
      completedStepIds: ["back-how", "back-give", "back-went-right"],
      completed: false,
    })
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("conflict")
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    calls.at(-1)!.resolve({
      status: 200,
      body: {
        authenticated: true,
        userId: "user-a",
        lessons: [lesson({ revision: 2 })],
      },
    })
    await flush()
    client.setResume("lesson-1", "end")
    client.flush()
    expect(calls.map((call) => call.request.method)).toEqual([
      "GET",
      "POST",
      "GET",
    ])
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "conflict",
      operation: "save",
      completedStepIds: ["back-how", "back-give", "back-went-right"],
    })
  })

  it("keeps a failed save waiting for Retry when the course re-reads the same account", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [lesson({ revision: 1 })])
    client.change("lesson-1", {
      completedStepIds: ["back-how"],
      completed: true,
    })
    calls[1]!.reject(new TypeError("Failed to fetch"))
    await flush()
    // Another device changed the lesson; this tab closes and re-opens.
    client.setAccount({ kind: "checking" })
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    calls.at(-1)!.resolve({
      status: 200,
      body: {
        authenticated: true,
        userId: "user-a",
        lessons: [lesson({ completedStepIds: ["up-watch"], revision: 2 })],
      },
    })
    await flush()
    expect(calls.map((call) => call.request.method)).toEqual([
      "GET",
      "POST",
      "GET",
    ])
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "error",
      error: "network",
      operation: "save",
      completedStepIds: ["back-how"],
      completed: true,
    })
    client.retry("lesson-1")
    expect(calls.at(-1)!.request).toMatchObject({
      method: "POST",
      body: { expectedRevision: 2, completed: true },
    })
  })

  it("keeps a failed reset waiting for Retry when the course re-reads the same account", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    const saved = lesson({ completedStepIds: ["back-how"], revision: 2 })
    await signIn(client, calls, [saved])
    client.reset("lesson-1")
    calls[1]!.resolve({ status: 502, body: { error: "upstream" } })
    await flush()
    client.setAccount({ kind: "checking" })
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    const newer = lesson({ completedStepIds: ["back-how"], revision: 3 })
    calls.at(-1)!.resolve({
      status: 200,
      body: { authenticated: true, userId: "user-a", lessons: [newer] },
    })
    await flush()
    expect(calls.map((call) => call.request.method)).toEqual([
      "GET",
      "DELETE",
      "GET",
    ])
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "error",
      error: "upstream",
      operation: "reset",
      completedStepIds: ["back-how"],
    })
    client.retry("lesson-1")
    expect(calls.at(-1)!.request).toMatchObject({
      method: "DELETE",
      body: { expectedRevision: 3 },
    })
  })

  it("resets with the read revision and does not erase newer progress on a stale reset", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [
      lesson({ completedStepIds: ["back-how"], revision: 2 }),
    ])
    client.reset("lesson-1")
    expect(calls[1]!.request).toEqual(
      expect.objectContaining({
        method: "DELETE",
        body: { ...KEY, lessonId: "lesson-1", expectedRevision: 2 },
      }),
    )
    calls[1]!.resolve({
      status: 200,
      body: {
        status: "conflict",
        progress: lesson({
          completedStepIds: ["back-how", "up-watch"],
          revision: 3,
        }),
      },
    })
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "conflict",
      operation: "reset",
      completedStepIds: ["back-how", "up-watch"],
    })
    client.keepMine("lesson-1")
    expect(calls[2]!.request).toMatchObject({
      method: "DELETE",
      body: { expectedRevision: 3 },
    })
    calls[2]!.resolve({
      status: 200,
      body: { status: "saved", progress: lesson({ revision: 4 }) },
    })
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saved",
      completedStepIds: [],
    })
  })

  it("ignores retired stored ids and never marks new content complete from them", () => {
    const parsed = parseServerLesson(
      lesson({
        completedStepIds: ["back-how", "back-retired"],
        resumeCardId: "retired-card",
        revision: 1,
      }),
    )
    expect(parsed?.progress).toEqual({
      completedStepIds: ["back-how"],
      completed: false,
      resumeCardId: null,
      revision: 1,
    })
    expect(parseServerLesson(lesson({ contentVersion: "2025-old" }))).toBeNull()
  })

  it("treats a malformed or failed read as an error, never as empty progress", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    calls[0]!.resolve({ status: 502, body: { error: "upstream" } })
    await flush()
    expect(client.getSnapshot().load).toBe("error")
    client.change("lesson-1", {
      completedStepIds: ["back-how"],
      completed: false,
    })
    expect(calls).toHaveLength(1)
    client.refresh()
    calls[1]!.resolve({
      status: 200,
      body: { authenticated: true, userId: "user-a", lessons: [{ bad: true }] },
    })
    await flush()
    expect(client.getSnapshot().load).toBe("error")
  })
})

describe("identity transitions", () => {
  it("drops the old account's state and drafts, aborts in flight, and ignores late answers", async () => {
    const cleared = vi.fn()
    const stale = vi.fn()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({
      transport,
      onAccountCleared: cleared,
      onStaleIdentity: stale,
    })
    await signIn(client, calls, [
      lesson({ completedStepIds: ["back-how"], revision: 1 }),
    ])
    client.change("lesson-1", {
      completedStepIds: ["back-how", "back-give"],
      completed: false,
    })
    const inFlight = calls.at(-1)!
    const signal = (inFlight.request as { signal: AbortSignal }).signal

    client.setAccount({ kind: "signed-in", userId: "user-b" })
    expect(signal.aborted).toBe(true)
    expect(cleared).toHaveBeenCalledTimes(1)
    expect(client.getSnapshot().lessons["lesson-1"]).toBeUndefined()
    inFlight.resolve({
      status: 200,
      body: {
        status: "saved",
        progress: lesson({
          completedStepIds: ["back-how", "back-give"],
          revision: 2,
        }),
      },
    })
    const bRead = calls.at(-1)!
    bRead.resolve({
      status: 200,
      body: { authenticated: true, userId: "user-b", lessons: [] },
    })
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      completedStepIds: [],
      saved: false,
    })

    client.setAccount({ kind: "anonymous" })
    expect(cleared).toHaveBeenCalledTimes(2)
    expect(client.getSnapshot().lessons).toEqual({})
    expect(stale).not.toHaveBeenCalled()
  })

  it("ignores a late refusal from the previous account instead of re-checking the new session", async () => {
    const stale = vi.fn()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({
      transport,
      onStaleIdentity: stale,
    })
    await signIn(client, calls)
    client.change("lesson-1", {
      completedStepIds: ["back-how"],
      completed: false,
    })
    const late = calls.at(-1)!
    client.setAccount({ kind: "anonymous" })
    late.resolve({ status: 401, body: { error: "unauthorized" } })
    await flush()
    expect(stale).not.toHaveBeenCalled()
    expect(client.getSnapshot().lessons).toEqual({})
  })

  it("rejects a read answered for a different account", async () => {
    const stale = vi.fn()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({
      transport,
      onStaleIdentity: stale,
    })
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    calls[0]!.resolve({
      status: 200,
      body: {
        authenticated: true,
        userId: "user-b",
        lessons: [lesson({ completedStepIds: ["back-how"], revision: 1 })],
      },
    })
    await flush()
    expect(client.getSnapshot().load).toBe("error")
    expect(client.getSnapshot().lessons["lesson-1"]).toBeUndefined()
    expect(stale).toHaveBeenCalledTimes(1)
  })

  it("asks for the session again when a save is refused as signed out", async () => {
    const stale = vi.fn()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({
      transport,
      onStaleIdentity: stale,
    })
    await signIn(client, calls)
    client.change("lesson-1", {
      completedStepIds: ["back-how"],
      completed: false,
    })
    calls[1]!.resolve({ status: 401, body: { error: "unauthorized" } })
    await flush()
    expect(stale).toHaveBeenCalledTimes(1)
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("error")
  })

  it("binds every write to the account whose progress it loaded", async () => {
    const stale = vi.fn()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({
      transport,
      onStaleIdentity: stale,
    })
    await signIn(client, calls, [
      lesson({ completedStepIds: ["back-how"], revision: 1 }),
    ])
    client.change("lesson-1", {
      completedStepIds: ["back-how", "back-give"],
      completed: false,
    })
    expect(calls[1]!.request).toMatchObject({
      method: "POST",
      subject: "user-a",
    })
    // The shared cookie now belongs to another account: the route refuses.
    calls[1]!.resolve({ status: 409, body: { error: "identity-mismatch" } })
    await flush()
    expect(stale).toHaveBeenCalledTimes(1)
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "error",
      error: "unauthorized",
    })
  })

  it("does not re-check the session when a save is refused because the session cannot hold progress", async () => {
    const stale = vi.fn()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({
      transport,
      onStaleIdentity: stale,
    })
    await signIn(client, calls)
    client.change("lesson-1", {
      completedStepIds: ["back-how"],
      completed: false,
    })
    calls[1]!.resolve({ status: 401, body: { error: "progress-unavailable" } })
    await flush()
    expect(stale).not.toHaveBeenCalled()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "error",
      error: "unauthorized",
    })
    expect(calls).toHaveLength(2)
  })

  it("does not re-check the session for an account that cannot hold progress", async () => {
    const stale = vi.fn()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({
      transport,
      onStaleIdentity: stale,
    })
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    calls[0]!.resolve({
      status: 200,
      body: {
        authenticated: true,
        userId: "user-a",
        progressAvailable: false,
      },
    })
    await flush()
    expect(client.getSnapshot().load).toBe("error")
    expect(stale).not.toHaveBeenCalled()
  })

  it("re-checks the session at most once per account until a read succeeds", async () => {
    const { calls, transport } = fakeTransport()
    // Mirrors the session hook's retry: lock, then the same account again.
    const stale = vi.fn(() => {
      client.setAccount({ kind: "checking" })
      client.setAccount({ kind: "signed-in", userId: "user-a" })
    })
    const client = createLearningProgressClient({
      transport,
      onStaleIdentity: stale,
    })
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    for (let lap = 0; lap < 3; lap++) {
      const read = calls.at(-1)!
      if (read.request.method !== "GET") break
      read.resolve({ status: 200, body: { authenticated: false } })
      await flush()
    }
    expect(stale).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(2)
    expect(client.getSnapshot().load).toBe("error")

    // A successful read re-opens the one re-check, for reads and writes alike.
    client.refresh()
    calls.at(-1)!.resolve({
      status: 200,
      body: { authenticated: true, userId: "user-a", lessons: [] },
    })
    await flush()
    client.change("lesson-1", {
      completedStepIds: ["back-how"],
      completed: false,
    })
    calls.at(-1)!.resolve({ status: 401, body: { error: "unauthorized" } })
    await flush()
    expect(stale).toHaveBeenCalledTimes(2)
    calls.at(-1)!.resolve({ status: 200, body: { authenticated: false } })
    await flush()
    expect(stale).toHaveBeenCalledTimes(2)
  })
})

describe("focus re-check hold", () => {
  // A focus re-read of the session holds writes until it answers. The hold is
  // invisible: the account, the loaded progress and every open choice stay as
  // they were, and a re-confirmed same account needs no progress re-read.
  function saved(overrides: Record<string, unknown> = {}) {
    return lesson({
      completedStepIds: ["back-how"],
      resumeCardId: "back-how",
      revision: 3,
      ...overrides,
    })
  }

  it("keeps a pending resume write through the hold and pagehide, then sends it with no re-read", async () => {
    vi.useFakeTimers()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [saved()])
    client.setResume("lesson-1", "back-carrying")
    // The position is not on the account yet, so the lesson is not Saved.
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
    const before = client.getSnapshot()
    client.hold()
    expect(client.getSnapshot()).toBe(before)
    await vi.advanceTimersByTimeAsync(1700)
    client.flush({ keepalive: true })
    expect(calls).toHaveLength(1)
    expect(client.getSnapshot()).toMatchObject({
      account: "signed-in",
      load: "loaded",
    })
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")

    client.setAccount({ kind: "signed-in", userId: "user-a" })
    client.release()
    expect(calls.map((call) => call.request.method)).toEqual(["GET", "POST"])
    expect(calls[1]!.request).toMatchObject({
      subject: "user-a",
      body: {
        expectedRevision: 3,
        resumeCardId: "back-carrying",
        completedStepIds: ["back-how"],
      },
    })
    calls[1]!.resolve({
      status: 200,
      body: {
        status: "saved",
        progress: saved({ resumeCardId: "back-carrying", revision: 4 }),
      },
    })
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saved",
      resumeCardId: "back-carrying",
    })
  })

  it.each(["debounce", "pagehide"] as const)(
    "keeps a held reset ahead of passive resume via %s",
    async (delivery) => {
      vi.useFakeTimers()
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [saved({ completed: true })])
      client.hold()
      client.reset("lesson-1")
      client.setResume("lesson-1", "back-carrying")
      if (delivery === "debounce") await vi.advanceTimersByTimeAsync(1500)
      else client.flush({ keepalive: true })
      expect(calls).toHaveLength(1)
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      client.release()
      expect(calls.map((call) => call.request.method)).toEqual([
        "GET",
        "DELETE",
      ])
      expect(calls[1]!.request).toMatchObject({
        subject: "user-a",
        body: { ...KEY, lessonId: "lesson-1", expectedRevision: 3 },
      })
      calls[1]!.resolve({
        status: 200,
        body: { status: "saved", progress: lesson({ revision: 4 }) },
      })
      await flush()
      await vi.advanceTimersByTimeAsync(2000)
      client.flush()
      expect(calls).toHaveLength(2)
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "saved",
        completedStepIds: [],
        completed: false,
        resumeCardId: null,
      })
    },
  )

  it.each([
    { reset: false, releaseBeforeAck: false },
    { reset: false, releaseBeforeAck: true },
    { reset: true, releaseBeforeAck: false },
    { reset: true, releaseBeforeAck: true },
  ])(
    "keeps a held continuation after its own POST (reset=$reset, releaseBeforeAck=$releaseBeforeAck)",
    async ({ reset, releaseBeforeAck }) => {
      vi.useFakeTimers()
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      // No change()/save(): this loaded lesson stays unarmed.
      await signIn(client, calls, [saved({ completed: true })])
      client.setResume("lesson-1", "back-carrying")
      await vi.advanceTimersByTimeAsync(1500)
      expect(calls[1]!.request).toMatchObject({
        method: "POST",
        body: { expectedRevision: 3, resumeCardId: "back-carrying" },
      })
      client.hold()
      if (reset) client.reset("lesson-1")
      client.setResume("lesson-1", "back-give")
      await vi.advanceTimersByTimeAsync(1500)
      if (releaseBeforeAck) {
        client.setAccount({ kind: "signed-in", userId: "user-a" })
        client.release()
      }
      expect(calls).toHaveLength(2)
      calls[1]!.resolve({
        status: 200,
        body: {
          status: "saved",
          progress: saved({
            completed: true,
            resumeCardId: "back-carrying",
            revision: 4,
          }),
        },
      })
      await flush()
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "saving",
        resumeCardId: "back-give",
        completedStepIds: ["back-how"],
        completed: true,
      })
      if (!releaseBeforeAck) {
        expect(calls).toHaveLength(2)
        client.setAccount({ kind: "signed-in", userId: "user-a" })
        client.release()
      }
      expect(calls).toHaveLength(3)
      expect(calls[2]!.request).toMatchObject({
        method: reset ? "DELETE" : "POST",
        subject: "user-a",
        body: {
          expectedRevision: 4,
          ...(reset
            ? {}
            : {
                resumeCardId: "back-give",
                completedStepIds: ["back-how"],
                completed: true,
              }),
        },
      })
      calls[2]!.resolve({
        status: 200,
        body: {
          status: "saved",
          progress: reset
            ? lesson({ revision: 5 })
            : saved({
                completed: true,
                resumeCardId: "back-give",
                revision: 5,
              }),
        },
      })
      await flush()
      client.flush({ keepalive: true })
      await vi.advanceTimersByTimeAsync(2000)
      expect(calls).toHaveLength(3)
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "saved",
        completedStepIds: reset ? [] : ["back-how"],
        completed: !reset,
        resumeCardId: reset ? null : "back-give",
      })
    },
  )

  it("keeps a queued reset after its own POST even when that acknowledgement clears local", async () => {
    vi.useFakeTimers()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [saved({ completed: true })])
    client.setResume("lesson-1", "back-carrying")
    await vi.advanceTimersByTimeAsync(1500)
    client.hold()
    client.reset("lesson-1")
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    client.release()
    expect(calls).toHaveLength(2)
    calls[1]!.resolve({
      status: 200,
      body: {
        status: "saved",
        progress: saved({
          completed: true,
          resumeCardId: "back-carrying",
          revision: 4,
        }),
      },
    })
    await flush()
    expect(calls.map((call) => call.request.method)).toEqual([
      "GET",
      "POST",
      "DELETE",
    ])
    expect(calls[2]!.request).toMatchObject({ body: { expectedRevision: 4 } })
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
    calls[2]!.resolve({
      status: 200,
      body: { status: "saved", progress: lesson({ revision: 5 }) },
    })
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saved",
      completedStepIds: [],
      completed: false,
      resumeCardId: null,
    })
  })

  it("does not carry a held resume across an independently newer read before its old POST acknowledgement", async () => {
    vi.useFakeTimers()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [saved()])
    client.setResume("lesson-1", "back-carrying")
    await vi.advanceTimersByTimeAsync(1500)
    client.hold()
    client.setResume("lesson-1", "back-give")
    await vi.advanceTimersByTimeAsync(1500)
    client.refresh()
    expect(calls[2]!.request.method).toBe("GET")
    calls[2]!.resolve({
      status: 200,
      body: {
        authenticated: true,
        userId: "user-a",
        lessons: [saved({ completedStepIds: [], revision: 5 })],
      },
    })
    await flush()
    calls[1]!.resolve({
      status: 200,
      body: {
        status: "saved",
        progress: saved({ resumeCardId: "back-carrying", revision: 4 }),
      },
    })
    await flush()
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    client.release()
    client.flush()
    await vi.advanceTimersByTimeAsync(2000)
    expect(calls.map((call) => call.request.method)).toEqual([
      "GET",
      "POST",
      "GET",
    ])
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "unsaved",
      resumeCardId: "back-give",
    })
  })

  it("lets its own DELETE acknowledgement supersede an older held resume", async () => {
    vi.useFakeTimers()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [saved({ completed: true })])
    client.reset("lesson-1")
    expect(calls[1]!.request.method).toBe("DELETE")
    client.hold()
    client.setResume("lesson-1", "back-give")
    await vi.advanceTimersByTimeAsync(1500)
    calls[1]!.resolve({
      status: 200,
      body: { status: "saved", progress: lesson({ revision: 4 }) },
    })
    await flush()
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    client.release()
    client.flush()
    expect(calls.map((call) => call.request.method)).toEqual(["GET", "DELETE"])
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saved",
      completedStepIds: [],
      completed: false,
      resumeCardId: null,
    })
  })

  it.each(["failure", "conflict"] as const)(
    "keeps the held reset as the explicit choice after its predecessor %s",
    async (outcome) => {
      vi.useFakeTimers()
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [saved({ completed: true })])
      client.setResume("lesson-1", "back-carrying")
      await vi.advanceTimersByTimeAsync(1500)
      client.hold()
      client.reset("lesson-1")
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      client.release()
      calls[1]!.resolve(
        outcome === "conflict"
          ? {
              status: 200,
              body: { status: "conflict", progress: saved({ revision: 4 }) },
            }
          : { status: 503, body: { error: "unavailable" } },
      )
      await flush()
      expect(calls).toHaveLength(2)
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: outcome === "conflict" ? "conflict" : "error",
        operation: "reset",
      })
      // Neither release nor pagehide answers the newly reported failure.
      client.hold()
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      client.release()
      client.flush({ keepalive: true })
      expect(calls).toHaveLength(2)
      if (outcome === "conflict") client.keepMine("lesson-1")
      else client.retry("lesson-1")
      expect(calls[2]!.request).toMatchObject({
        method: "DELETE",
        subject: "user-a",
        body: { expectedRevision: outcome === "conflict" ? 4 : 3 },
      })
      calls[2]!.resolve({
        status: 200,
        body: {
          status: "saved",
          progress: lesson({ revision: outcome === "conflict" ? 5 : 4 }),
        },
      })
      await flush()
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "saved",
        completedStepIds: [],
        completed: false,
        resumeCardId: null,
      })
    },
  )

  it("reads Saved only while no resume write waits for the account", async () => {
    vi.useFakeTimers()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [saved()])
    // The saved position again: nothing to write, still Saved.
    client.setResume("lesson-1", "back-how")
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saved")
    client.setResume("lesson-1", "back-carrying")
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
    // Back to the saved card before the write: Saving until the coalesced
    // write finds nothing to send, then Saved with no request.
    client.setResume("lesson-1", "back-how")
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
    await vi.advanceTimersByTimeAsync(1500)
    expect(calls).toHaveLength(1)
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saved",
      resumeCardId: "back-how",
    })
  })

  it("holds an explicit change as Saving, never Saved, until the same account is confirmed", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [saved()])
    client.hold()
    client.change("lesson-1", {
      completedStepIds: ["back-how", "back-give"],
      completed: false,
    })
    expect(calls).toHaveLength(1)
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    client.release()
    expect(calls.map((call) => call.request.method)).toEqual(["GET", "POST"])
    expect(calls[1]!.request).toMatchObject({
      body: {
        expectedRevision: 3,
        completedStepIds: ["back-how", "back-give"],
      },
    })
  })

  it("discards held writes when another account is confirmed, and ignores the old account's late answers", async () => {
    vi.useFakeTimers()
    const { calls, transport } = fakeTransport()
    const cleared = vi.fn()
    const client = createLearningProgressClient({
      transport,
      onAccountCleared: cleared,
    })
    await signIn(client, calls, [saved()])
    client.change("lesson-2", { completedStepIds: [], completed: true })
    const late = calls.at(-1)!
    expect(late.request.method).toBe("POST")
    client.setResume("lesson-1", "back-carrying")
    client.hold()
    client.setAccount({ kind: "signed-in", userId: "user-b" })
    client.release()
    expect(cleared).toHaveBeenCalledTimes(1)
    late.resolve({
      status: 200,
      body: {
        status: "saved",
        progress: lesson({
          lessonId: "lesson-2",
          completed: true,
          revision: 1,
        }),
      },
    })
    calls.at(-1)!.resolve({
      status: 200,
      body: { authenticated: true, userId: "user-b", lessons: [] },
    })
    await flush()
    await vi.advanceTimersByTimeAsync(2000)
    client.flush()
    expect(calls.map((call) => call.request.method)).toEqual([
      "GET",
      "POST",
      "GET",
    ])
    expect(client.getSnapshot().lessons).toMatchObject({
      "lesson-1": { status: "idle", resumeCardId: null },
      "lesson-2": { status: "idle", completed: false },
    })
  })

  it("keeps a conflict and its choice visible through the hold, sending nothing until the visitor chooses", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [saved()])
    client.change("lesson-1", {
      completedStepIds: ["back-how", "back-give"],
      completed: false,
    })
    calls[1]!.resolve({
      status: 200,
      body: { status: "conflict", progress: saved({ revision: 5 }) },
    })
    await flush()
    client.hold()
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("conflict")
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    client.release()
    expect(calls).toHaveLength(2)
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("conflict")

    // The choice made during a later hold is kept and sent once confirmed.
    client.hold()
    client.keepMine("lesson-1")
    expect(calls).toHaveLength(2)
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    client.release()
    expect(calls[2]!.request).toMatchObject({
      method: "POST",
      body: {
        expectedRevision: 5,
        completedStepIds: ["back-how", "back-give"],
      },
    })
  })

  it("does not let a resume write held across a conflict send that conflict without a choice", async () => {
    vi.useFakeTimers()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [saved()])
    client.change("lesson-1", {
      completedStepIds: ["back-how", "back-give"],
      completed: false,
    })
    // Reading on while the save is in flight schedules a resume write.
    client.setResume("lesson-1", "back-carrying")
    client.hold()
    calls[1]!.resolve({
      status: 200,
      body: { status: "conflict", progress: saved({ revision: 5 }) },
    })
    await flush()
    await vi.advanceTimersByTimeAsync(2000)
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    client.release()
    expect(calls).toHaveLength(2)
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("conflict")
  })

  it("never lets an older read overwrite a newer revision a save returned", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [lesson({ revision: 1 })])
    client.change("lesson-1", {
      completedStepIds: ["back-how"],
      completed: false,
    })
    client.refresh()
    const [post, read] = [calls[1]!, calls[2]!]
    expect(read.request.method).toBe("GET")
    post.resolve({
      status: 200,
      body: {
        status: "saved",
        progress: lesson({ completedStepIds: ["back-how"], revision: 2 }),
      },
    })
    await flush()
    read.resolve({
      status: 200,
      body: {
        authenticated: true,
        userId: "user-a",
        lessons: [lesson({ revision: 1 })],
      },
    })
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saved",
      completedStepIds: ["back-how"],
    })
    client.change("lesson-1", {
      completedStepIds: ["back-how", "back-give"],
      completed: false,
    })
    expect(calls.at(-1)!.request).toMatchObject({
      method: "POST",
      body: { expectedRevision: 2 },
    })
  })

  it("re-sends a resume write cut off by an unconfirmed session once a re-read shows the same revision", async () => {
    vi.useFakeTimers()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [saved()])
    client.setResume("lesson-1", "back-carrying")
    client.setAccount({ kind: "unavailable" })
    await vi.advanceTimersByTimeAsync(2000)
    expect(calls).toHaveLength(1)
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    calls.at(-1)!.resolve({
      status: 200,
      body: { authenticated: true, userId: "user-a", lessons: [saved()] },
    })
    await flush()
    expect(calls.map((call) => call.request.method)).toEqual([
      "GET",
      "GET",
      "POST",
    ])
    expect(calls[2]!.request).toMatchObject({
      body: { expectedRevision: 3, resumeCardId: "back-carrying" },
    })
  })

  it("does not send a cut-off resume write over progress that changed meanwhile", async () => {
    vi.useFakeTimers()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [saved()])
    client.setResume("lesson-1", "back-carrying")
    client.setAccount({ kind: "unavailable" })
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    calls.at(-1)!.resolve({
      status: 200,
      body: {
        authenticated: true,
        userId: "user-a",
        lessons: [saved({ completedStepIds: [], revision: 4 })],
      },
    })
    await flush()
    await vi.advanceTimersByTimeAsync(2000)
    expect(calls.map((call) => call.request.method)).toEqual(["GET", "GET"])
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("unsaved")
  })
})

describe("hosted sign-in return", () => {
  const page = "https://watch.test/watch?as=grow#steps"

  it("carries only lesson and card ids and strips failure markers", () => {
    const login = new URL(
      watchGrowLoginUrl(
        "lesson-1",
        "up-question-2",
        "https://watch.test/watch/api/auth/login?returnTo=%2Fold",
        "https://watch.test/watch?as=share&auth=failed&reason=x#steps",
      ),
    )
    expect(login.origin + login.pathname).toBe(
      "https://watch.test/watch/api/auth/login",
    )
    expect(login.searchParams.get("returnTo")).toBe(
      "/watch?as=grow&growLesson=lesson-1&growCard=up-question-2#steps",
    )
    expect([...login.searchParams.keys()]).toEqual(["returnTo"])
  })

  it("never sends the visitor to a foreign login base", () => {
    const login = new URL(
      watchGrowLoginUrl("lesson-1", null, "https://evil.test/login", page),
    )
    expect(login.origin).toBe("https://watch.test")
    expect(login.searchParams.get("returnTo")).toBe(
      "/watch?as=grow&growLesson=lesson-1#steps",
    )
  })

  it("reads a valid return, drops an unknown card, and reports cancellation", () => {
    expect(
      readWatchGrowReturn(
        "https://watch.test/watch?growLesson=lesson-1&growCard=end&auth=failed&reason=access_denied",
      ),
    ).toEqual({ lessonId: "lesson-1", cardId: "end", authFailed: true })
    expect(
      readWatchGrowReturn(
        "https://watch.test/watch?growLesson=lesson-4&growCard=up-truth-1",
      ),
    ).toEqual({ lessonId: "lesson-4", cardId: null, authFailed: false })
    expect(readWatchGrowReturn("https://watch.test/watch?growLesson=x")).toBe(
      null,
    )
    expect(
      withoutWatchGrowReturn(
        "https://watch.test/watch?as=grow&growLesson=lesson-1&growCard=end&auth=failed#steps",
      ),
    ).toBe("/watch?as=grow#steps")
  })
})
