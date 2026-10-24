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
      status: "conflict",
      operation: "save",
      resumeCardId: "back-give",
    })
  })

  it.each([
    { hold: false, releaseBeforeRead: false },
    { hold: true, releaseBeforeRead: false },
    { hold: true, releaseBeforeRead: true },
  ])(
    "requires a choice for an unavailable-identity edit after a newer reset (hold=$hold, releaseBeforeRead=$releaseBeforeRead)",
    async ({ hold, releaseBeforeRead }) => {
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [saved({ completed: true })])
      if (hold) client.hold()
      client.setAccount({ kind: "unavailable" })
      client.change("lesson-1", {
        completedStepIds: ["back-how", "back-give"],
        completed: true,
      })
      expect(calls).toHaveLength(1)
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      if (releaseBeforeRead) client.release()
      calls[1]!.resolve({
        status: 200,
        body: {
          authenticated: true,
          userId: "user-a",
          lessons: [lesson({ revision: 4 })],
        },
      })
      await flush()
      if (!releaseBeforeRead) client.release()
      // Later edits and pagehide cannot answer the choice.
      client.change("lesson-1", {
        completedStepIds: ["back-how"],
        completed: true,
      })
      client.flush({ keepalive: true })
      expect(calls.map((call) => call.request.method)).toEqual(["GET", "GET"])
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "conflict",
        operation: "save",
        completed: true,
      })
      client.keepMine("lesson-1")
      expect(calls[2]!.request).toMatchObject({
        method: "POST",
        body: { expectedRevision: 4, completed: true },
      })
    },
  )

  it.each(["checking", "unavailable"] as const)(
    "replays an edit held by %s only when the same account still has its base revision",
    async (kind) => {
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [saved()])
      client.setAccount({ kind })
      client.change("lesson-1", {
        completedStepIds: ["back-give"],
        completed: true,
      })
      expect(calls).toHaveLength(1)
      await signIn(client, calls, [saved()])
      expect(calls.map((call) => call.request.method)).toEqual([
        "GET",
        "GET",
        "POST",
      ])
      expect(calls[2]!.request).toMatchObject({
        method: "POST",
        body: {
          expectedRevision: 3,
          completedStepIds: ["back-give"],
          completed: true,
        },
      })
    },
  )

  it.each(["anonymous", "other-user"] as const)(
    "discards an unavailable-identity edit when the next identity is %s",
    async (next) => {
      const { calls, transport } = fakeTransport()
      const onAccountCleared = vi.fn()
      const client = createLearningProgressClient({
        transport,
        onAccountCleared,
      })
      await signIn(client, calls, [saved({ completed: true })])
      client.setAccount({ kind: "unavailable" })
      client.change("lesson-1", {
        completedStepIds: ["back-give"],
        completed: true,
      })
      if (next === "anonymous") client.setAccount({ kind: "anonymous" })
      else await signIn(client, calls, [], "user-b")
      client.release()
      client.flush({ keepalive: true })
      expect(calls.map((call) => call.request.method)).toEqual(
        next === "anonymous" ? ["GET"] : ["GET", "GET"],
      )
      expect(onAccountCleared).toHaveBeenCalledOnce()
      expect(client.getSnapshot().lessons["lesson-1"]?.completed).not.toBe(true)
    },
  )

  it.each([
    { continuation: "none", releaseBeforeAck: false },
    { continuation: "none", releaseBeforeAck: true },
    { continuation: "save", releaseBeforeAck: false },
    { continuation: "save", releaseBeforeAck: true },
    { continuation: "reset", releaseBeforeAck: false },
    { continuation: "reset", releaseBeforeAck: true },
  ] as const)(
    "rejects a stale POST acknowledgement after a rev5 reset (continuation=$continuation, releaseBeforeAck=$releaseBeforeAck)",
    async ({ continuation, releaseBeforeAck }) => {
      vi.useFakeTimers()
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [saved({ completed: true })])
      client.change("lesson-1", {
        completedStepIds: ["back-how", "back-give"],
        completed: true,
      })
      client.hold()
      if (continuation === "reset") client.reset("lesson-1")
      if (continuation === "save") {
        client.change("lesson-1", {
          completedStepIds: ["back-give"],
          completed: true,
        })
      }
      client.refresh()
      calls[2]!.resolve({
        status: 200,
        body: {
          authenticated: true,
          userId: "user-a",
          lessons: [lesson({ revision: 5 })],
        },
      })
      await flush()
      if (releaseBeforeAck) client.release()
      calls[1]!.resolve({
        status: 200,
        body: {
          status: "saved",
          progress: saved({
            completedStepIds: ["back-how", "back-give"],
            completed: true,
            revision: 4,
          }),
        },
      })
      await flush()
      if (!releaseBeforeAck) client.release()
      client.flush({ keepalive: true })
      await vi.advanceTimersByTimeAsync(2000)
      expect(calls.map((call) => call.request.method)).toEqual([
        "GET",
        "POST",
        "GET",
      ])
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "conflict",
        operation: continuation === "reset" ? "reset" : "save",
        completedStepIds:
          continuation === "save" ? ["back-give"] : ["back-how", "back-give"],
        completed: true,
      })
      if (continuation === "reset") {
        client.keepMine("lesson-1")
        expect(calls[3]!.request).toMatchObject({
          method: "DELETE",
          body: { expectedRevision: 5 },
        })
      } else {
        client.useSaved("lesson-1")
        expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
          status: "saved",
          completedStepIds: [],
          completed: false,
          resumeCardId: null,
        })
        client.change("lesson-1", {
          completedStepIds: ["back-how"],
          completed: false,
        })
        expect(calls[3]!.request).toMatchObject({
          method: "POST",
          body: { expectedRevision: 5, completed: false },
        })
      }
    },
  )

  it("does not replace a newer read with an older DELETE acknowledgement", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [saved({ completed: true })])
    client.reset("lesson-1")
    client.refresh()
    calls[2]!.resolve({
      status: 200,
      body: {
        authenticated: true,
        userId: "user-a",
        lessons: [saved({ completedStepIds: ["back-give"], revision: 5 })],
      },
    })
    await flush()
    calls[1]!.resolve({
      status: 200,
      body: { status: "saved", progress: lesson({ revision: 4 }) },
    })
    await flush()
    expect(calls).toHaveLength(3)
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "conflict",
      operation: "reset",
      completedStepIds: ["back-give"],
    })
    client.useSaved("lesson-1")
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saved",
      completedStepIds: ["back-give"],
    })
  })

  it.each(["save", "reset"] as const)(
    "lets Use saved retire an in-flight %s before a new explicit edit",
    async (operation) => {
      vi.useFakeTimers()
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [saved({ completed: true })])
      if (operation === "reset") client.reset("lesson-1")
      else
        client.change("lesson-1", {
          completedStepIds: ["back-give"],
          completed: true,
        })
      client.hold()
      client.setResume("lesson-1", "back-carrying")
      await vi.advanceTimersByTimeAsync(1500)
      client.refresh()
      calls[2]!.resolve({
        status: 200,
        body: {
          authenticated: true,
          userId: "user-a",
          lessons: [lesson({ revision: 5 })],
        },
      })
      await flush()
      expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("conflict")
      client.useSaved("lesson-1")
      client.release()
      client.change("lesson-1", {
        completedStepIds: ["back-how"],
        completed: false,
      })
      expect(calls).toHaveLength(4)
      expect(calls[3]!.request).toMatchObject({
        method: "POST",
        body: {
          expectedRevision: 5,
          completedStepIds: ["back-how"],
          completed: false,
        },
      })
      calls[1]!.resolve({
        status: 200,
        body: { status: "saved", progress: lesson({ revision: 4 }) },
      })
      await flush()
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "saving",
        completedStepIds: ["back-how"],
      })
      calls[3]!.resolve({
        status: 200,
        body: {
          status: "saved",
          progress: lesson({ completedStepIds: ["back-how"], revision: 6 }),
        },
      })
      await flush()
      expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saved")
      expect(calls).toHaveLength(4)
    },
  )

  it("saves resume navigation made after its own DELETE dispatch", async () => {
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
    expect(calls.map((call) => call.request.method)).toEqual([
      "GET",
      "DELETE",
      "POST",
    ])
    expect(calls[2]!.request).toMatchObject({
      method: "POST",
      body: {
        expectedRevision: 4,
        completedStepIds: [],
        completed: false,
        resumeCardId: "back-give",
      },
    })
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saving",
      completedStepIds: [],
      completed: false,
      resumeCardId: "back-give",
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
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("conflict")
  })
})

describe("resume lineage across identity checks", () => {
  const identities = ["checking", "unavailable"] as const
  const stored = (overrides: Record<string, unknown> = {}) =>
    lesson({
      completedStepIds: ["back-how", "back-give"],
      completed: true,
      resumeCardId: "back-how",
      revision: 4,
      ...overrides,
    })

  async function setup(armed = true) {
    vi.useFakeTimers()
    const { calls, transport } = fakeTransport()
    const onAccountCleared = vi.fn()
    const client = createLearningProgressClient({ transport, onAccountCleared })
    if (armed) {
      // Exact review repro: completed rev3, then an explicit acknowledged rev4.
      await signIn(client, calls, [
        stored({ completedStepIds: ["back-how"], revision: 3 }),
      ])
      client.change("lesson-1", {
        completedStepIds: ["back-how", "back-give"],
        completed: true,
      })
      calls
        .at(-1)!
        .resolve({ status: 200, body: { status: "saved", progress: stored() } })
      await flush()
    } else await signIn(client, calls, [stored()])
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saved")
    return { client, calls, onAccountCleared }
  }

  function answerRead(calls: Call[], progress: unknown) {
    expect(calls.at(-1)!.request.method).toBe("GET")
    calls.at(-1)!.resolve({
      status: 200,
      body: { authenticated: true, userId: "user-a", lessons: [progress] },
    })
  }

  const cases = identities.flatMap((kind) =>
    [false, true].flatMap((armed) =>
      [false, true].flatMap((withChange) =>
        [false, true].map((releaseBeforeRead) => ({
          kind,
          armed,
          withChange,
          releaseBeforeRead,
        })),
      ),
    ),
  )

  it.each(cases)(
    "requires explicit recovery after an independent reset (identity=$kind, armed=$armed, change=$withChange, releaseBeforeRead=$releaseBeforeRead)",
    async ({ kind, armed, withChange, releaseBeforeRead }) => {
      const { client, calls } = await setup(armed)
      const before = calls.length
      client.hold()
      client.setAccount({ kind })
      if (withChange)
        client.change("lesson-1", {
          completedStepIds: ["back-give"],
          completed: true,
        })
      client.setResume("lesson-1", "up-watch")
      await vi.advanceTimersByTimeAsync(2000)
      client.flush({ keepalive: true })
      expect(calls).toHaveLength(before)
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      if (releaseBeforeRead) client.release()
      answerRead(calls, lesson({ revision: 5 }))
      await flush()
      if (!releaseBeforeRead) client.release()
      await vi.advanceTimersByTimeAsync(2000)
      client.flush()
      expect(calls).toHaveLength(before + 1)
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "conflict",
        operation: "save",
        completed: true,
        completedStepIds: withChange
          ? ["back-give"]
          : ["back-how", "back-give"],
        resumeCardId: "up-watch",
      })
      // Neither another read nor passive navigation answers the choice.
      client.setResume("lesson-1", "end")
      client.refresh()
      answerRead(calls, lesson({ revision: 5 }))
      await flush()
      expect(calls).toHaveLength(before + 2)
      expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("conflict")
      if (releaseBeforeRead) {
        client.keepMine("lesson-1")
        expect(calls.at(-1)!.request).toMatchObject({
          method: "POST",
          body: { expectedRevision: 5, completed: true, resumeCardId: "end" },
        })
        calls.at(-1)!.resolve({
          status: 200,
          body: {
            status: "saved",
            progress: stored({
              completedStepIds: withChange
                ? ["back-give"]
                : ["back-how", "back-give"],
              resumeCardId: "end",
              revision: 6,
            }),
          },
        })
        await flush()
        expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saved")
      } else {
        client.useSaved("lesson-1")
        expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
          status: "saved",
          completed: false,
          completedStepIds: [],
          resumeCardId: null,
        })
        expect(calls).toHaveLength(before + 2)
      }
    },
  )

  it.each(cases)(
    "saves held resume only after acknowledgement when the revision is unchanged (identity=$kind, armed=$armed, change=$withChange, releaseBeforeRead=$releaseBeforeRead)",
    async ({ kind, armed, withChange, releaseBeforeRead }) => {
      const { client, calls } = await setup(armed)
      const before = calls.length
      client.hold()
      client.setAccount({ kind })
      if (withChange)
        client.change("lesson-1", {
          completedStepIds: ["back-give"],
          completed: true,
        })
      client.setResume("lesson-1", "up-watch")
      expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      if (releaseBeforeRead) client.release()
      answerRead(calls, stored())
      await flush()
      if (!releaseBeforeRead) {
        expect(calls).toHaveLength(before + 1)
        expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
        client.release()
      }
      expect(calls).toHaveLength(before + 2)
      expect(calls.at(-1)!.request).toMatchObject({
        method: "POST",
        body: {
          expectedRevision: 4,
          completed: true,
          completedStepIds: withChange
            ? ["back-give"]
            : ["back-how", "back-give"],
          resumeCardId: "up-watch",
        },
      })
      expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
      calls.at(-1)!.resolve({
        status: 200,
        body: {
          status: "saved",
          progress: stored({
            completedStepIds: withChange
              ? ["back-give"]
              : ["back-how", "back-give"],
            resumeCardId: "up-watch",
            revision: 5,
          }),
        },
      })
      await flush()
      expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saved")
      // Later legitimate navigation still uses the ordinary resume debounce.
      client.setResume("lesson-1", "end")
      await vi.advanceTimersByTimeAsync(1500)
      expect(calls).toHaveLength(before + 3)
      expect(calls.at(-1)!.request).toMatchObject({
        method: "POST",
        body: { expectedRevision: 5, resumeCardId: "end" },
      })
    },
  )

  it.each(
    identities.flatMap((kind) =>
      [false, true].map((duringRead) => ({ kind, duringRead })),
    ),
  )(
    "retains the resume base without a focus hold (identity=$kind, duringRead=$duringRead)",
    async ({ kind, duringRead }) => {
      const { client, calls } = await setup()
      const before = calls.length
      client.setAccount({ kind })
      if (!duringRead) client.setResume("lesson-1", "up-watch")
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      if (duringRead) client.setResume("lesson-1", "up-watch")
      answerRead(calls, lesson({ revision: 5 }))
      await flush()
      expect(calls).toHaveLength(before + 1)
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "conflict",
        completed: true,
        resumeCardId: "up-watch",
      })
    },
  )
  const orders = identities.flatMap((kind) =>
    [false, true].map((releaseBeforeAck) => ({ kind, releaseBeforeAck })),
  )

  it.each(orders)(
    "continues resume after its own POST without stranding it (identity=$kind, releaseBeforeAck=$releaseBeforeAck)",
    async ({ kind, releaseBeforeAck }) => {
      const { client, calls } = await setup(false)
      client.setResume("lesson-1", "back-carrying")
      await vi.advanceTimersByTimeAsync(1500)
      const post = calls.at(-1)!
      client.hold()
      client.setAccount({ kind })
      client.setResume("lesson-1", "up-watch")
      const acknowledged = stored({
        resumeCardId: "back-carrying",
        revision: 5,
      })
      if (!releaseBeforeAck) {
        post.resolve({
          status: 200,
          body: { status: "saved", progress: acknowledged },
        })
        await flush()
      }
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      answerRead(calls, releaseBeforeAck ? stored() : acknowledged)
      await flush()
      expect(calls).toHaveLength(3)
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "saving",
        resumeCardId: "up-watch",
      })
      client.release()
      if (releaseBeforeAck) {
        expect(calls).toHaveLength(3)
        post.resolve({
          status: 200,
          body: { status: "saved", progress: acknowledged },
        })
        await flush()
      }
      expect(calls).toHaveLength(4)
      expect(calls.at(-1)!.request).toMatchObject({
        method: "POST",
        body: {
          expectedRevision: 5,
          completed: true,
          resumeCardId: "up-watch",
        },
      })
      calls.at(-1)!.resolve({
        status: 200,
        body: {
          status: "saved",
          progress: stored({ resumeCardId: "up-watch", revision: 6 }),
        },
      })
      await flush()
      client.flush()
      expect(calls).toHaveLength(4)
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "saved",
        resumeCardId: "up-watch",
      })
    },
  )

  it.each(orders)(
    "does not let a stale POST acknowledge held resume or undo Use saved (identity=$kind, releaseBeforeAck=$releaseBeforeAck)",
    async ({ kind, releaseBeforeAck }) => {
      const { client, calls } = await setup(false)
      client.setResume("lesson-1", "back-carrying")
      await vi.advanceTimersByTimeAsync(1500)
      const post = calls.at(-1)!
      client.hold()
      client.setAccount({ kind })
      client.setResume("lesson-1", "up-watch")
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      answerRead(calls, lesson({ revision: 6 }))
      await flush()
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "conflict",
        resumeCardId: "up-watch",
        completed: true,
      })
      client.useSaved("lesson-1")
      if (releaseBeforeAck) client.release()
      post.resolve({
        status: 200,
        body: {
          status: "saved",
          progress: stored({ resumeCardId: "back-carrying", revision: 5 }),
        },
      })
      await flush()
      if (!releaseBeforeAck) client.release()
      expect(calls).toHaveLength(3)
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "saved",
        completed: false,
        completedStepIds: [],
        resumeCardId: null,
      })
      client.change("lesson-1", {
        completedStepIds: ["back-give"],
        completed: false,
      })
      expect(calls.at(-1)!.request).toMatchObject({
        method: "POST",
        body: { expectedRevision: 6, completed: false },
      })
    },
  )

  it.each(
    identities.flatMap((kind) =>
      ["anonymous", "user-b"].map((next) => ({ kind, next })),
    ),
  )(
    "discards held resume on account transition (identity=$kind, next=$next)",
    async ({ kind, next }) => {
      const { client, calls, onAccountCleared } = await setup()
      const before = calls.length
      client.hold()
      client.setAccount({ kind })
      client.setResume("lesson-1", "up-watch")
      if (next === "anonymous") client.setAccount({ kind: "anonymous" })
      else await signIn(client, calls, [], next)
      client.release()
      client.flush({ keepalive: true })
      await vi.advanceTimersByTimeAsync(2000)
      expect(calls).toHaveLength(before + (next === "anonymous" ? 0 : 1))
      expect(onAccountCleared).toHaveBeenCalledOnce()
      expect(client.getSnapshot().lessons["lesson-1"]?.completed).not.toBe(true)
      expect(client.getSnapshot().lessons["lesson-1"]?.resumeCardId).not.toBe(
        "up-watch",
      )
    },
  )

  it.each(orders)(
    "keeps a held reset and its Retry ahead of resume (identity=$kind, releaseBeforeAck=$releaseBeforeAck)",
    async ({ kind, releaseBeforeAck: releaseBeforeRead }) => {
      const { client, calls } = await setup()
      const before = calls.length
      client.hold()
      client.reset("lesson-1")
      client.setAccount({ kind })
      client.setResume("lesson-1", "up-watch")
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      if (releaseBeforeRead) client.release()
      answerRead(calls, stored())
      await flush()
      if (!releaseBeforeRead) {
        expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
        client.release()
      }
      expect(calls).toHaveLength(before + 2)
      expect(calls.at(-1)!.request).toMatchObject({
        method: "DELETE",
        body: { expectedRevision: 4 },
      })
      calls.at(-1)!.resolve({ status: 503, body: null })
      await flush()
      client.setResume("lesson-1", "end")
      client.refresh()
      answerRead(calls, stored())
      await flush()
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "error",
        operation: "reset",
      })
      client.retry("lesson-1")
      expect(calls).toHaveLength(before + 4)
      expect(calls.at(-1)!.request).toMatchObject({
        method: "DELETE",
        body: { expectedRevision: 4 },
      })
      calls.at(-1)!.resolve({
        status: 200,
        body: { status: "saved", progress: lesson({ revision: 5 }) },
      })
      await flush()
      // Navigation after DELETE dispatch (including its failed attempt) is
      // later intent. Retry resets first, then saves that position alone.
      expect(calls.at(-1)!.request).toMatchObject({
        method: "POST",
        body: {
          expectedRevision: 5,
          completed: false,
          completedStepIds: [],
          resumeCardId: "end",
        },
      })
      expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
      calls.at(-1)!.resolve({
        status: 200,
        body: {
          status: "saved",
          progress: lesson({ revision: 6, resumeCardId: "end" }),
        },
      })
      await flush()
      await vi.advanceTimersByTimeAsync(2000)
      client.flush()
      expect(calls).toHaveLength(before + 5)
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "saved",
        completed: false,
        completedStepIds: [],
        resumeCardId: "end",
      })
    },
  )

  it.each(identities)(
    "recovers held resume after a failed read and write only through Retry (identity=%s)",
    async (kind) => {
      const { client, calls } = await setup(false)
      client.setAccount({ kind })
      client.setResume("lesson-1", "up-watch")
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      calls.at(-1)!.reject(new Error("offline"))
      await flush()
      expect(client.getSnapshot()).toMatchObject({
        load: "error",
        lessons: { "lesson-1": { status: "error", resumeCardId: "up-watch" } },
      })
      client.retry("lesson-1")
      answerRead(calls, stored())
      await flush()
      expect(calls).toHaveLength(4)
      expect(calls.at(-1)!.request).toMatchObject({
        method: "POST",
        body: { expectedRevision: 4, resumeCardId: "up-watch" },
      })
      calls.at(-1)!.resolve({ status: 503, body: null })
      await flush()
      client.setResume("lesson-1", "end")
      client.refresh()
      answerRead(calls, stored())
      await flush()
      expect(calls).toHaveLength(5)
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "error",
        operation: "save",
      })
      client.retry("lesson-1")
      expect(calls.at(-1)!.request).toMatchObject({
        method: "POST",
        body: { expectedRevision: 4, resumeCardId: "end" },
      })
      calls.at(-1)!.resolve({
        status: 200,
        body: {
          status: "saved",
          progress: stored({ resumeCardId: "end", revision: 5 }),
        },
      })
      await flush()
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "saved",
        resumeCardId: "end",
      })
    },
  )
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

describe("reset operation ownership", () => {
  const stored = () =>
    lesson({
      completedStepIds: ["back-how"],
      completed: true,
      resumeCardId: "end",
      revision: 3,
    })
  const orders = (["checking", "unavailable"] as const).flatMap((kind) =>
    [false, true].flatMap((readBeforeError) =>
      [false, true].map((releaseBeforeError) => ({
        kind,
        readBeforeError,
        releaseBeforeError,
      })),
    ),
  )
  const read = (call: Call, progress = stored()) =>
    call.resolve({
      status: 200,
      body: { authenticated: true, userId: "user-a", lessons: [progress] },
    })
  const ack = (call: Call, progress = lesson({ revision: 4 })) =>
    call.resolve({ status: 200, body: { status: "saved", progress } })

  it.each(orders)(
    "retains DELETE Retry through GET (identity=$kind, readBeforeError=$readBeforeError, releaseBeforeError=$releaseBeforeError)",
    async ({ kind, readBeforeError, releaseBeforeError }) => {
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [stored()])
      client.reset("lesson-1")
      client.hold()
      client.setAccount({ kind })
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      if (readBeforeError) {
        read(calls[2]!)
        await flush()
        expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
          status: "saving",
          operation: "reset",
        })
      }
      if (releaseBeforeError) client.release()
      calls[1]!.resolve({ status: 503, body: null })
      await flush()
      if (!readBeforeError) {
        read(calls[2]!)
        await flush()
      }
      if (!releaseBeforeError) client.release()
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "error",
        operation: "reset",
        completed: true,
      })
      client.flush()
      expect(calls).toHaveLength(3)
      client.retry("lesson-1")
      expect(calls).toHaveLength(4)
      expect(calls[3]!.request).toMatchObject({
        method: "DELETE",
        body: { expectedRevision: 3 },
      })
      ack(calls[3]!)
      await flush()
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "saved",
        completed: false,
        completedStepIds: [],
      })
    },
  )

  it.each(["edit", "resume", "both"] as const)(
    "acknowledges reset without consuming later %s intent",
    async (intent) => {
      vi.useFakeTimers()
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [stored()])
      client.reset("lesson-1")
      if (intent !== "resume")
        client.change("lesson-1", {
          completedStepIds: ["up-watch"],
          completed: false,
        })
      if (intent !== "edit") client.setResume("lesson-1", "up-watch")
      ack(calls[1]!)
      await flush()
      await vi.advanceTimersByTimeAsync(2000)
      expect(calls).toHaveLength(3)
      expect(calls[2]!.request).toMatchObject({
        method: "POST",
        body: {
          expectedRevision: 4,
          completed: false,
          completedStepIds: intent === "resume" ? [] : ["up-watch"],
          resumeCardId: intent === "edit" ? null : "up-watch",
        },
      })
      expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
      ack(
        calls[2]!,
        lesson({
          revision: 5,
          completedStepIds: intent === "resume" ? [] : ["up-watch"],
          resumeCardId: intent === "edit" ? null : "up-watch",
        }),
      )
      await flush()
      client.flush()
      await vi.advanceTimersByTimeAsync(2000)
      expect(calls).toHaveLength(3)
      expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saved")
    },
  )

  const interleavings = (["checking", "unavailable"] as const).flatMap((kind) =>
    ["edit", "resume", "both"].flatMap((intent) =>
      ["older", "same", "own-reset", "newer"].flatMap((revision) =>
        [false, true].flatMap((readBeforeAck) =>
          [false, true].map((releaseBeforeAck) => ({
            kind,
            intent,
            revision,
            readBeforeAck,
            releaseBeforeAck,
          })),
        ),
      ),
    ),
  )
  it.each(interleavings)(
    "reconciles only owned post-reset intent (identity=$kind, intent=$intent, read=$revision, readBeforeAck=$readBeforeAck, releaseBeforeAck=$releaseBeforeAck)",
    async ({ kind, intent, revision, readBeforeAck, releaseBeforeAck }) => {
      vi.useFakeTimers()
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [stored()])
      client.reset("lesson-1")
      client.hold()
      client.setAccount({ kind })
      const steps = intent === "resume" ? [] : ["up-watch"]
      const resume = intent === "edit" ? null : "up-watch"
      if (intent !== "resume")
        client.change("lesson-1", { completedStepIds: steps, completed: false })
      if (intent !== "edit") client.setResume("lesson-1", "up-watch")
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      const get = calls[2]!
      const progress =
        revision === "own-reset"
          ? lesson({ revision: 4 })
          : revision === "newer"
            ? lesson({ revision: 5 })
            : { ...stored(), revision: revision === "older" ? 2 : 3 }
      if (readBeforeAck) {
        read(get, progress)
        await flush()
      }
      if (releaseBeforeAck) client.release()
      ack(calls[1]!)
      await flush()
      if (!readBeforeAck) {
        read(get, progress)
        await flush()
      }
      if (!releaseBeforeAck) client.release()
      await flush()
      await vi.advanceTimersByTimeAsync(2000)
      client.flush({ keepalive: true })
      if (revision === "newer") {
        expect(calls).toHaveLength(3)
        expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
          status: "conflict",
          completed: false,
          completedStepIds: steps,
          resumeCardId: resume,
        })
        client.useSaved("lesson-1")
        expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
          status: "saved",
          completed: false,
          completedStepIds: [],
          resumeCardId: null,
        })
      } else {
        expect(calls).toHaveLength(4)
        expect(calls[3]!.request).toMatchObject({
          method: "POST",
          subject: "user-a",
          body: {
            expectedRevision: 4,
            completed: false,
            completedStepIds: steps,
            resumeCardId: resume,
          },
        })
        expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
        ack(
          calls[3]!,
          lesson({
            revision: 5,
            completedStepIds: steps,
            resumeCardId: resume,
          }),
        )
        await flush()
        expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
          status: "saved",
          completed: false,
          completedStepIds: steps,
          resumeCardId: resume,
        })
      }
      client.release()
      client.flush()
      await vi.advanceTimersByTimeAsync(2000)
      expect(calls).toHaveLength(revision === "newer" ? 3 : 4)
    },
  )

  it.each(["checking", "unavailable"] as const)(
    "keeps later edits through failed DELETE, re-read and Retry (%s)",
    async (kind) => {
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [stored()])
      client.reset("lesson-1")
      client.change("lesson-1", {
        completedStepIds: ["up-watch"],
        completed: false,
      })
      calls[1]!.resolve({ status: 503, body: null })
      await flush()
      client.hold()
      client.setAccount({ kind })
      client.setResume("lesson-1", "up-watch")
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      read(calls[2]!)
      await flush()
      client.release()
      expect(calls).toHaveLength(3)
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "error",
        operation: "reset",
      })
      client.retry("lesson-1")
      expect(calls[3]!.request.method).toBe("DELETE")
      ack(calls[3]!)
      await flush()
      expect(calls).toHaveLength(5)
      expect(calls[4]!.request).toMatchObject({
        method: "POST",
        body: {
          expectedRevision: 4,
          completed: false,
          completedStepIds: ["up-watch"],
          resumeCardId: "up-watch",
        },
      })
      ack(
        calls[4]!,
        lesson({
          revision: 5,
          completedStepIds: ["up-watch"],
          resumeCardId: "up-watch",
        }),
      )
      await flush()
      expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saved")
    },
  )

  it.each(["keepMine", "useSaved"] as const)(
    "retains post-dispatch edits for explicit reset recovery via %s",
    async (choice) => {
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [stored()])
      client.reset("lesson-1")
      client.change("lesson-1", {
        completedStepIds: ["up-watch"],
        completed: false,
      })
      calls[1]!.resolve({
        status: 200,
        body: {
          status: "conflict",
          progress: { ...stored(), revision: 4 },
        },
      })
      await flush()
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "conflict",
        operation: "reset",
        completedStepIds: ["up-watch"],
      })
      client[choice]("lesson-1")
      if (choice === "useSaved") {
        expect(calls).toHaveLength(2)
        expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
          status: "saved",
          completed: true,
          completedStepIds: ["back-how"],
        })
      } else {
        expect(calls[2]!.request).toMatchObject({
          method: "DELETE",
          body: { expectedRevision: 4 },
        })
        ack(calls[2]!, lesson({ revision: 5 }))
        await flush()
        expect(calls[3]!.request).toMatchObject({
          method: "POST",
          body: {
            expectedRevision: 5,
            completedStepIds: ["up-watch"],
            completed: false,
          },
        })
      }
    },
  )

  it.each(["anonymous", "user-b"] as const)(
    "discards reset ownership and its later edits on transition to %s",
    async (next) => {
      vi.useFakeTimers()
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [stored()])
      client.reset("lesson-1")
      client.change("lesson-1", {
        completedStepIds: ["up-watch"],
        completed: false,
      })
      client.setResume("lesson-1", "up-watch")
      if (next === "anonymous") client.setAccount({ kind: "anonymous" })
      else await signIn(client, calls, [], next)
      ack(calls[1]!)
      await flush()
      await vi.advanceTimersByTimeAsync(2000)
      client.release()
      client.flush()
      expect(calls).toHaveLength(next === "anonymous" ? 2 : 3)
      expect(
        client.getSnapshot().lessons["lesson-1"]?.completedStepIds ?? [],
      ).toEqual([])
    },
  )

  it.each([false, true])(
    "retains a reset queued behind POST without replacing it with a save (hold=%s)",
    async (hold) => {
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [stored()])
      client.change("lesson-1", {
        completedStepIds: ["back-give"],
        completed: false,
      })
      if (hold) client.hold()
      client.reset("lesson-1")
      client.release()
      ack(calls[1]!, lesson({ revision: 4, completedStepIds: ["back-give"] }))
      await flush()
      expect(calls).toHaveLength(3)
      expect(calls[2]!.request).toMatchObject({
        method: "DELETE",
        body: { expectedRevision: 4 },
      })
      // A dispatch owns only the intent visible at that time.
      client.change("lesson-1", {
        completedStepIds: ["up-watch"],
        completed: false,
      })
      ack(calls[2]!, lesson({ revision: 5 }))
      await flush()
      expect(calls[3]!.request).toMatchObject({
        method: "POST",
        body: { expectedRevision: 5, completedStepIds: ["up-watch"] },
      })
    },
  )

  it("coalesces repeated reset clicks without duplicating DELETE or losing a later edit", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [stored()])
    client.reset("lesson-1")
    client.reset("lesson-1")
    client.change("lesson-1", {
      completedStepIds: ["up-watch"],
      completed: false,
    })
    client.hold()
    client.reset("lesson-1")
    ack(calls[1]!)
    await flush()
    client.release()
    expect(calls).toHaveLength(3)
    expect(calls[2]!.request).toMatchObject({
      method: "POST",
      body: { expectedRevision: 4, completedStepIds: ["up-watch"] },
    })
  })

  it("Use saved retires an active reset before a fresh edit and late acknowledgement", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [stored()])
    client.reset("lesson-1")
    client.change("lesson-1", {
      completedStepIds: ["up-watch"],
      completed: false,
    })
    client.useSaved("lesson-1")
    client.change("lesson-1", {
      completedStepIds: ["back-give"],
      completed: false,
    })
    expect(calls).toHaveLength(3)
    ack(calls[1]!)
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saving",
      completedStepIds: ["back-give"],
    })
    calls[2]!.resolve({
      status: 200,
      body: { status: "conflict", progress: lesson({ revision: 4 }) },
    })
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "conflict",
      operation: "save",
      completedStepIds: ["back-give"],
    })
    client.keepMine("lesson-1")
    expect(calls[3]!.request).toMatchObject({
      method: "POST",
      body: { expectedRevision: 4, completedStepIds: ["back-give"] },
    })
  })

  it("does not let a failed parallel GET invalidate DELETE success or strand its later edit", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [stored()])
    client.reset("lesson-1")
    client.change("lesson-1", {
      completedStepIds: ["up-watch"],
      completed: false,
    })
    client.refresh()
    calls[2]!.resolve({ status: 503, body: null })
    await flush()
    ack(calls[1]!)
    await flush()
    expect(calls).toHaveLength(3)
    client.retry("lesson-1")
    read(calls[3]!, lesson({ revision: 4 }))
    await flush()
    expect(calls).toHaveLength(5)
    expect(calls[4]!.request).toMatchObject({
      method: "POST",
      body: { expectedRevision: 4, completedStepIds: ["up-watch"] },
    })
  })

  it.each([false, true])(
    "never reports Saved for pending reset after GET with no later edits (readBeforeAck=%s)",
    async (readBeforeAck) => {
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [stored()])
      client.reset("lesson-1")
      client.refresh()
      if (readBeforeAck) {
        read(calls[2]!, lesson({ revision: 4 }))
        await flush()
        expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
          status: "saving",
          operation: "reset",
        })
      }
      ack(calls[1]!)
      await flush()
      if (!readBeforeAck) {
        read(calls[2]!, stored())
        await flush()
      }
      expect(calls).toHaveLength(3)
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "saved",
        completed: false,
        completedStepIds: [],
        resumeCardId: null,
      })
    },
  )

  it.each(["equal", "older"] as const)(
    "rejects a %s inconsistent reset acknowledgement without authorizing its queued edit",
    async (revision) => {
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [stored()])
      client.reset("lesson-1")
      client.change("lesson-1", {
        completedStepIds: ["up-watch"],
        completed: false,
      })
      ack(calls[1]!, lesson({ revision: revision === "equal" ? 3 : 2 }))
      await flush()
      expect(calls).toHaveLength(2)
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "conflict",
        operation: "reset",
        completedStepIds: ["up-watch"],
      })
    },
  )

  it.each(["retry", "save"] as const)(
    "retains reset kind when explicitly recovering via %s",
    async (recovery) => {
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [stored()])
      client.reset("lesson-1")
      calls[1]!.resolve({ status: 503, body: null })
      await flush()
      client.change("lesson-1", {
        completedStepIds: ["up-watch"],
        completed: false,
      })
      client[recovery]("lesson-1")
      expect(calls[2]!.request.method).toBe("DELETE")
      ack(calls[2]!)
      await flush()
      expect(calls[3]!.request).toMatchObject({
        method: "POST",
        body: {
          expectedRevision: 4,
          completedStepIds: ["up-watch"],
          completed: false,
        },
      })
    },
  )

  it("supersedes edits and resume queued before reset dispatch without a duplicate save", async () => {
    vi.useFakeTimers()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [stored()])
    client.hold()
    client.change("lesson-1", {
      completedStepIds: ["up-watch"],
      completed: false,
    })
    client.setResume("lesson-1", "up-watch")
    client.reset("lesson-1")
    client.flush()
    client.release()
    expect(calls[1]!.request.method).toBe("DELETE")
    ack(calls[1]!)
    await flush()
    await vi.advanceTimersByTimeAsync(2000)
    expect(calls).toHaveLength(2)
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saved",
      completed: false,
      completedStepIds: [],
      resumeCardId: null,
    })
  })

  it("does not let an obsolete DELETE take ownership from explicit recovery after a newer read", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [stored()])
    client.reset("lesson-1")
    client.change("lesson-1", {
      completedStepIds: ["up-watch"],
      completed: false,
    })
    client.refresh()
    read(calls[2]!, lesson({ revision: 5 }))
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("conflict")
    client.keepMine("lesson-1")
    expect(calls[3]!.request).toMatchObject({
      method: "DELETE",
      body: { expectedRevision: 5 },
    })
    ack(calls[1]!)
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saving",
      operation: "reset",
      completedStepIds: ["up-watch"],
    })
    ack(calls[3]!, lesson({ revision: 6 }))
    await flush()
    expect(calls[4]!.request).toMatchObject({
      method: "POST",
      body: { expectedRevision: 6, completedStepIds: ["up-watch"] },
    })
  })
})

describe("explicit deltas before a baseline is acknowledged", () => {
  it.each([false, true])(
    "retains only changed post-reset fields (completed baseline=%s)",
    async (completed) => {
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [
        lesson({ revision: 3, completedStepIds: ["back-how"], completed }),
      ])
      client.reset("lesson-1")
      // Exactly what the enabled sheet checkbox emits from its displayed props.
      client.change("lesson-1", {
        completedStepIds: ["back-how", "back-carrying"],
        completed,
      })
      calls[1]!.resolve({
        status: 200,
        body: { status: "saved", progress: lesson({ revision: 4 }) },
      })
      await flush()
      expect(calls[2]!.request).toMatchObject({
        method: "POST",
        body: {
          expectedRevision: 4,
          completedStepIds: ["back-carrying"],
          completed: false,
        },
      })
    },
  )

  it.each([false, true])(
    "initial read supplies untouched fields after a pre-load toggle (toggle-back=%s)",
    async (toggleBack) => {
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      client.change("lesson-1", {
        completedStepIds: ["back-carrying"],
        completed: false,
      })
      if (toggleBack)
        client.change("lesson-1", { completedStepIds: [], completed: false })
      calls[0]!.resolve({
        status: 200,
        body: {
          authenticated: true,
          userId: "user-a",
          lessons: [
            lesson({
              revision: 3,
              completedStepIds: ["back-how"],
              completed: true,
            }),
          ],
        },
      })
      await flush()
      if (toggleBack) {
        expect(calls).toHaveLength(1)
        expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
          status: "saved",
          completedStepIds: ["back-how"],
          completed: true,
        })
      } else {
        expect(calls[1]!.request).toMatchObject({
          method: "POST",
          body: {
            expectedRevision: 3,
            completedStepIds: ["back-how", "back-carrying"],
            completed: true,
          },
        })
      }
    },
  )
})

describe("intent and operation lineage matrix", () => {
  const actions = [
    "add",
    "toggle-back",
    "two-steps",
    "complete",
    "complete-back",
    "resume",
    "step-resume",
  ] as const
  const identities = ["signed-in", "checking", "unavailable"] as const
  type Client = ReturnType<typeof createLearningProgressClient>
  function visible(client: Client) {
    const view = client.getSnapshot().lessons["lesson-1"]
    return {
      completedStepIds: view?.completedStepIds ?? [],
      completed: view?.completed ?? false,
      resumeCardId: view?.resumeCardId ?? null,
    }
  }
  function step(client: Client, id = "back-carrying") {
    const view = visible(client)
    client.change("lesson-1", {
      ...view,
      completedStepIds: view.completedStepIds.includes(id)
        ? view.completedStepIds.filter((value) => value !== id)
        : [...view.completedStepIds, id],
    })
  }
  function completion(client: Client) {
    const view = visible(client)
    client.change("lesson-1", { ...view, completed: !view.completed })
  }
  function perform(client: Client, action: string) {
    if (["add", "toggle-back", "two-steps", "step-resume"].includes(action))
      step(client)
    if (action === "toggle-back") step(client)
    if (action === "two-steps") step(client, "back-give")
    if (action === "complete" || action === "complete-back") completion(client)
    if (action === "complete-back") completion(client)
    if (action === "resume" || action === "step-resume")
      client.setResume("lesson-1", "up-watch")
  }
  function answer(call: Call, progress: ReturnType<typeof lesson>) {
    expect(call.request.method).toBe("GET")
    call.resolve({
      status: 200,
      body: { authenticated: true, userId: "user-a", lessons: [progress] },
    })
  }
  function acknowledge(call: Call, progress: ReturnType<typeof lesson>) {
    call.resolve({ status: 200, body: { status: "saved", progress } })
  }
  const initialCases = ["empty", "partial", "completed"].flatMap((baseline) =>
    actions.flatMap((action) =>
      identities.flatMap((identity) =>
        [false, true].flatMap((readFails) =>
          [false, true].map((releaseBeforeRead) => ({
            baseline,
            action,
            identity,
            readFails,
            releaseBeforeRead,
          })),
        ),
      ),
    ),
  )
  it.each(initialCases)(
    "applies only explicit unread deltas ($baseline, $action, $identity, failed=$readFails, releaseFirst=$releaseBeforeRead)",
    async ({ baseline, action, identity, readFails, releaseBeforeRead }) => {
      vi.useFakeTimers()
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      client.hold()
      if (identity !== "signed-in") client.setAccount({ kind: identity })
      perform(client, action)
      if (identity !== "signed-in")
        client.setAccount({ kind: "signed-in", userId: "user-a" })
      if (readFails) {
        calls.at(-1)!.resolve({ status: 503, body: null })
        await flush()
        expect(client.getSnapshot().load).toBe("error")
        expect(calls.every((call) => call.request.method === "GET")).toBe(true)
        client.retry("lesson-1")
      }
      const stored = lesson({
        revision: baseline === "empty" ? 0 : 3,
        completedStepIds:
          baseline === "completed"
            ? ["back-how", "back-carrying"]
            : baseline === "partial"
              ? ["back-how"]
              : [],
        completed: baseline === "completed",
        resumeCardId: baseline === "empty" ? null : "back-how",
      })
      if (releaseBeforeRead) client.release()
      answer(calls.at(-1)!, stored)
      await flush()
      if (!releaseBeforeRead) client.release()
      const expectedSteps = new Set<string>(stored.completedStepIds)
      if (["add", "two-steps", "step-resume"].includes(action))
        expectedSteps.add("back-carrying")
      if (action === "toggle-back") expectedSteps.delete("back-carrying")
      if (action === "two-steps") expectedSteps.add("back-give")
      const expected = {
        completedStepIds: [...expectedSteps],
        completed:
          action === "complete"
            ? true
            : action === "complete-back"
              ? false
              : stored.completed,
        resumeCardId:
          action === "resume" || action === "step-resume"
            ? "up-watch"
            : stored.resumeCardId,
      }
      const differs =
        JSON.stringify([...expectedSteps].sort()) !==
          JSON.stringify([...stored.completedStepIds].sort()) ||
        expected.completed !== stored.completed ||
        expected.resumeCardId !== stored.resumeCardId
      const shouldWrite =
        differs && !(baseline === "empty" && action === "resume")
      const writes = calls.filter((call) => call.request.method !== "GET")
      expect(writes).toHaveLength(shouldWrite ? 1 : 0)
      expect(visible(client)).toEqual(expected)
      if (shouldWrite) {
        expect(writes[0]!.request).toMatchObject({
          method: "POST",
          subject: "user-a",
          body: { ...expected, expectedRevision: stored.revision },
        })
        expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
        acknowledge(
          writes[0]!,
          lesson({ ...expected, revision: stored.revision + 1 }),
        )
        await flush()
        expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saved")
      }
      client.flush({ keepalive: true })
      await vi.advanceTimersByTimeAsync(2000)
      expect(
        calls.filter((call) => call.request.method !== "GET"),
      ).toHaveLength(shouldWrite ? 1 : 0)
    },
  )

  const resetCases = [false, true].flatMap((completed) =>
    [...actions, "remove"].flatMap((action) =>
      identities.flatMap((identity) =>
        ["read-first", "ack-first", "release-first", "failure-retry"].map(
          (order) => ({ completed, action, identity, order }),
        ),
      ),
    ),
  )
  it.each(resetCases)(
    "retains post-reset deltas only (completed=$completed, $action, $identity, $order)",
    async ({ completed, action, identity, order }) => {
      vi.useFakeTimers()
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      const stored = lesson({
        revision: 3,
        completedStepIds: ["back-how"],
        completed,
        resumeCardId: "end",
      })
      await signIn(client, calls, [stored])
      client.reset("lesson-1")
      client.hold()
      if (identity !== "signed-in") client.setAccount({ kind: identity })
      if (action === "remove") step(client, "back-how")
      else perform(client, action)
      // The first completion click is compared with what the visitor saw.
      const expected = {
        completedStepIds: ["add", "two-steps", "step-resume"].includes(action)
          ? action === "two-steps"
            ? ["back-carrying", "back-give"]
            : ["back-carrying"]
          : [],
        completed:
          action === "complete"
            ? !completed
            : action === "complete-back"
              ? completed
              : false,
        resumeCardId:
          action === "resume" || action === "step-resume" ? "up-watch" : null,
      }
      if (identity === "signed-in") client.refresh()
      else client.setAccount({ kind: "signed-in", userId: "user-a" })
      const get = calls.at(-1)!
      if (order === "failure-retry") {
        calls[1]!.resolve({ status: 503, body: null })
        await flush()
        answer(get, stored)
        await flush()
        client.release()
        expect(
          calls.filter((call) => call.request.method === "DELETE"),
        ).toHaveLength(1)
        client.retry("lesson-1")
        expect(calls.at(-1)!.request).toMatchObject({
          method: "DELETE",
          body: { expectedRevision: 3 },
        })
        acknowledge(calls.at(-1)!, lesson({ revision: 4 }))
      } else {
        if (order === "release-first") client.release()
        if (order !== "ack-first") {
          answer(get, order === "read-first" ? lesson({ revision: 4 }) : stored)
          await flush()
        }
        acknowledge(calls[1]!, lesson({ revision: 4 }))
        await flush()
        if (order === "ack-first") answer(get, stored)
      }
      await flush()
      client.release()
      await flush()
      const posts = calls.filter((call) => call.request.method === "POST")
      const shouldWrite =
        expected.completedStepIds.length > 0 ||
        expected.completed ||
        expected.resumeCardId !== null
      expect(posts).toHaveLength(shouldWrite ? 1 : 0)
      expect(visible(client)).toEqual(expected)
      if (shouldWrite) {
        expect(posts[0]!.request).toMatchObject({
          body: { ...expected, expectedRevision: 4 },
        })
        expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
        acknowledge(posts[0]!, lesson({ ...expected, revision: 5 }))
        await flush()
      }
      expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saved")
      const before = calls.length
      client.flush()
      await vi.advanceTimersByTimeAsync(2000)
      expect(calls).toHaveLength(before)
    },
  )
})

describe("unread intent isolation and one-time adoption", () => {
  const stored = () =>
    lesson({ revision: 3, completedStepIds: ["back-how"], completed: true })
  function read(call: Call, progress = stored(), userId = "user-a") {
    call.resolve({
      status: 200,
      body: { authenticated: true, userId, lessons: [progress] },
    })
  }
  function edit(client: ReturnType<typeof createLearningProgressClient>) {
    client.change("lesson-1", {
      completedStepIds: ["back-carrying"],
      completed: false,
    })
    client.setResume("lesson-1", "up-watch")
  }

  it.each(["anonymous", "user-b"] as const)(
    "discards unread account deltas and late reads on %s",
    async (next) => {
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      edit(client)
      if (next === "anonymous") client.setAccount({ kind: "anonymous" })
      else await signIn(client, calls, [], next)
      read(calls[0]!)
      await flush()
      client.flush()
      expect(calls.every((call) => call.request.method === "GET")).toBe(true)
      expect(
        client.getSnapshot().lessons["lesson-1"]?.completedStepIds ?? [],
      ).toEqual([])
      expect(
        client.getSnapshot().lessons["lesson-1"]?.resumeCardId ?? null,
      ).toBeNull()
    },
  )

  it.each(["checking", "unavailable", "anonymous"] as const)(
    "requires explicit recovery for an unscoped %s draft",
    async (kind) => {
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      client.setAccount({ kind })
      edit(client)
      await signIn(client, calls, [stored()])
      expect(calls).toHaveLength(1)
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "conflict",
        completed: true,
        completedStepIds: ["back-how", "back-carrying"],
      })
      client.keepMine("lesson-1")
      expect(calls[1]!.request).toMatchObject({
        method: "POST",
        subject: "user-a",
        body: {
          expectedRevision: 3,
          completed: true,
          completedStepIds: ["back-how", "back-carrying"],
          resumeCardId: "up-watch",
        },
      })
    },
  )

  it.each(["checking", "unavailable"] as const)(
    "never reapplies a consumed unread delta onto an independent revision (%s)",
    async (kind) => {
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      edit(client)
      read(calls[0]!)
      await flush()
      expect(calls[1]!.request.method).toBe("POST")
      client.hold()
      client.setAccount({ kind })
      client.setAccount({ kind: "signed-in", userId: "user-a" })
      read(calls[2]!, lesson({ revision: 5 }))
      await flush()
      client.release()
      // The old successful save cannot acknowledge the independent empty rev5.
      calls[1]!.resolve({
        status: 200,
        body: {
          status: "saved",
          progress: lesson({
            revision: 4,
            completed: true,
            completedStepIds: ["back-how", "back-carrying"],
            resumeCardId: "up-watch",
          }),
        },
      })
      await flush()
      expect(calls).toHaveLength(3)
      expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("conflict")
      client.useSaved("lesson-1")
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "saved",
        completed: false,
        completedStepIds: [],
        resumeCardId: null,
      })
      client.refresh()
      read(calls[3]!, lesson({ revision: 5 }))
      await flush()
      expect(calls).toHaveLength(4)
      expect(
        client.getSnapshot().lessons["lesson-1"]!.completedStepIds,
      ).toEqual([])
    },
  )

  it("ignores an obsolete initial GET after its replacement has consumed the delta", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    client.setAccount({ kind: "signed-in", userId: "user-a" })
    edit(client)
    client.refresh()
    read(calls[1]!)
    await flush()
    read(calls[0]!, lesson({ revision: 0 }))
    await flush()
    expect(calls).toHaveLength(3)
    expect(calls[2]!.request).toMatchObject({
      method: "POST",
      body: {
        expectedRevision: 3,
        completed: true,
        completedStepIds: ["back-how", "back-carrying"],
        resumeCardId: "up-watch",
      },
    })
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
  })
})

describe("queued intent before dispatch", () => {
  it("does not rebase a debounced resume over an independent reset returned by refresh", async () => {
    vi.useFakeTimers()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [
      lesson({ revision: 5, completedStepIds: ["back-how"], completed: true }),
    ])
    client.setResume("lesson-1", "up-watch")
    client.refresh()
    calls[1]!.resolve({
      status: 200,
      body: {
        authenticated: true,
        userId: "user-a",
        lessons: [lesson({ revision: 6 })],
      },
    })
    await flush()
    await vi.advanceTimersByTimeAsync(2000)
    client.flush()
    expect(calls).toHaveLength(2)
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "conflict",
      completed: true,
      completedStepIds: ["back-how"],
      resumeCardId: "up-watch",
    })
  })

  it("emits Saving and reset ownership as soon as a held reset is accepted", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [
      lesson({ revision: 5, completedStepIds: ["back-how"], completed: true }),
    ])
    const listener = vi.fn()
    client.subscribe(listener)
    client.hold()
    client.reset("lesson-1")
    expect(calls).toHaveLength(1)
    expect(listener).toHaveBeenCalled()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saving",
      operation: "reset",
      error: null,
    })
    client.release()
    expect(calls[1]!.request).toMatchObject({
      method: "DELETE",
      body: { expectedRevision: 5 },
    })
  })
})

describe("debounce/read and held-reset ownership matrix", () => {
  const stored = () =>
    lesson({
      revision: 5,
      completedStepIds: ["back-how"],
      completed: true,
      resumeCardId: "back-how",
    })
  function read(call: Call, progress: Record<string, unknown> = stored()) {
    expect(call.request.method).toBe("GET")
    call.resolve({
      status: 200,
      body: { authenticated: true, userId: "user-a", lessons: [progress] },
    })
  }
  function ack(call: Call, progress: Record<string, unknown>) {
    call.resolve({ status: 200, body: { status: "saved", progress } })
  }
  const cases = ["direct", "checking", "unavailable"].flatMap((identity) =>
    [4, 5, 6].flatMap((revision) =>
      [false, true].flatMap((timerBeforeRead) =>
        [false, true].flatMap((releaseBeforeRead) =>
          [false, true].map((edit) => ({
            identity,
            revision,
            timerBeforeRead,
            releaseBeforeRead,
            edit,
          })),
        ),
      ),
    ),
  )
  it.each(cases)(
    "binds queued intent to its base ($identity, rev=$revision, timerFirst=$timerBeforeRead, releaseFirst=$releaseBeforeRead, edit=$edit)",
    async ({
      identity,
      revision,
      timerBeforeRead,
      releaseBeforeRead,
      edit,
    }) => {
      vi.useFakeTimers()
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [stored()])
      client.hold()
      if (edit)
        client.change("lesson-1", {
          completedStepIds: ["back-how", "back-carrying"],
          completed: true,
        })
      client.setResume("lesson-1", "up-watch")
      if (identity === "direct") client.refresh()
      else {
        client.setAccount({ kind: identity as "checking" | "unavailable" })
        client.setAccount({ kind: "signed-in", userId: "user-a" })
      }
      if (releaseBeforeRead) client.release()
      if (timerBeforeRead) await vi.advanceTimersByTimeAsync(2000)
      read(
        calls[1]!,
        revision === 6 ? lesson({ revision: 6 }) : { ...stored(), revision },
      )
      await flush()
      if (!releaseBeforeRead) {
        expect(calls).toHaveLength(2)
        expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe(
          revision === 6 ? "conflict" : "saving",
        )
        client.release()
      }
      await vi.advanceTimersByTimeAsync(2000)
      client.flush({ keepalive: true })
      if (revision === 6) {
        expect(calls).toHaveLength(2)
        expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe(
          "conflict",
        )
        client.useSaved("lesson-1")
        expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
          status: "saved",
          completed: false,
          completedStepIds: [],
          resumeCardId: null,
        })
      } else {
        expect(calls).toHaveLength(3)
        const completedStepIds = edit
          ? ["back-how", "back-carrying"]
          : ["back-how"]
        expect(calls[2]!.request).toMatchObject({
          method: "POST",
          subject: "user-a",
          body: {
            expectedRevision: 5,
            completed: true,
            completedStepIds,
            resumeCardId: "up-watch",
          },
        })
        expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saving")
        ack(calls[2]!, {
          ...stored(),
          revision: 6,
          completedStepIds,
          resumeCardId: "up-watch",
        })
        await flush()
        expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saved")
      }
      const before = calls.length
      client.release()
      client.flush()
      await vi.advanceTimersByTimeAsync(2000)
      expect(calls).toHaveLength(before)
    },
  )

  it.each(["same", "newer", "error"] as const)(
    "retains a confirmed held reset through a $0 GET",
    async (outcome) => {
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [stored()])
      client.hold()
      client.reset("lesson-1")
      client.refresh()
      if (outcome === "error") calls[1]!.resolve({ status: 503, body: null })
      else
        read(
          calls[1]!,
          outcome === "newer" ? lesson({ revision: 6 }) : stored(),
        )
      await flush()
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        operation: "reset",
        status: outcome === "newer" ? "conflict" : "saving",
      })
      client.release()
      if (outcome === "newer") {
        expect(calls).toHaveLength(2)
        client.keepMine("lesson-1")
      } else if (outcome === "error") {
        expect(calls).toHaveLength(2)
        client.retry("lesson-1")
        read(calls[2]!)
        await flush()
      }
      const reset = calls.at(-1)!
      expect(reset.request).toMatchObject({
        method: "DELETE",
        body: { expectedRevision: outcome === "newer" ? 6 : 5 },
      })
      ack(reset, lesson({ revision: outcome === "newer" ? 7 : 6 }))
      await flush()
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "saved",
        completed: false,
        completedStepIds: [],
      })
    },
  )
})

describe("queued intent recovery and teardown", () => {
  const stored = () =>
    lesson({ revision: 5, completed: true, completedStepIds: ["back-how"] })
  function read(call: Call, progress: Record<string, unknown> = stored()) {
    call.resolve({
      status: 200,
      body: { authenticated: true, userId: "user-a", lessons: [progress] },
    })
  }
  function ack(call: Call, progress: Record<string, unknown>) {
    call.resolve({ status: 200, body: { status: "saved", progress } })
  }
  it.each(
    ["older", "same", "own", "newer"].flatMap((revision) =>
      [false, true].map((ackFirst) => ({ revision, ackFirst })),
    ),
  )(
    "keeps timer-dispatched POST ownership across GET ($revision, ackFirst=$ackFirst)",
    async ({ revision, ackFirst }) => {
      vi.useFakeTimers()
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [stored()])
      client.setResume("lesson-1", "up-watch")
      await vi.advanceTimersByTimeAsync(2000)
      expect(calls[1]!.request).toMatchObject({
        method: "POST",
        body: { expectedRevision: 5 },
      })
      client.refresh()
      const saved = { ...stored(), revision: 6, resumeCardId: "up-watch" }
      if (ackFirst) {
        ack(calls[1]!, saved)
        await flush()
      }
      read(
        calls[2]!,
        revision === "newer"
          ? lesson({ revision: 7 })
          : revision === "own"
            ? saved
            : { ...stored(), revision: revision === "older" ? 4 : 5 },
      )
      await flush()
      if (!ackFirst) {
        ack(calls[1]!, saved)
        await flush()
      }
      expect(calls).toHaveLength(3)
      expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe(
        revision === "newer" && !ackFirst ? "conflict" : "saved",
      )
      if (revision === "newer" && ackFirst)
        expect(client.getSnapshot().lessons["lesson-1"]!.completed).toBe(false)
      client.flush()
      await vi.advanceTimersByTimeAsync(2000)
      expect(calls).toHaveLength(3)
    },
  )

  it.each(["resume", "reset"] as const)(
    "retires a queued %s on Use saved while GET is pending",
    async (operation) => {
      vi.useFakeTimers()
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [stored()])
      client.hold()
      if (operation === "resume") client.setResume("lesson-1", "up-watch")
      else client.reset("lesson-1")
      client.refresh()
      client.useSaved("lesson-1")
      read(calls[1]!, lesson({ revision: 6 }))
      await flush()
      client.release()
      client.flush()
      await vi.advanceTimersByTimeAsync(2000)
      expect(calls).toHaveLength(2)
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "saved",
        completed: false,
        completedStepIds: [],
        resumeCardId: null,
      })
    },
  )

  it("saves a conflicted queued resume only after explicit Keep mine", async () => {
    vi.useFakeTimers()
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [stored()])
    client.setResume("lesson-1", "up-watch")
    client.refresh()
    read(calls[1]!, lesson({ revision: 6 }))
    await flush()
    expect(calls).toHaveLength(2)
    client.keepMine("lesson-1")
    expect(calls[2]!.request).toMatchObject({
      method: "POST",
      body: {
        expectedRevision: 6,
        completed: true,
        completedStepIds: ["back-how"],
        resumeCardId: "up-watch",
      },
    })
    ack(calls[2]!, { ...stored(), revision: 7, resumeCardId: "up-watch" })
    await flush()
    await vi.advanceTimersByTimeAsync(2000)
    expect(calls).toHaveLength(3)
    expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("saved")
  })

  it.each(
    ["resume", "reset"].flatMap((operation) =>
      ["anonymous", "user-b"].map((next) => ({ operation, next })),
    ),
  )(
    "drops $operation queue, timer and late GET on transition to $next",
    async ({ operation, next }) => {
      vi.useFakeTimers()
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      await signIn(client, calls, [stored()])
      client.hold()
      if (operation === "resume") client.setResume("lesson-1", "up-watch")
      else client.reset("lesson-1")
      client.refresh()
      if (next === "anonymous") client.setAccount({ kind: "anonymous" })
      else await signIn(client, calls, [], "user-b")
      read(calls[1]!)
      await flush()
      client.release()
      client.flush()
      await vi.advanceTimersByTimeAsync(2000)
      expect(calls.every((call) => call.request.method === "GET")).toBe(true)
      expect(client.getSnapshot().lessons["lesson-1"]?.completed ?? false).toBe(
        false,
      )
      expect(
        client.getSnapshot().lessons["lesson-1"]?.resumeCardId ?? null,
      ).toBeNull()
    },
  )
})

describe("queued reset behind a save", () => {
  it("retains pending reset ownership after its predecessor acknowledges and a GET returns", async () => {
    const { calls, transport } = fakeTransport()
    const client = createLearningProgressClient({ transport })
    await signIn(client, calls, [
      lesson({ revision: 5, completedStepIds: ["back-how"] }),
    ])
    client.change("lesson-1", {
      completedStepIds: ["back-how", "back-carrying"],
      completed: false,
    })
    client.hold()
    client.reset("lesson-1")
    const progress = lesson({
      revision: 6,
      completedStepIds: ["back-how", "back-carrying"],
    })
    calls[1]!.resolve({ status: 200, body: { status: "saved", progress } })
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saving",
      operation: "reset",
    })
    client.refresh()
    calls[2]!.resolve({
      status: 200,
      body: { authenticated: true, userId: "user-a", lessons: [progress] },
    })
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saving",
      operation: "reset",
    })
    client.release()
    expect(calls[3]!.request).toMatchObject({
      method: "DELETE",
      body: { expectedRevision: 6 },
    })
    calls[3]!.resolve({ status: 503, body: null })
    await flush()
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "error",
      operation: "reset",
    })
    client.retry("lesson-1")
    expect(calls[4]!.request.method).toBe("DELETE")
    calls[4]!.resolve({
      status: 200,
      body: { status: "saved", progress: lesson({ revision: 7 }) },
    })
    await flush()
    expect(calls).toHaveLength(5)
    expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
      status: "saved",
      completedStepIds: [],
    })
  })
})

describe("held operation after progress read failure", () => {
  it.each(
    ["retry", "refresh"].flatMap((recovery) =>
      [false, true].map((changed) => ({ recovery, changed })),
    ),
  )(
    "recovers a queued reset after failed GET ($recovery, independent change=$changed)",
    async ({ recovery, changed }) => {
      const { calls, transport } = fakeTransport()
      const client = createLearningProgressClient({ transport })
      const stored = lesson({ revision: 5, completedStepIds: ["back-how"] })
      await signIn(client, calls, [stored])
      client.hold()
      client.change("lesson-1", {
        completedStepIds: ["back-how", "back-carrying"],
        completed: false,
      })
      client.reset("lesson-1")
      client.refresh()
      calls[1]!.resolve({ status: 503, body: null })
      await flush()
      expect(client.getSnapshot().load).toBe("error")
      if (recovery === "retry") client.retry("lesson-1")
      else client.refresh()
      calls[2]!.resolve({
        status: 200,
        body: {
          authenticated: true,
          userId: "user-a",
          lessons: [changed ? lesson({ revision: 6 }) : stored],
        },
      })
      await flush()
      client.release()
      if (changed) {
        expect(calls).toHaveLength(3)
        expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
          status: "conflict",
          operation: "reset",
        })
        client.useSaved("lesson-1")
        return
      }
      expect(calls).toHaveLength(4)
      expect(calls[3]!.request).toMatchObject({
        method: "DELETE",
        body: { expectedRevision: 5 },
      })
      calls[3]!.resolve({
        status: 200,
        body: { status: "saved", progress: lesson({ revision: 6 }) },
      })
      await flush()
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "saved",
        completedStepIds: [],
        completed: false,
      })
    },
  )
})
