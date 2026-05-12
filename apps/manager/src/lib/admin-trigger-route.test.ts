import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mocks must register BEFORE the SUT module loads so the dynamic import
// below picks them up. The dynamic import is the same shape used by
// admin-trigger-auth.test.ts and admin-embed-trigger.test.ts.
vi.mock("@/config/env", () => ({
  env: {} as { ADMIN_TRIGGER_API_KEYS?: string },
}))

const { defaultClientMock } = vi.hoisted(() => ({
  defaultClientMock: vi.fn(),
}))

vi.mock("@/cms/client", () => ({
  default: () => ({ query: defaultClientMock }),
}))

const { env } = await import("@/config/env")
const {
  processAdminTriggerRequest,
  resolveDispatchFields,
  __clearInFlightMapForTests,
  AdminTriggerBodySchema,
} = await import("@/lib/admin-trigger-route")

const envMutable = env as { ADMIN_TRIGGER_API_KEYS?: string }

const BEARER_OK = "test-trigger-key-123"

function makeRequest(body: unknown, opts: { bearer?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  const bearer = opts.bearer === undefined ? BEARER_OK : opts.bearer
  if (bearer !== null) headers.authorization = `Bearer ${bearer}`
  return new Request("http://example.test/api/admin-trigger/scene-analysis", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

type VideoLabel =
  | "behindTheScenes"
  | "collection"
  | "episode"
  | "featureFilm"
  | "segment"
  | "series"
  | "shortFilm"
  | "trailer"

function videoFixture(overrides: {
  documentId: string
  coreId: string
  bcp47?: string
  withMuxVariant?: boolean
  withSubtitle?: boolean
  label?: VideoLabel
}) {
  const bcp47 = overrides.bcp47 ?? "en"
  return {
    documentId: overrides.documentId,
    coreId: overrides.coreId,
    title: "Title",
    label: (overrides.label ?? "featureFilm") as VideoLabel,
    primaryLanguage: { coreId: "lang-en", bcp47 },
    subtitles:
      overrides.withSubtitle === false
        ? []
        : [
            {
              primary: true,
              aiGenerated: false,
              vttSrc: `https://stream.mux.com/${overrides.documentId}.vtt`,
              language: { coreId: "lang-en", bcp47 },
            },
          ],
    variants:
      overrides.withMuxVariant === false
        ? []
        : [
            {
              muxVideo: { assetId: `mux-${overrides.documentId}` },
              language: { coreId: "lang-en", bcp47 },
            },
          ],
  }
}

const DISPATCH_OK = vi.fn(async () => ({}))

beforeEach(() => {
  envMutable.ADMIN_TRIGGER_API_KEYS = BEARER_OK
  __clearInFlightMapForTests()
  defaultClientMock.mockReset()
  DISPATCH_OK.mockReset()
  DISPATCH_OK.mockResolvedValue({})
})

afterEach(() => {
  envMutable.ADMIN_TRIGGER_API_KEYS = undefined
})

describe("AdminTriggerBodySchema", () => {
  it("dedupes by assetId", () => {
    const parsed = AdminTriggerBodySchema.parse({
      items: [
        { assetId: 1, coreId: "c-1" },
        { assetId: 1, coreId: "c-1-dup" }, // first wins
        { assetId: 2, coreId: "c-2" },
      ],
    })
    expect(parsed.items).toEqual([
      { assetId: 1, coreId: "c-1" },
      { assetId: 2, coreId: "c-2" },
    ])
  })

  it("rejects empty items", () => {
    const result = AdminTriggerBodySchema.safeParse({ items: [] })
    expect(result.success).toBe(false)
  })

  it("rejects negative assetId", () => {
    const result = AdminTriggerBodySchema.safeParse({
      items: [{ assetId: -1, coreId: "x" }],
    })
    expect(result.success).toBe(false)
  })

  it("rejects items above the 100 cap", () => {
    const items = Array.from({ length: 101 }, (_, i) => ({
      assetId: i + 1,
      coreId: `c-${i}`,
    }))
    const result = AdminTriggerBodySchema.safeParse({ items })
    expect(result.success).toBe(false)
  })
})

describe("resolveDispatchFields", () => {
  it("picks the primary-language variant + subtitle", () => {
    const fields = resolveDispatchFields(
      videoFixture({ documentId: "d-1", coreId: "c-1" }),
    )
    expect(fields).toMatchObject({
      muxAssetId: "mux-d-1",
      subtitleUrl: "https://stream.mux.com/d-1.vtt",
      languageBcp47: "en",
      videoLabel: "featureFilm",
    })
  })

  it("returns null when no primary-language variant has a mux assetId", () => {
    const v = videoFixture({
      documentId: "d-2",
      coreId: "c-2",
      withMuxVariant: false,
    })
    expect(resolveDispatchFields(v)).toBeNull()
  })

  it("returns null when no primary-language subtitle exists", () => {
    const v = videoFixture({
      documentId: "d-3",
      coreId: "c-3",
      withSubtitle: false,
    })
    expect(resolveDispatchFields(v)).toBeNull()
  })

  it("prefers primary + non-AI subtitles when multiple match", () => {
    const v = videoFixture({ documentId: "d-4", coreId: "c-4" })
    v.subtitles = [
      {
        primary: false,
        aiGenerated: true,
        vttSrc: "https://stream.mux.com/d-4-ai.vtt",
        language: { coreId: "lang-en", bcp47: "en" },
      },
      {
        primary: true,
        aiGenerated: false,
        vttSrc: "https://stream.mux.com/d-4-primary.vtt",
        language: { coreId: "lang-en", bcp47: "en" },
      },
    ]
    expect(resolveDispatchFields(v)?.subtitleUrl).toBe(
      "https://stream.mux.com/d-4-primary.vtt",
    )
  })

  it("falls back to label='unknown' when video.label is missing", () => {
    const v = videoFixture({ documentId: "d-5", coreId: "c-5" })
    // @ts-expect-error — exercising the null-label path
    v.label = null
    expect(resolveDispatchFields(v)?.videoLabel).toBe("unknown")
  })
})

describe("processAdminTriggerRequest — auth", () => {
  it("returns 503 when ADMIN_TRIGGER_API_KEYS is unset", async () => {
    envMutable.ADMIN_TRIGGER_API_KEYS = undefined
    const req = makeRequest({ items: [{ assetId: 1, coreId: "c-1" }] })
    const res = await processAdminTriggerRequest({
      request: req,
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
    })
    expect(res.status).toBe(503)
    expect(defaultClientMock).not.toHaveBeenCalled()
    expect(DISPATCH_OK).not.toHaveBeenCalled()
  })

  it("returns 401 when bearer is missing", async () => {
    const req = makeRequest(
      { items: [{ assetId: 1, coreId: "c-1" }] },
      { bearer: null },
    )
    const res = await processAdminTriggerRequest({
      request: req,
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
    })
    expect(res.status).toBe(401)
    expect(DISPATCH_OK).not.toHaveBeenCalled()
  })

  it("returns 401 when bearer is wrong", async () => {
    const req = makeRequest(
      { items: [{ assetId: 1, coreId: "c-1" }] },
      { bearer: "wrong-key-x" },
    )
    const res = await processAdminTriggerRequest({
      request: req,
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
    })
    expect(res.status).toBe(401)
  })
})

describe("processAdminTriggerRequest — body validation", () => {
  it("returns 400 on malformed JSON", async () => {
    const req = makeRequest("{ not json")
    const res = await processAdminTriggerRequest({
      request: req,
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
    })
    expect(res.status).toBe(400)
  })

  it("returns 400 on validation failure (empty items)", async () => {
    const req = makeRequest({ items: [] })
    const res = await processAdminTriggerRequest({
      request: req,
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
    })
    expect(res.status).toBe(400)
  })
})

describe("processAdminTriggerRequest — happy path", () => {
  it("dispatches per-item and returns started results with a managerJobId", async () => {
    defaultClientMock.mockResolvedValueOnce({
      data: {
        videos: [
          videoFixture({ documentId: "d-1", coreId: "c-1" }),
          videoFixture({ documentId: "d-2", coreId: "c-2" }),
        ],
      },
    })

    const dispatched: Array<unknown> = []
    const req = makeRequest({
      items: [
        { assetId: 1, coreId: "c-1" },
        { assetId: 2, coreId: "c-2" },
      ],
    })

    const res = await processAdminTriggerRequest({
      request: req,
      kind: "scene-analysis",
      dispatch: async (input) => {
        dispatched.push(input)
        return {}
      },
      scheduleAfter: (cb) => {
        // Run immediately and synchronously-flush so the test
        // can observe the dispatch call before exit.
        void cb()
      },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      results: Array<{ assetId: number; status: string; managerJobId: string }>
    }
    expect(body.results).toHaveLength(2)
    expect(body.results.map((r) => r.status)).toEqual(["started", "started"])
    expect(body.results[0].managerJobId).toBeTruthy()
    expect(body.results[1].managerJobId).not.toBe(body.results[0].managerJobId)

    // Allow the synchronous schedule to run.
    await new Promise((r) => setTimeout(r, 0))
    expect(dispatched).toHaveLength(2)
  })

  it("returns not_found for items whose coreId has no cms video", async () => {
    defaultClientMock.mockResolvedValueOnce({ data: { videos: [] } })

    const req = makeRequest({
      items: [{ assetId: 999, coreId: "c-missing" }],
    })

    const res = await processAdminTriggerRequest({
      request: req,
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
      scheduleAfter: (cb) => {
        void cb()
      },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      results: Array<{ assetId: number; status: string; managerJobId: null }>
    }
    expect(body.results).toEqual([
      expect.objectContaining({
        assetId: 999,
        coreId: "c-missing",
        managerJobId: null,
        status: "not_found",
      }),
    ])
    expect(DISPATCH_OK).not.toHaveBeenCalled()
  })

  it("returns validation_failed for cms video missing required relations", async () => {
    defaultClientMock.mockResolvedValueOnce({
      data: {
        videos: [
          videoFixture({
            documentId: "d-bad",
            coreId: "c-bad",
            withMuxVariant: false,
          }),
        ],
      },
    })

    const req = makeRequest({
      items: [{ assetId: 5, coreId: "c-bad" }],
    })

    const res = await processAdminTriggerRequest({
      request: req,
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const body = (await res.json()) as {
      results: Array<{ status: string; managerJobId: null }>
    }
    expect(body.results[0].status).toBe("validation_failed")
    expect(body.results[0].managerJobId).toBeNull()
    expect(DISPATCH_OK).not.toHaveBeenCalled()
  })
})

describe("AdminTriggerBodySchema — forward-compat", () => {
  it("tolerates unknown per-item fields (Postel's law receiver)", () => {
    const parsed = AdminTriggerBodySchema.parse({
      items: [
        // future field admin might add later — should NOT 400 against an
        // older manager. The deploy-ordering invariant is receiver-first
        // for required keys; optional-key forward-compat needs strict=false.
        { assetId: 1, coreId: "c-1", priority: "high" },
      ],
    })
    expect(parsed.items).toEqual([{ assetId: 1, coreId: "c-1" }])
  })
})

describe("processAdminTriggerRequest — cms lookup failures", () => {
  it("times out the cms lookup and returns 502 cms_unreachable when Strapi hangs", async () => {
    // Apollo never resolves — only the in-route Promise.race timer
    // fires. Use fake timers so we don't wait the real 10s.
    vi.useFakeTimers()
    defaultClientMock.mockReturnValueOnce(
      new Promise(() => {
        /* never resolves */
      }),
    )

    const resPromise = processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 1, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    // Advance past the 10s CMS_LOOKUP_TIMEOUT_MS budget.
    await vi.advanceTimersByTimeAsync(10_500)
    const res = await resPromise
    vi.useRealTimers()

    expect(res.status).toBe(502)
    const body = (await res.json()) as { reason: string; message: string }
    expect(body.reason).toBe("cms_unreachable")
    expect(body.message).toMatch(/cms lookup timed out after 10000ms/i)
    expect(DISPATCH_OK).not.toHaveBeenCalled()
  })

  it("returns 502 with reason=cms_unreachable when Apollo throws (real Error shape)", async () => {
    // Mocked-vs-real discipline: throw the kind of error Apollo
    // raises on a network failure (a real Error with `name` set),
    // not a generic Error — so the route's catch branch matches
    // production shapes.
    const apolloErr = Object.assign(new Error("ECONNREFUSED 127.0.0.1:1337"), {
      name: "ApolloError",
    })
    defaultClientMock.mockRejectedValueOnce(apolloErr)

    const res = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 1, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    expect(res.status).toBe(502)
    const body = (await res.json()) as {
      error: string
      reason: string
      message: string
    }
    expect(body.reason).toBe("cms_unreachable")
    expect(body.message).toContain("ECONNREFUSED")
    expect(DISPATCH_OK).not.toHaveBeenCalled()
  })
})

describe("processAdminTriggerRequest — idempotency", () => {
  it("second call with same kind+assetId returns already_in_flight with the same managerJobId", async () => {
    defaultClientMock.mockResolvedValue({
      data: {
        videos: [videoFixture({ documentId: "d-1", coreId: "c-1" })],
      },
    })

    // The dispatch fn here intentionally NEVER resolves — keeps the
    // first call's slot in the in-flight map across the second call.
    const neverDispatch = vi.fn(
      () => new Promise<unknown>(() => {}) as Promise<unknown>,
    )

    const first = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 7, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch: neverDispatch,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const firstBody = (await first.json()) as {
      results: Array<{ status: string; managerJobId: string }>
    }
    expect(firstBody.results[0].status).toBe("started")
    const firstJobId = firstBody.results[0].managerJobId

    const second = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 7, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch: neverDispatch,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const secondBody = (await second.json()) as {
      results: Array<{ status: string; managerJobId: string }>
    }
    expect(secondBody.results[0].status).toBe("already_in_flight")
    expect(secondBody.results[0].managerJobId).toBe(firstJobId)
    // Only the first call should have invoked dispatch.
    expect(neverDispatch).toHaveBeenCalledTimes(1)
  })

  it("different kinds for same assetId do NOT collide", async () => {
    defaultClientMock.mockResolvedValue({
      data: {
        videos: [videoFixture({ documentId: "d-1", coreId: "c-1" })],
      },
    })
    const neverDispatch = vi.fn(
      () => new Promise<unknown>(() => {}) as Promise<unknown>,
    )

    const sceneRes = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 7, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch: neverDispatch,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const transcriptRes = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 7, coreId: "c-1" }] }),
      kind: "transcript",
      dispatch: neverDispatch,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const sceneBody = (await sceneRes.json()) as {
      results: Array<{ status: string }>
    }
    const transcriptBody = (await transcriptRes.json()) as {
      results: Array<{ status: string }>
    }
    expect(sceneBody.results[0].status).toBe("started")
    expect(transcriptBody.results[0].status).toBe("started")
    expect(neverDispatch).toHaveBeenCalledTimes(2)
  })

  it("releases the slot after the dispatch REJECTS (sad-path slot leak guard)", async () => {
    defaultClientMock.mockResolvedValue({
      data: {
        videos: [videoFixture({ documentId: "d-1", coreId: "c-1" })],
      },
    })

    let rejectFirst: (err: Error) => void = () => {}
    const dispatch = vi.fn(
      () =>
        new Promise<unknown>((_, reject) => {
          rejectFirst = (err) => reject(err)
        }),
    )

    await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 99, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch,
      scheduleAfter: (cb) => {
        // Run cb inside a try/catch so an unhandled rejection from
        // the inner dispatch (which we're about to reject) doesn't
        // crash the test runner. Production schedule wrapper does
        // the same via after()'s promise lifecycle.
        void cb().catch(() => {})
      },
    })
    // Reject the in-flight dispatch — the inner try/finally MUST
    // release the slot.
    rejectFirst(new Error("pipeline blew up"))
    await new Promise((r) => setTimeout(r, 0))

    const second = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 99, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch: vi.fn(async () => ({})),
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const body = (await second.json()) as {
      results: Array<{ status: string }>
    }
    expect(body.results[0].status).toBe("started")
  })

  it("releases the slot when dispatch throws SYNCHRONOUSLY (sad-path slot leak guard)", async () => {
    // Defense-in-depth: the schedule cb wraps EVERYTHING in
    // try/finally, not just the await. A dispatcher that throws
    // before returning a Promise must still leave the slot free
    // for a re-trigger.
    defaultClientMock.mockResolvedValue({
      data: {
        videos: [videoFixture({ documentId: "d-1", coreId: "c-1" })],
      },
    })
    const throwingDispatch = vi.fn((): Promise<unknown> => {
      throw new Error("synchronous dispatch failure")
    })

    await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 50, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch: throwingDispatch,
      scheduleAfter: (cb) => {
        void cb().catch(() => {})
      },
    })
    await new Promise((r) => setTimeout(r, 0))

    // Slot must be free for a re-trigger.
    const second = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 50, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch: vi.fn(async () => ({})),
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const body = (await second.json()) as {
      results: Array<{ status: string }>
    }
    expect(body.results[0].status).toBe("started")
  })

  it("releases the slot after the dispatch resolves", async () => {
    defaultClientMock.mockResolvedValue({
      data: {
        videos: [videoFixture({ documentId: "d-1", coreId: "c-1" })],
      },
    })

    let resolveFirst: () => void = () => {}
    const dispatch = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveFirst = () => resolve({})
        }),
    )

    await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 8, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    // Resolve the first dispatch — the in-flight slot should free.
    resolveFirst()
    await new Promise((r) => setTimeout(r, 0))

    const second = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 8, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const body = (await second.json()) as {
      results: Array<{ status: string }>
    }
    expect(body.results[0].status).toBe("started")
  })
})
