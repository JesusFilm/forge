import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mocks must register BEFORE the SUT module loads so the dynamic import
// below picks them up. The dynamic import is the same shape used by
// admin-trigger-auth.test.ts and admin-embed-trigger.test.ts.
vi.mock("@/config/env", () => ({
  env: {} as { ADMIN_TRIGGER_API_KEYS?: string },
}))

import type {
  AdminVideoLookupEnvelope,
  AdminVideoLookupRequest,
  VideoForEnrichment,
} from "@/lib/admin-video-lookup"

const { env } = await import("@/config/env")
const {
  processAdminTriggerRequest,
  __clearInFlightMapForTests,
  __setDispatchConcurrencyForTests,
  __setMaxPendingDispatchesForTests,
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

function videoFixture(overrides: {
  id?: string
  coreId: string
  label?: string | null
  targetLocale?: string | null
  primaryLanguageBcp47?: string | null
  languageBcp47?: string | null
  muxAssetId?: string | null
  subtitleUrl?: string | null
}): VideoForEnrichment {
  // Distinguish "not provided" from "explicitly null" — the route's
  // validation_failed branch fires on explicit null, so nullish
  // coalescing (`?? "en"`) would silently flip null → default and
  // hide the regression. Use the `in` operator to honor a caller-
  // supplied null.
  return {
    id: overrides.id ?? `v-${overrides.coreId}`,
    coreId: overrides.coreId,
    label: "label" in overrides ? (overrides.label ?? null) : "featureFilm",
    targetLocale:
      "targetLocale" in overrides ? (overrides.targetLocale ?? null) : null,
    primaryLanguageBcp47:
      "primaryLanguageBcp47" in overrides
        ? (overrides.primaryLanguageBcp47 ?? null)
        : "en",
    languageBcp47:
      "languageBcp47" in overrides
        ? (overrides.languageBcp47 ?? null)
        : "primaryLanguageBcp47" in overrides
          ? (overrides.primaryLanguageBcp47 ?? null)
          : "en",
    muxAssetId:
      "muxAssetId" in overrides
        ? (overrides.muxAssetId ?? null)
        : `mux-${overrides.coreId}`,
    subtitleUrl:
      "subtitleUrl" in overrides
        ? (overrides.subtitleUrl ?? null)
        : `https://stream.mux.com/${overrides.coreId}.vtt`,
  }
}

function adminLookupOk(rows: VideoForEnrichment[]): AdminVideoLookupEnvelope {
  const map = new Map<string, VideoForEnrichment>()
  for (const r of rows) {
    map.set(r.targetLocale ? `${r.coreId}::${r.targetLocale}` : r.coreId, r)
  }
  return { ok: true, data: map }
}

function lookupCoreIds(requests: readonly AdminVideoLookupRequest[]): string[] {
  return requests.map((request) => request.coreId)
}

const DISPATCH_OK = vi.fn(async () => ({}))

beforeEach(() => {
  envMutable.ADMIN_TRIGGER_API_KEYS = BEARER_OK
  __clearInFlightMapForTests()
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

  it("keeps the same assetId when targetLocale differs", () => {
    const parsed = AdminTriggerBodySchema.parse({
      items: [
        { assetId: 1, coreId: "c-1", targetLocale: "en" },
        { assetId: 1, coreId: "c-1", targetLocale: "es" },
      ],
    })
    expect(parsed.items).toEqual([
      { assetId: 1, coreId: "c-1", targetLocale: "en" },
      { assetId: 1, coreId: "c-1", targetLocale: "es" },
    ])
  })

  it("normalizes targetLocale casing before same-asset dedupe", () => {
    const parsed = AdminTriggerBodySchema.parse({
      items: [
        { assetId: 1, coreId: "c-1", targetLocale: "ES" },
        { assetId: 1, coreId: "c-1", targetLocale: "es" },
      ],
    })
    expect(parsed.items).toEqual([
      { assetId: 1, coreId: "c-1", targetLocale: "es" },
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

  it("tolerates unknown per-item fields (Postel's law receiver)", () => {
    const parsed = AdminTriggerBodySchema.parse({
      items: [
        // future field admin might add later — should NOT 400 against an
        // older manager. Receiver-first deploy-ordering protects required
        // keys; optional-key forward-compat needs strict=false.
        { assetId: 1, coreId: "c-1", priority: "high" },
      ],
    })
    expect(parsed.items).toEqual([{ assetId: 1, coreId: "c-1" }])
  })
})

describe("processAdminTriggerRequest — auth", () => {
  it("returns 503 when ADMIN_TRIGGER_API_KEYS is unset", async () => {
    envMutable.ADMIN_TRIGGER_API_KEYS = undefined
    const adminLookup = vi.fn(async () => adminLookupOk([]))
    const req = makeRequest({ items: [{ assetId: 1, coreId: "c-1" }] })
    const res = await processAdminTriggerRequest({
      request: req,
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
      adminLookup,
    })
    expect(res.status).toBe(503)
    expect(adminLookup).not.toHaveBeenCalled()
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
    const adminLookup = vi.fn(async () =>
      adminLookupOk([
        videoFixture({ coreId: "c-1" }),
        videoFixture({ coreId: "c-2" }),
      ]),
    )

    const dispatched: Array<{ assetId: number; muxAssetId: string }> = []
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
        dispatched.push({
          assetId: input.assetId,
          muxAssetId: input.muxAssetId,
        })
        return {}
      },
      adminLookup,
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
    expect(dispatched[0].muxAssetId).toBe("mux-c-1")
  })

  it("queues accepted dispatches behind a bounded process-local concurrency cap", async () => {
    __setDispatchConcurrencyForTests(1)
    const adminLookup = vi.fn(async () =>
      adminLookupOk([
        videoFixture({ coreId: "c-1" }),
        videoFixture({ coreId: "c-2" }),
        videoFixture({ coreId: "c-3" }),
      ]),
    )
    const started: number[] = []
    const resolvers: Array<() => void> = []
    const dispatch = vi.fn(
      (input) =>
        new Promise<unknown>((resolve) => {
          started.push(input.assetId)
          resolvers.push(() => resolve({}))
        }),
    )

    const res = await processAdminTriggerRequest({
      request: makeRequest({
        items: [
          { assetId: 1, coreId: "c-1" },
          { assetId: 2, coreId: "c-2" },
          { assetId: 3, coreId: "c-3" },
        ],
      }),
      kind: "transcript",
      dispatch,
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const body = (await res.json()) as {
      results: Array<{ status: string }>
    }

    expect(body.results.map((r) => r.status)).toEqual([
      "started",
      "started",
      "started",
    ])
    await new Promise((r) => setTimeout(r, 0))
    expect(started).toEqual([1])
    expect(dispatch).toHaveBeenCalledTimes(1)

    resolvers[0]()
    await new Promise((r) => setTimeout(r, 0))
    expect(started).toEqual([1, 2])
    expect(dispatch).toHaveBeenCalledTimes(2)

    resolvers[1]()
    await new Promise((r) => setTimeout(r, 0))
    expect(started).toEqual([1, 2, 3])
    expect(dispatch).toHaveBeenCalledTimes(3)

    resolvers[2]()
    await new Promise((r) => setTimeout(r, 0))
  })

  it("shares the concurrency cap across separate requests and trigger kinds", async () => {
    __setDispatchConcurrencyForTests(1)
    const adminLookup = vi.fn(
      async (requests: readonly AdminVideoLookupRequest[]) =>
        adminLookupOk(
          lookupCoreIds(requests).map((coreId) => videoFixture({ coreId })),
        ),
    )
    const started: Array<{ kind: string; assetId: number }> = []
    const resolvers: Array<() => void> = []
    const dispatchFor = (kind: string) =>
      vi.fn(
        (input) =>
          new Promise<unknown>((resolve) => {
            started.push({ kind, assetId: input.assetId })
            resolvers.push(() => resolve({}))
          }),
      )
    const transcriptDispatch = dispatchFor("transcript")
    const sceneDispatch = dispatchFor("scene-analysis")

    await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 1, coreId: "c-1" }] }),
      kind: "transcript",
      dispatch: transcriptDispatch,
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 2, coreId: "c-2" }] }),
      kind: "scene-analysis",
      dispatch: sceneDispatch,
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })

    await new Promise((r) => setTimeout(r, 0))
    expect(started).toEqual([{ kind: "transcript", assetId: 1 }])
    expect(transcriptDispatch).toHaveBeenCalledTimes(1)
    expect(sceneDispatch).not.toHaveBeenCalled()

    resolvers[0]()
    await new Promise((r) => setTimeout(r, 0))
    expect(started).toEqual([
      { kind: "transcript", assetId: 1 },
      { kind: "scene-analysis", assetId: 2 },
    ])
    expect(sceneDispatch).toHaveBeenCalledTimes(1)

    resolvers[1]()
    await new Promise((r) => setTimeout(r, 0))
  })

  it("keeps scheduled after work pending until this request's queued jobs settle", async () => {
    __setDispatchConcurrencyForTests(1)
    const adminLookup = vi.fn(async () =>
      adminLookupOk([
        videoFixture({ coreId: "c-1" }),
        videoFixture({ coreId: "c-2" }),
      ]),
    )
    const resolvers: Array<() => void> = []
    const dispatch = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolvers.push(() => resolve({}))
        }),
    )
    let scheduleSettled = false

    await processAdminTriggerRequest({
      request: makeRequest({
        items: [
          { assetId: 1, coreId: "c-1" },
          { assetId: 2, coreId: "c-2" },
        ],
      }),
      kind: "transcript",
      dispatch,
      adminLookup,
      scheduleAfter: (cb) => {
        void cb().then(() => {
          scheduleSettled = true
        })
      },
    })

    await new Promise((r) => setTimeout(r, 0))
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(scheduleSettled).toBe(false)

    resolvers[0]()
    await new Promise((r) => setTimeout(r, 0))
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(scheduleSettled).toBe(false)

    resolvers[1]()
    await new Promise((r) => setTimeout(r, 0))
    expect(scheduleSettled).toBe(true)
  })

  it("returns a retryable 503 instead of accepting work when the dispatch queue is full", async () => {
    __setDispatchConcurrencyForTests(1)
    __setMaxPendingDispatchesForTests(1)
    const adminLookup = vi.fn(
      async (requests: readonly AdminVideoLookupRequest[]) =>
        adminLookupOk(
          lookupCoreIds(requests).map((coreId) => videoFixture({ coreId })),
        ),
    )
    const dispatch = vi.fn(
      () => new Promise<unknown>(() => {}) as Promise<unknown>,
    )

    const first = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 1, coreId: "c-1" }] }),
      kind: "transcript",
      dispatch,
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    expect(first.status).toBe(200)
    await new Promise((r) => setTimeout(r, 0))
    expect(dispatch).toHaveBeenCalledTimes(1)

    const second = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 2, coreId: "c-2" }] }),
      kind: "transcript",
      dispatch,
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    expect(second.status).toBe(503)
    const body = (await second.json()) as {
      error: string
      retryable: boolean
      maxPendingDispatches: number
    }
    expect(body).toEqual(
      expect.objectContaining({
        error: "manager dispatch queue full",
        retryable: true,
        maxPendingDispatches: 1,
      }),
    )
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it("does not spend queue capacity on validation_failed, not_found, or already_in_flight rows", async () => {
    __setDispatchConcurrencyForTests(1)
    __setMaxPendingDispatchesForTests(1)
    const dispatch = vi.fn(
      () => new Promise<unknown>(() => {}) as Promise<unknown>,
    )
    const adminLookup = vi.fn(
      async (requests: readonly AdminVideoLookupRequest[]) =>
        adminLookupOk(
          lookupCoreIds(requests).flatMap((coreId) => {
            if (coreId === "c-missing") return []
            if (coreId === "c-no-mux") {
              return [videoFixture({ coreId, muxAssetId: null })]
            }
            return [videoFixture({ coreId })]
          }),
        ),
    )

    const first = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 1, coreId: "c-1" }] }),
      kind: "transcript",
      dispatch,
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    expect(first.status).toBe(200)
    await new Promise((r) => setTimeout(r, 0))
    expect(dispatch).toHaveBeenCalledTimes(1)

    const nonDispatching = await processAdminTriggerRequest({
      request: makeRequest({
        items: [
          { assetId: 1, coreId: "c-1" },
          { assetId: 2, coreId: "c-no-mux" },
          { assetId: 3, coreId: "c-missing" },
        ],
      }),
      kind: "transcript",
      dispatch,
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    expect(nonDispatching.status).toBe(200)
    const body = (await nonDispatching.json()) as {
      results: Array<{ assetId: number; status: string }>
    }
    expect(body.results).toEqual([
      expect.objectContaining({ assetId: 1, status: "already_in_flight" }),
      expect.objectContaining({ assetId: 2, status: "validation_failed" }),
      expect.objectContaining({ assetId: 3, status: "not_found" }),
    ])
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it("forwards Admin video id without reintroducing legacy document id targeting", async () => {
    const adminLookup = vi.fn(async () =>
      adminLookupOk([videoFixture({ id: "admin-video-1", coreId: "c-1" })]),
    )
    let captured: Record<string, unknown> | null = null

    await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 1, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch: async (input) => {
        captured = input as unknown as Record<string, unknown>
        return {}
      },
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    await new Promise((r) => setTimeout(r, 0))

    expect(captured).not.toBeNull()
    expect(captured).not.toHaveProperty("documentId")
    expect(captured).toHaveProperty("adminVideoId", "admin-video-1")
  })

  it("returns not_found for items whose coreId admin did not return", async () => {
    const adminLookup = vi.fn(async () => adminLookupOk([]))

    const req = makeRequest({
      items: [{ assetId: 999, coreId: "c-missing" }],
    })

    const res = await processAdminTriggerRequest({
      request: req,
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
      adminLookup,
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

  it("returns validation_failed when admin returns null muxAssetId", async () => {
    const adminLookup = vi.fn(async () =>
      adminLookupOk([videoFixture({ coreId: "c-bad", muxAssetId: null })]),
    )

    const res = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 5, coreId: "c-bad" }] }),
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
      adminLookup,
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

  it("starts scene-analysis when admin returns null subtitleUrl and mux can generate subtitles", async () => {
    const adminLookup = vi.fn(async () =>
      adminLookupOk([videoFixture({ coreId: "c-no-sub", subtitleUrl: null })]),
    )

    const res = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 6, coreId: "c-no-sub" }] }),
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const body = (await res.json()) as {
      results: Array<{ status: string }>
    }
    expect(body.results[0].status).toBe("started")
    expect(DISPATCH_OK).toHaveBeenCalledWith(
      expect.objectContaining({
        muxAssetId: "mux-c-no-sub",
        subtitleUrl: "",
        languageBcp47: "en",
      }),
    )
  })

  it("dispatches requested target locale media and language for localized scene analysis", async () => {
    const adminLookup = vi.fn(async () =>
      adminLookupOk([
        videoFixture({
          coreId: "c-es",
          targetLocale: "es",
          primaryLanguageBcp47: "en",
          languageBcp47: "es",
          muxAssetId: "mux-c-es",
          subtitleUrl: "https://stream.mux.com/c-es.vtt",
        }),
      ]),
    )

    const res = await processAdminTriggerRequest({
      request: makeRequest({
        items: [{ assetId: 42, coreId: "c-es", targetLocale: "es" }],
      }),
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const body = (await res.json()) as {
      results: Array<{ status: string; targetLocale?: string }>
    }

    expect(body.results[0]).toMatchObject({
      status: "started",
      targetLocale: "es",
    })
    expect(adminLookup).toHaveBeenCalledWith([
      { coreId: "c-es", targetLocale: "es" },
    ])
    expect(DISPATCH_OK).toHaveBeenCalledWith(
      expect.objectContaining({
        targetLocale: "es",
        muxAssetId: "mux-c-es",
        subtitleUrl: "https://stream.mux.com/c-es.vtt",
        languageBcp47: "es",
      }),
    )
  })

  it("returns validation_failed when admin returns null primaryLanguageBcp47", async () => {
    const adminLookup = vi.fn(async () =>
      adminLookupOk([
        videoFixture({ coreId: "c-no-lang", primaryLanguageBcp47: null }),
      ]),
    )

    const res = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 7, coreId: "c-no-lang" }] }),
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const body = (await res.json()) as {
      results: Array<{ status: string }>
    }
    expect(body.results[0].status).toBe("validation_failed")
    expect(DISPATCH_OK).not.toHaveBeenCalled()
  })

  it("validation_failed message lists ONLY the missing fields (mux only) when other dispatch fields are present", async () => {
    // Guard the dynamic gap-naming behavior: if a future refactor
    // collapsed the message back to a static string, operator
    // triage signal regresses without any other test failing.
    const adminLookup = vi.fn(async () =>
      adminLookupOk([videoFixture({ coreId: "c-only-mux", muxAssetId: null })]),
    )

    const res = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 10, coreId: "c-only-mux" }] }),
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const body = (await res.json()) as {
      results: Array<{ status: string; message?: string }>
    }
    expect(body.results[0].status).toBe("validation_failed")
    expect(body.results[0].message).toContain("mux variant")
    expect(body.results[0].message).not.toContain("primary language")
    expect(body.results[0].message).not.toContain("subtitle")
  })

  it("validation_failed message lists the cascade (primary language + mux) when primary language is missing", async () => {
    const adminLookup = vi.fn(async () =>
      adminLookupOk([
        videoFixture({
          coreId: "c-cascade",
          primaryLanguageBcp47: null,
          muxAssetId: null,
          subtitleUrl: null,
        }),
      ]),
    )

    const res = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 11, coreId: "c-cascade" }] }),
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const body = (await res.json()) as {
      results: Array<{ status: string; message?: string }>
    }
    expect(body.results[0].status).toBe("validation_failed")
    expect(body.results[0].message).toContain("primary language")
    expect(body.results[0].message).toContain("mux variant")
    expect(body.results[0].message).not.toContain("subtitle")
  })

  it("falls back to videoLabel='unknown' when admin returns null label", async () => {
    const adminLookup = vi.fn(async () =>
      adminLookupOk([videoFixture({ coreId: "c-no-label", label: null })]),
    )
    const dispatched: Array<{ videoLabel: string }> = []

    await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 8, coreId: "c-no-label" }] }),
      kind: "scene-analysis",
      dispatch: async (input) => {
        dispatched.push({ videoLabel: input.videoLabel })
        return {}
      },
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    await new Promise((r) => setTimeout(r, 0))

    expect(dispatched[0]?.videoLabel).toBe("unknown")
  })
})

describe("processAdminTriggerRequest — admin lookup failures", () => {
  it("returns 503 with reason=config_missing when admin envelope is config_missing", async () => {
    const adminLookup = vi.fn(
      async (): Promise<AdminVideoLookupEnvelope> => ({
        ok: false,
        reason: "config_missing",
        messages: ["ADMIN_GRAPHQL_URL not set"],
        retryable: false,
      }),
    )

    const res = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 1, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
      adminLookup,
    })
    expect(res.status).toBe(503)
    const body = (await res.json()) as {
      reason: string
      upstreamReason: string
    }
    expect(body.reason).toBe("config_missing")
    expect(body.upstreamReason).toBe("config_missing")
    expect(DISPATCH_OK).not.toHaveBeenCalled()
  })

  it("returns 502 with reason=admin_unreachable on network_error envelope", async () => {
    const adminLookup = vi.fn(
      async (): Promise<AdminVideoLookupEnvelope> => ({
        ok: false,
        reason: "network_error",
        messages: ["admin GraphQL request timed out after 15000ms"],
        retryable: true,
      }),
    )

    const res = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 1, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
      adminLookup,
    })
    expect(res.status).toBe(502)
    const body = (await res.json()) as {
      reason: string
      upstreamReason: string
      retryable: boolean
    }
    expect(body.reason).toBe("admin_unreachable")
    expect(body.upstreamReason).toBe("network_error")
    expect(body.retryable).toBe(true)
    expect(DISPATCH_OK).not.toHaveBeenCalled()
  })

  it("returns 502 with reason=admin_unreachable on graphql_error envelope", async () => {
    const adminLookup = vi.fn(
      async (): Promise<AdminVideoLookupEnvelope> => ({
        ok: false,
        reason: "graphql_error",
        messages: ["Not authorized to resolve Query.videosByCoreIds"],
        retryable: false,
        httpStatus: 401,
      }),
    )

    const res = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 1, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
      adminLookup,
    })
    expect(res.status).toBe(502)
    const body = (await res.json()) as {
      reason: string
      upstreamReason: string
    }
    expect(body.reason).toBe("admin_unreachable")
    expect(body.upstreamReason).toBe("graphql_error")
    expect(DISPATCH_OK).not.toHaveBeenCalled()
  })

  it("returns 502 with reason=admin_unreachable on parse_error envelope", async () => {
    const adminLookup = vi.fn(
      async (): Promise<AdminVideoLookupEnvelope> => ({
        ok: false,
        reason: "parse_error",
        messages: ["admin GraphQL endpoint returned invalid JSON"],
        retryable: true,
        httpStatus: 502,
      }),
    )

    const res = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 1, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch: DISPATCH_OK,
      adminLookup,
    })
    expect(res.status).toBe(502)
    const body = (await res.json()) as {
      reason: string
      upstreamReason: string
    }
    expect(body.reason).toBe("admin_unreachable")
    expect(body.upstreamReason).toBe("parse_error")
    expect(DISPATCH_OK).not.toHaveBeenCalled()
  })
})

describe("processAdminTriggerRequest — idempotency", () => {
  function neverResolvesLookup() {
    return vi.fn(async () => adminLookupOk([videoFixture({ coreId: "c-1" })]))
  }

  it("second call with same kind+assetId returns already_in_flight with the same managerJobId", async () => {
    const adminLookup = neverResolvesLookup()

    // The dispatch fn here intentionally NEVER resolves — keeps the
    // first call's slot in the in-flight map across the second call.
    const neverDispatch = vi.fn(
      () => new Promise<unknown>(() => {}) as Promise<unknown>,
    )

    const first = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 7, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch: neverDispatch,
      adminLookup,
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
      adminLookup,
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
    const adminLookup = neverResolvesLookup()
    const neverDispatch = vi.fn(
      () => new Promise<unknown>(() => {}) as Promise<unknown>,
    )

    const sceneRes = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 7, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch: neverDispatch,
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const transcriptRes = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 7, coreId: "c-1" }] }),
      kind: "transcript",
      dispatch: neverDispatch,
      adminLookup,
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

  it("keeps queued items in-flight before their dispatch starts", async () => {
    __setDispatchConcurrencyForTests(1)
    const adminLookup = vi.fn(async () =>
      adminLookupOk([
        videoFixture({ coreId: "c-1" }),
        videoFixture({ coreId: "c-2" }),
      ]),
    )
    const resolvers: Array<() => void> = []
    const dispatch = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolvers.push(() => resolve({}))
        }),
    )

    const first = await processAdminTriggerRequest({
      request: makeRequest({
        items: [
          { assetId: 1, coreId: "c-1" },
          { assetId: 2, coreId: "c-2" },
        ],
      }),
      kind: "scene-analysis",
      dispatch,
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const firstBody = (await first.json()) as {
      results: Array<{ assetId: number; status: string; managerJobId: string }>
    }
    await new Promise((r) => setTimeout(r, 0))
    expect(dispatch).toHaveBeenCalledTimes(1)

    const queuedJobId = firstBody.results.find(
      (r) => r.assetId === 2,
    )?.managerJobId
    const duplicateQueued = await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 2, coreId: "c-2" }] }),
      kind: "scene-analysis",
      dispatch,
      adminLookup,
      scheduleAfter: (cb) => {
        void cb()
      },
    })
    const duplicateBody = (await duplicateQueued.json()) as {
      results: Array<{ status: string; managerJobId: string }>
    }

    expect(duplicateBody.results[0].status).toBe("already_in_flight")
    expect(duplicateBody.results[0].managerJobId).toBe(queuedJobId)
    expect(dispatch).toHaveBeenCalledTimes(1)

    resolvers[0]()
    await new Promise((r) => setTimeout(r, 0))
    expect(dispatch).toHaveBeenCalledTimes(2)
    resolvers[1]()
    await new Promise((r) => setTimeout(r, 0))
  })

  it("does not prune queued or running jobs by the old TTL while dispatch is unresolved", async () => {
    __setDispatchConcurrencyForTests(1)
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0)
    const adminLookup = neverResolvesLookup()
    const dispatch = vi.fn(
      () => new Promise<unknown>(() => {}) as Promise<unknown>,
    )

    try {
      const first = await processAdminTriggerRequest({
        request: makeRequest({ items: [{ assetId: 77, coreId: "c-1" }] }),
        kind: "transcript",
        dispatch,
        adminLookup,
        scheduleAfter: (cb) => {
          void cb()
        },
      })
      const firstBody = (await first.json()) as {
        results: Array<{ status: string; managerJobId: string }>
      }
      expect(firstBody.results[0].status).toBe("started")
      const managerJobId = firstBody.results[0].managerJobId
      await new Promise((r) => setTimeout(r, 0))
      expect(dispatch).toHaveBeenCalledTimes(1)

      nowSpy.mockReturnValue(10 * 60 * 1000)
      const duplicateAfterOldTtl = await processAdminTriggerRequest({
        request: makeRequest({ items: [{ assetId: 77, coreId: "c-1" }] }),
        kind: "transcript",
        dispatch,
        adminLookup,
        scheduleAfter: (cb) => {
          void cb()
        },
      })
      const duplicateBody = (await duplicateAfterOldTtl.json()) as {
        results: Array<{ status: string; managerJobId: string }>
      }

      expect(duplicateBody.results[0].status).toBe("already_in_flight")
      expect(duplicateBody.results[0].managerJobId).toBe(managerJobId)
      expect(dispatch).toHaveBeenCalledTimes(1)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it("releases the slot after the dispatch REJECTS (sad-path slot leak guard)", async () => {
    const adminLookup = neverResolvesLookup()

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
      adminLookup,
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
      adminLookup,
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
    const adminLookup = neverResolvesLookup()
    const throwingDispatch = vi.fn((): Promise<unknown> => {
      throw new Error("synchronous dispatch failure")
    })

    await processAdminTriggerRequest({
      request: makeRequest({ items: [{ assetId: 50, coreId: "c-1" }] }),
      kind: "scene-analysis",
      dispatch: throwingDispatch,
      adminLookup,
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
      adminLookup,
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
    const adminLookup = neverResolvesLookup()

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
      adminLookup,
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
      adminLookup,
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
