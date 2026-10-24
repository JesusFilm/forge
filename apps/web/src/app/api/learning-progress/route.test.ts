import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  verifyAuthSession: vi.fn(),
  fetchLearningProgress: vi.fn(),
  saveLearningProgress: vi.fn(),
  resetLearningProgress: vi.fn(),
  audienceEnabled: vi.fn(),
}))

vi.mock("@/lib/feature-flags", () => ({
  isWatchAudienceEnabled: mocks.audienceEnabled,
}))

vi.mock("@/lib/auth-session", () => ({
  verifyAuthSession: mocks.verifyAuthSession,
}))

vi.mock("@/auth/request-origin", () => ({
  getRequestOrigin: () => "https://www.jesusfilm.org",
}))

vi.mock("@/lib/watch-learning-progress", () => ({
  fetchLearningProgress: mocks.fetchLearningProgress,
  saveLearningProgress: mocks.saveLearningProgress,
  resetLearningProgress: mocks.resetLearningProgress,
}))

import { createLearningProgressClient } from "@/lib/watch-learning-progress-client"

import { DELETE, GET, POST } from "./route"

const ORIGIN = "https://www.jesusfilm.org"
const URL_BASE = `${ORIGIN}/watch/api/learning-progress`

const SIGNED_IN = {
  authenticated: true,
  userId: "auth-user-a",
  accessToken: "token-a",
}

const PROGRESS = {
  courseId: "beginning-with-jesus",
  contentVersion: "2026-10-17-v1",
  lessonId: "lesson-1",
  completedMovementIds: [],
  completedStepIds: ["back-how"],
  completed: false,
  completedAt: null,
  resumeCardId: "back-carrying",
  revision: 2,
  updatedAt: "2026-10-17T00:00:00.000Z",
}

const SAVE_BODY = {
  courseId: "beginning-with-jesus",
  contentVersion: "2026-10-17-v1",
  lessonId: "lesson-1",
  expectedRevision: 1,
  completedMovementIds: [],
  completedStepIds: ["back-how"],
  completed: false,
  resumeCardId: "back-carrying",
}

function mutation(
  method: "POST" | "DELETE",
  body: unknown,
  headers: Record<string, string> = {
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "x-watch-learning-subject": "auth-user-a",
  },
) {
  return new Request(URL_BASE, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

function getRequest(
  query = "courseId=beginning-with-jesus&contentVersion=2026-10-17-v1",
) {
  return new Request(`${URL_BASE}?${query}`)
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.audienceEnabled.mockResolvedValue(true)
  mocks.verifyAuthSession.mockResolvedValue(SIGNED_IN)
  mocks.fetchLearningProgress.mockResolvedValue({
    ok: true,
    lessons: [PROGRESS],
  })
  mocks.saveLearningProgress.mockResolvedValue({
    ok: true,
    status: "saved",
    progress: PROGRESS,
  })
  mocks.resetLearningProgress.mockResolvedValue({
    ok: true,
    status: "saved",
    progress: { ...PROGRESS, completedStepIds: [], revision: 3 },
  })
})

describe("GET /watch/api/learning-progress", () => {
  it("returns the signed-in account's lessons, private and uncached", async () => {
    const response = await GET(getRequest())
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      userId: "auth-user-a",
      lessons: [PROGRESS],
    })
    expect(mocks.fetchLearningProgress).toHaveBeenCalledWith("token-a", {
      courseId: "beginning-with-jesus",
      contentVersion: "2026-10-17-v1",
    })
  })

  it("reports signed-out without calling Admin", async () => {
    mocks.verifyAuthSession.mockResolvedValue({ authenticated: false })
    const response = await GET(getRequest())
    await expect(response.json()).resolves.toEqual({ authenticated: false })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.fetchLearningProgress).not.toHaveBeenCalled()
  })

  it("says a signed-in session without an access token cannot hold progress", async () => {
    // Not signed-out: the session route reports this visitor signed in, and
    // answering signed-out made the client re-check the session forever.
    mocks.verifyAuthSession.mockResolvedValue({
      authenticated: true,
      userId: "auth-user-a",
    })
    const response = await GET(getRequest())
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      userId: "auth-user-a",
      progressAvailable: false,
    })
    expect(mocks.fetchLearningProgress).not.toHaveBeenCalled()
  })

  it("rejects malformed ids before calling Admin", async () => {
    const response = await GET(
      getRequest("courseId=Beginning%20With%20Jesus&contentVersion=v1"),
    )
    expect(response.status).toBe(400)
    expect(mocks.fetchLearningProgress).not.toHaveBeenCalled()
  })

  it("returns 502 on an Admin or database failure, never empty progress", async () => {
    mocks.fetchLearningProgress.mockResolvedValue({
      ok: false,
      reason: "upstream",
    })
    const response = await GET(getRequest())
    expect(response.status).toBe(502)
    const body = await response.json()
    expect(body).toEqual({ error: "upstream" })
    expect(body).not.toHaveProperty("lessons")
  })
})

describe("POST /watch/api/learning-progress", () => {
  it("saves with the session's own token", async () => {
    const response = await POST(mutation("POST", SAVE_BODY))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      status: "saved",
      progress: PROGRESS,
    })
    expect(mocks.saveLearningProgress).toHaveBeenCalledWith(
      "token-a",
      SAVE_BODY,
    )
  })

  it("returns a conflict with the server's state for the client to reload", async () => {
    mocks.saveLearningProgress.mockResolvedValue({
      ok: true,
      status: "conflict",
      progress: { ...PROGRESS, revision: 9 },
    })
    const response = await POST(mutation("POST", SAVE_BODY))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: "conflict",
      progress: { revision: 9 },
    })
  })

  it.each([
    [
      "a cross-site origin",
      { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    ],
    [
      "a same-site sibling",
      { origin: "https://evil.jesusfilm.org", "sec-fetch-site": "same-site" },
    ],
    [
      "a forged Origin with cross-site fetch metadata",
      { origin: ORIGIN, "sec-fetch-site": "cross-site" },
    ],
    ["no Origin header", {}],
  ])("refuses %s before reading the session", async (_label, headers) => {
    const response = await POST(mutation("POST", SAVE_BODY, headers))
    expect(response.status).toBe(403)
    expect(mocks.verifyAuthSession).not.toHaveBeenCalled()
    expect(mocks.saveLearningProgress).not.toHaveBeenCalled()
  })

  it("requires a signed-in account", async () => {
    mocks.verifyAuthSession.mockResolvedValue({ authenticated: false })
    const response = await POST(mutation("POST", SAVE_BODY))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
    expect(mocks.saveLearningProgress).not.toHaveBeenCalled()
  })

  it("refuses a signed-in session without an access token as unavailable, not signed out", async () => {
    mocks.verifyAuthSession.mockResolvedValue({
      authenticated: true,
      userId: "auth-user-a",
    })
    const response = await POST(mutation("POST", SAVE_BODY))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: "progress-unavailable",
    })
    expect(mocks.saveLearningProgress).not.toHaveBeenCalled()
  })

  it.each([
    ["another account's id", { "x-watch-learning-subject": "auth-user-b" }],
    ["no loaded account", {}],
  ])(
    "refuses a write bound to %s before calling Admin",
    async (_label, subject) => {
      const response = await POST(
        mutation("POST", SAVE_BODY, {
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
          ...subject,
        }),
      )
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toEqual({
        error: "identity-mismatch",
      })
      expect(mocks.saveLearningProgress).not.toHaveBeenCalled()
    },
  )

  it.each([
    ["a userId field", { ...SAVE_BODY, userId: "auth-user-b" }],
    [
      "free text in a step id",
      { ...SAVE_BODY, completedStepIds: ["I prayed for my mom"] },
    ],
    [
      "an oversized step list",
      {
        ...SAVE_BODY,
        completedStepIds: Array.from({ length: 65 }, () => "back-how"),
      },
    ],
    [
      "a missing expected revision",
      { ...SAVE_BODY, expectedRevision: undefined },
    ],
    ["a reflection payload", { ...SAVE_BODY, notes: { "back-how": "tired" } }],
  ])("rejects %s without calling Admin", async (_label, body) => {
    const response = await POST(mutation("POST", body))
    expect(response.status).toBe(400)
    expect(mocks.saveLearningProgress).not.toHaveBeenCalled()
  })

  it.each([
    ["invalid", 400],
    ["forbidden", 403],
    ["unauthorized", 401],
    ["upstream", 502],
  ])("maps Admin failure %s to %i", async (reason, status) => {
    mocks.saveLearningProgress.mockResolvedValue({ ok: false, reason })
    const response = await POST(mutation("POST", SAVE_BODY))
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ error: reason })
  })
})

describe("DELETE /watch/api/learning-progress", () => {
  const RESET_BODY = {
    courseId: "beginning-with-jesus",
    contentVersion: "2026-10-17-v1",
    lessonId: "lesson-1",
    expectedRevision: 2,
  }

  it("resets one lesson at the revision the client read", async () => {
    const response = await DELETE(mutation("DELETE", RESET_BODY))
    expect(response.status).toBe(200)
    expect(mocks.resetLearningProgress).toHaveBeenCalledWith(
      "token-a",
      RESET_BODY,
    )
  })

  it("refuses a reset bound to another account before calling Admin", async () => {
    const response = await DELETE(
      mutation("DELETE", RESET_BODY, {
        origin: ORIGIN,
        "sec-fetch-site": "same-origin",
        "x-watch-learning-subject": "auth-user-b",
      }),
    )
    expect(response.status).toBe(409)
    expect(mocks.resetLearningProgress).not.toHaveBeenCalled()
  })

  it("refuses a cross-origin reset", async () => {
    const response = await DELETE(
      mutation("DELETE", RESET_BODY, { origin: "https://evil.example" }),
    )
    expect(response.status).toBe(403)
    expect(mocks.resetLearningProgress).not.toHaveBeenCalled()
  })

  it("requires the expected revision", async () => {
    const withoutRevision: Partial<typeof RESET_BODY> = { ...RESET_BODY }
    delete withoutRevision.expectedRevision
    const response = await DELETE(mutation("DELETE", withoutRevision))
    expect(response.status).toBe(400)
    expect(mocks.resetLearningProgress).not.toHaveBeenCalled()
  })
})

describe("audience flag rollback", () => {
  const RESET_BODY = {
    courseId: "beginning-with-jesus",
    contentVersion: "2026-10-17-v1",
    lessonId: "lesson-1",
    expectedRevision: 2,
  }
  const requests = {
    GET: () => GET(getRequest()),
    POST: () => POST(mutation("POST", SAVE_BODY)),
    DELETE: () => DELETE(mutation("DELETE", RESET_BODY)),
  }

  it.each([
    ["off", () => mocks.audienceEnabled.mockResolvedValue(false)],
    [
      "unreadable",
      () => mocks.audienceEnabled.mockRejectedValue(new Error("flag down")),
    ],
  ])(
    "is a private no-store 404 for every method while the flag is %s, before the session or Admin",
    async (_label, setFlag) => {
      setFlag()
      for (const [method, send] of Object.entries(requests)) {
        const response = await send()
        expect(response.status, method).toBe(404)
        expect(response.headers.get("cache-control"), method).toBe(
          "private, no-store",
        )
        await expect(response.json()).resolves.toEqual({ error: "Not found" })
      }
      expect(mocks.verifyAuthSession).not.toHaveBeenCalled()
      expect(mocks.fetchLearningProgress).not.toHaveBeenCalled()
      expect(mocks.saveLearningProgress).not.toHaveBeenCalled()
      expect(mocks.resetLearningProgress).not.toHaveBeenCalled()
    },
  )

  it("refuses a malformed or cross-site request as 404 too, so the flag is checked first", async () => {
    mocks.audienceEnabled.mockResolvedValue(false)
    const malformed = await GET(getRequest("courseId=Bad%20Id"))
    expect(malformed.status).toBe(404)
    const crossSite = await POST(
      mutation("POST", SAVE_BODY, { origin: "https://evil.example" }),
    )
    expect(crossSite.status).toBe(404)
    expect(mocks.verifyAuthSession).not.toHaveBeenCalled()
  })

  it("an already-open page cannot save or reset after rollback, and never shows Saved", async () => {
    vi.stubGlobal("window", { location: { origin: ORIGIN } })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const headers = new Headers(init.headers)
        headers.set("origin", ORIGIN)
        headers.set("sec-fetch-site", "same-origin")
        const request = new Request(url, { ...init, headers })
        return { GET, POST, DELETE }[init.method as "GET"](request)
      }),
    )
    try {
      const client = createLearningProgressClient()
      client.setAccount({ kind: "signed-in", userId: "auth-user-a" })
      await vi.waitFor(() => expect(client.getSnapshot().load).toBe("loaded"))
      // Incident rollback while the course is open.
      mocks.audienceEnabled.mockResolvedValue(false)
      client.change("lesson-1", {
        completedStepIds: ["back-how", "back-give"],
        completed: false,
      })
      await vi.waitFor(() =>
        expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("error"),
      )
      client.reset("lesson-2")
      expect(mocks.saveLearningProgress).not.toHaveBeenCalled()
      expect(mocks.resetLearningProgress).not.toHaveBeenCalled()
      expect(client.getSnapshot().lessons["lesson-1"]).toMatchObject({
        status: "error",
        completedStepIds: ["back-how", "back-give"],
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe("account switched in another tab", () => {
  // Tab 1 loaded account A; account B then signed in through another tab, so
  // the shared cookie is B's while tab 1's focus re-read of the session is
  // still pending. Both accounts hold lesson-1 at the same revision.
  const SESSION_B = {
    authenticated: true,
    userId: "auth-user-b",
    accessToken: "token-b",
  }

  function browser() {
    vi.stubGlobal("window", { location: { origin: ORIGIN } })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        // What the browser adds to a same-origin fetch.
        const headers = new Headers(init.headers)
        headers.set("origin", ORIGIN)
        headers.set("sec-fetch-site", "same-origin")
        const request = new Request(url, { ...init, headers })
        const handler = { GET, POST, DELETE }[init.method as "GET"]
        return handler(request)
      }),
    )
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function loadedAsA() {
    const stale = vi.fn()
    const client = createLearningProgressClient({ onStaleIdentity: stale })
    mocks.fetchLearningProgress.mockResolvedValue({
      ok: true,
      lessons: [{ ...PROGRESS, revision: 1 }],
    })
    client.setAccount({ kind: "signed-in", userId: "auth-user-a" })
    await vi.waitFor(() => expect(client.getSnapshot().load).toBe("loaded"))
    mocks.verifyAuthSession.mockResolvedValue(SESSION_B)
    return { client, stale }
  }

  it("never saves A's cached steps into B's account", async () => {
    browser()
    const { client, stale } = await loadedAsA()
    client.change("lesson-1", {
      completedStepIds: ["back-how", "back-give"],
      completed: true,
    })
    await vi.waitFor(() =>
      expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("error"),
    )
    expect(mocks.saveLearningProgress).not.toHaveBeenCalled()
    expect(stale).toHaveBeenCalledTimes(1)
  })

  it("never resets B's lesson from A's read revision", async () => {
    browser()
    const { client } = await loadedAsA()
    client.reset("lesson-1")
    await vi.waitFor(() =>
      expect(client.getSnapshot().lessons["lesson-1"]!.status).toBe("error"),
    )
    expect(mocks.resetLearningProgress).not.toHaveBeenCalled()
  })
})
