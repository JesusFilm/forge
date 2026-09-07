import { describe, expect, it, vi } from "vitest"

import {
  fetchHistoryPage,
  fetchHistoryThread,
  renameHistoryThread,
} from "./history-client"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function fetchReturning(status: number, body: unknown): typeof fetch {
  return async () => jsonResponse(status, body)
}

// One test per union branch, each with a status/body pair ONLY that branch can
// match (mocked-shape-vs-real-contract discipline).
describe("history client — failure mapping", () => {
  it("maps 401 invalid_session to access (silent client-only fallback)", async () => {
    const result = await fetchHistoryPage({
      page: 0,
      fetchImpl: fetchReturning(401, { reason: "invalid_session" }),
    })
    expect(result).toEqual({ ok: false, reason: "access" })
  })

  it("maps 403 gate_denied to access", async () => {
    const result = await fetchHistoryPage({
      page: 0,
      fetchImpl: fetchReturning(403, { reason: "gate_denied" }),
    })
    expect(result).toEqual({ ok: false, reason: "access" })
  })

  it("maps 403 thread_forbidden to not_available", async () => {
    const result = await fetchHistoryThread({
      conversationId: "conv-1",
      fetchImpl: fetchReturning(403, { reason: "thread_forbidden" }),
    })
    expect(result).toEqual({ ok: false, reason: "not_available" })
  })

  it("maps a reasonless 403 to unavailable (closed mapping, never a guess)", async () => {
    const result = await fetchHistoryThread({
      conversationId: "conv-1",
      fetchImpl: fetchReturning(403, {}),
    })
    expect(result).toEqual({ ok: false, reason: "unavailable" })
  })

  it("maps a 404 carrying thread_not_found to not_available", async () => {
    const result = await fetchHistoryThread({
      conversationId: "conv-1",
      fetchImpl: fetchReturning(404, { reason: "thread_not_found" }),
    })
    expect(result).toEqual({ ok: false, reason: "not_available" })
  })

  it("maps a reasonless 404 (deploy skew / route absent) to unavailable, never data loss", async () => {
    const jsonResult = await fetchHistoryThread({
      conversationId: "conv-1",
      fetchImpl: fetchReturning(404, { error: "Not found" }),
    })
    expect(jsonResult).toEqual({ ok: false, reason: "unavailable" })
    // A framework/CDN 404 body is not even JSON.
    const htmlResult = await fetchHistoryThread({
      conversationId: "conv-1",
      fetchImpl: async () => new Response("<html>404</html>", { status: 404 }),
    })
    expect(htmlResult).toEqual({ ok: false, reason: "unavailable" })
  })

  it("maps 500 to unavailable", async () => {
    const result = await fetchHistoryPage({
      page: 0,
      fetchImpl: fetchReturning(500, { reason: "unavailable" }),
    })
    expect(result).toEqual({ ok: false, reason: "unavailable" })
  })

  it("maps a network rejection to unavailable, never throwing", async () => {
    const result = await fetchHistoryPage({
      page: 0,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED")
      },
    })
    expect(result).toEqual({ ok: false, reason: "unavailable" })
  })

  it("maps malformed success JSON to unavailable", async () => {
    const result = await fetchHistoryPage({
      page: 0,
      fetchImpl: async () => new Response("not json {", { status: 200 }),
    })
    expect(result).toEqual({ ok: false, reason: "unavailable" })
  })

  it("maps a well-formed body missing the expected array to unavailable", async () => {
    const page = await fetchHistoryPage({
      page: 0,
      fetchImpl: fetchReturning(200, { nope: true }),
    })
    expect(page).toEqual({ ok: false, reason: "unavailable" })
    const thread = await fetchHistoryThread({
      conversationId: "conv-1",
      fetchImpl: fetchReturning(200, { nope: true }),
    })
    expect(thread).toEqual({ ok: false, reason: "unavailable" })
  })
})

describe("history client — happy paths", () => {
  it("projects listing rows field-by-field and consumes the hasMore envelope", async () => {
    const result = await fetchHistoryPage({
      page: 1,
      fetchImpl: fetchReturning(200, {
        threads: [
          {
            id: "t1",
            title: "Faith and doubt",
            updatedAt: "2026-07-12T08:00:00.000Z",
            extraServerField: "ignored",
          },
          { id: "t2", title: "", updatedAt: "2026-07-10T08:00:00.000Z" },
          { title: "no id — dropped" },
        ],
        page: 1,
        perPage: 20,
        total: 42,
        hasMore: true,
      }),
    })
    expect(result).toEqual({
      ok: true,
      threads: [
        {
          id: "t1",
          title: "Faith and doubt",
          updatedAt: "2026-07-12T08:00:00.000Z",
        },
        { id: "t2", title: "", updatedAt: "2026-07-10T08:00:00.000Z" },
      ],
      hasMore: true,
    })
  })

  it("projects transcript messages, dropping non-chat roles and empty turns", async () => {
    const result = await fetchHistoryThread({
      conversationId: "conv-1",
      fetchImpl: fetchReturning(200, {
        messages: [
          {
            id: "m1",
            role: "user",
            text: "hello",
            createdAt: "2026-07-10T10:00:00.000Z",
          },
          {
            id: "m2",
            role: "assistant",
            text: "hi there",
            createdAt: "2026-07-10T10:00:05.000Z",
          },
          { id: "m3", role: "system", text: "should drop" },
          { id: "m4", role: "assistant", text: "   " },
        ],
      }),
    })
    expect(result).toEqual({
      ok: true,
      messages: [
        {
          id: "m1",
          role: "user",
          text: "hello",
          createdAt: "2026-07-10T10:00:00.000Z",
        },
        {
          id: "m2",
          role: "assistant",
          text: "hi there",
          createdAt: "2026-07-10T10:00:05.000Z",
        },
      ],
    })
  })
})

describe("history client — request shape (R5)", () => {
  it("sends only { page } to the list route — never a resource field, never a page-size constant", async () => {
    const bodies: unknown[] = []
    const fetchImpl: typeof fetch = async (url, init) => {
      bodies.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return jsonResponse(200, { threads: [], hasMore: false })
    }
    await fetchHistoryPage({ page: 2, fetchImpl })
    expect(bodies).toEqual([{ url: "/api/history/list", body: { page: 2 } }])
  })

  it("sends only { conversationId } to the thread route", async () => {
    const bodies: unknown[] = []
    const fetchImpl: typeof fetch = async (url, init) => {
      bodies.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return jsonResponse(200, { messages: [] })
    }
    await fetchHistoryThread({ conversationId: "conv-7", fetchImpl })
    expect(bodies).toEqual([
      { url: "/api/history/thread", body: { conversationId: "conv-7" } },
    ])
  })

  it("composes the caller's abort signal into the fetch (aborting it aborts the request)", async () => {
    const controller = new AbortController()
    const seen: Array<AbortSignal | null | undefined> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      seen.push(init?.signal)
      return jsonResponse(200, { threads: [], hasMore: false })
    }
    await fetchHistoryPage({ page: 0, fetchImpl, signal: controller.signal })
    expect(seen[0]?.aborted).toBe(false)
    controller.abort()
    expect(seen[0]?.aborted).toBe(true)
  })

  it("times out a hung transport into unavailable (client-side ceiling)", async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })),
        )
      })
    const result = await fetchHistoryThread({
      conversationId: "conv-1",
      fetchImpl,
      timeoutMs: 20,
    })
    expect(result).toEqual({ ok: false, reason: "unavailable" })
  })
})

describe("history client — never-throw guarantee", () => {
  it("resolves (not rejects) even when fetch throws synchronously-shaped errors", async () => {
    const results = await Promise.all([
      fetchHistoryPage({
        page: 0,
        fetchImpl: (() => {
          throw new Error("sync throw")
        }) as unknown as typeof fetch,
      }).catch(() => "threw"),
      fetchHistoryThread({
        conversationId: "c",
        fetchImpl: (() => {
          throw new Error("sync throw")
        }) as unknown as typeof fetch,
      }).catch(() => "threw"),
    ])
    for (const result of results) {
      expect(result).not.toBe("threw")
      expect(vi.isMockFunction(result)).toBe(false)
      expect((result as { ok: boolean }).ok).toBe(false)
    }
  })
})

describe("history client — followUps re-validation (feat-366, AE6 client half)", () => {
  async function replay(message: Record<string, unknown>) {
    const result = await fetchHistoryThread({
      conversationId: "c1",
      fetchImpl: fetchReturning(200, { messages: [message] }),
    })
    expect(result.ok).toBe(true)
    return result.ok ? result.messages[0] : undefined
  }

  const stored = (followUps: unknown) => ({
    id: "r1",
    role: "assistant",
    text: "Replayed answer.",
    createdAt: "2026-08-20T00:00:00.000Z",
    followUps,
  })

  it("carries a valid stored list through onto the replayed turn", async () => {
    expect((await replay(stored(["Why pray?"])))?.followUps).toEqual([
      "Why pray?",
    ])
  })

  it("applies the SAME bound the live frame uses", async () => {
    // Chat bounds every upstream shape it renders, replay included: an
    // over-length item and a non-string drop, the rest pass through untouched
    // (mastra already filtered their CONTENT — AE6).
    const message = await replay(
      stored(["q".repeat(121), 7, "Why pray?", "Who is Jesus?"]),
    )
    expect(message?.followUps).toEqual(["Why pray?", "Who is Jesus?"])
  })

  it("caps a stored list at three, even if more were persisted", async () => {
    const message = await replay(stored(["a", "b", "c", "d", "e"]))
    expect(message?.followUps).toEqual(["a", "b", "c"])
  })

  it("leaves the key ABSENT — never [] — when nothing survives", async () => {
    const message = await replay(stored(["   ", 7]))
    expect(message).not.toBeUndefined()
    expect("followUps" in message!).toBe(false)
  })

  it("leaves the key absent for a junk (non-array) stored shape", async () => {
    const message = await replay(stored({ questions: ["Why pray?"] }))
    expect("followUps" in message!).toBe(false)
  })

  it("never fails the replay over malformed questions — the transcript is the point", async () => {
    const result = await fetchHistoryThread({
      conversationId: "c1",
      fetchImpl: fetchReturning(200, {
        messages: [stored("not an array at all")],
      }),
    })
    expect(result.ok).toBe(true)
    expect(result.ok && result.messages).toHaveLength(1)
  })
})

describe("history client — renameHistoryThread (feat-450, KTD6)", () => {
  const input = { conversationId: "conv-1", title: "Faith and doubt" }

  it("sends only { threadId, title } to the rename route — never a resource field", async () => {
    const bodies: unknown[] = []
    const fetchImpl: typeof fetch = async (url, init) => {
      bodies.push({
        url: String(url),
        method: init?.method,
        body: JSON.parse(String(init?.body)),
      })
      return jsonResponse(200, { ok: true, title: "Faith and doubt" })
    }
    await renameHistoryThread({ ...input, fetchImpl })
    expect(bodies).toEqual([
      {
        url: "/api/history/rename",
        method: "POST",
        body: { threadId: "conv-1", title: "Faith and doubt" },
      },
    ])
  })

  it("adopts the ECHOED title (the server clamp), not the submitted one", async () => {
    const result = await renameHistoryThread({
      ...input,
      fetchImpl: fetchReturning(200, { ok: true, title: "Faith" }),
    })
    expect(result).toEqual({ ok: true, title: "Faith" })
  })

  it("maps a 200 whose title is missing or not a string to unavailable (never writes undefined into a row)", async () => {
    for (const body of [
      { ok: true },
      { ok: true, title: 7 },
      { title: null },
    ]) {
      const result = await renameHistoryThread({
        ...input,
        fetchImpl: fetchReturning(200, body),
      })
      expect(result).toEqual({ ok: false, reason: "unavailable" })
    }
  })

  // One test per union branch with a status/body pair ONLY that branch can
  // match — the read path's mapping is kept verbatim (KTD6).
  it("maps 401 to access", async () => {
    expect(
      await renameHistoryThread({
        ...input,
        fetchImpl: fetchReturning(401, { reason: "invalid_session" }),
      }),
    ).toEqual({ ok: false, reason: "access" })
  })

  it("maps 403 gate_denied to access", async () => {
    expect(
      await renameHistoryThread({
        ...input,
        fetchImpl: fetchReturning(403, { reason: "gate_denied" }),
      }),
    ).toEqual({ ok: false, reason: "access" })
  })

  it("maps 403 thread_forbidden AND 404 thread_not_found to not_available", async () => {
    expect(
      await renameHistoryThread({
        ...input,
        fetchImpl: fetchReturning(403, { reason: "thread_forbidden" }),
      }),
    ).toEqual({ ok: false, reason: "not_available" })
    expect(
      await renameHistoryThread({
        ...input,
        fetchImpl: fetchReturning(404, { reason: "thread_not_found" }),
      }),
    ).toEqual({ ok: false, reason: "not_available" })
  })

  it("maps 400 invalid_title to invalid_title — only when the body carries it", async () => {
    expect(
      await renameHistoryThread({
        ...input,
        fetchImpl: fetchReturning(400, { reason: "invalid_title" }),
      }),
    ).toEqual({ ok: false, reason: "invalid_title" })
    expect(
      await renameHistoryThread({
        ...input,
        fetchImpl: fetchReturning(400, { reason: "invalid_body" }),
      }),
    ).toEqual({ ok: false, reason: "unavailable" })
    expect(
      await renameHistoryThread({
        ...input,
        fetchImpl: async () =>
          new Response("<html>400</html>", { status: 400 }),
      }),
    ).toEqual({ ok: false, reason: "unavailable" })
  })

  it("maps reasonless 403/404, 5xx, non-JSON, and transport failures to unavailable", async () => {
    const fetchers: Array<typeof fetch> = [
      fetchReturning(403, {}),
      fetchReturning(404, { error: "Not found" }),
      fetchReturning(502, { reason: "unavailable" }),
      fetchReturning(504, { reason: "timeout" }),
      async () => new Response("not json {", { status: 200 }),
      async () => {
        throw new Error("ECONNREFUSED")
      },
    ]
    for (const fetchImpl of fetchers) {
      expect(await renameHistoryThread({ ...input, fetchImpl })).toEqual({
        ok: false,
        reason: "unavailable",
      })
    }
  })

  it("never widens the READ fetchers' vocabulary: a 400 invalid_title on a read maps to unavailable", async () => {
    const result = await fetchHistoryThread({
      conversationId: "conv-1",
      fetchImpl: fetchReturning(400, { reason: "invalid_title" }),
    })
    expect(result).toEqual({ ok: false, reason: "unavailable" })
  })

  it("composes the caller's abort signal and times out a hung transport into unavailable", async () => {
    const controller = new AbortController()
    const seen: Array<AbortSignal | null | undefined> = []
    await renameHistoryThread({
      ...input,
      signal: controller.signal,
      fetchImpl: async (_url, init) => {
        seen.push(init?.signal)
        return jsonResponse(200, { ok: true, title: "t" })
      },
    })
    controller.abort()
    expect(seen[0]?.aborted).toBe(true)

    const hung: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })),
        )
      })
    expect(
      await renameHistoryThread({ ...input, fetchImpl: hung, timeoutMs: 20 }),
    ).toEqual({ ok: false, reason: "unavailable" })
  })

  it("never throws, even on a synchronously throwing fetch", async () => {
    const result = await renameHistoryThread({
      ...input,
      fetchImpl: (() => {
        throw new Error("sync throw")
      }) as unknown as typeof fetch,
    }).catch(() => "threw")
    expect(result).toEqual({ ok: false, reason: "unavailable" })
  })
})
