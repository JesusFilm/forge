import { afterEach, describe, expect, it, vi } from "vitest"

import {
  refuseUnlessLaneAdmitted,
  type AiChatLaneRefusal,
} from "./ai-chat-lane-admission"

const LANE_KEYS = ["test-lane-key"] as const
const AUTH = "Bearer test-lane-key"

const NOT_FOUND: AiChatLaneRefusal = {
  status: 404,
  body: { error: "Not found" },
}
const BEARER_REQUIRED: AiChatLaneRefusal = {
  status: 401,
  body: { error: "Service bearer required" },
}

// ===========================================================================
// Refusal ladder (injected seams — pure behavior)
// ===========================================================================

describe("refuseUnlessLaneAdmitted — ladder", () => {
  it("returns the 404 refusal when the flag is off, before the bearer is consulted", async () => {
    const keysProbe = vi.fn(() => LANE_KEYS)
    const refusal = refuseUnlessLaneAdmitted({
      authHeader: AUTH,
      getEnabled: () => false,
      getServiceKeys: keysProbe,
    })
    // The exact wire body is a frozen contract with apps/chat — byte-identical
    // to the pre-feat-283 per-route literals.
    expect(refusal).toEqual(NOT_FOUND)
    expect(keysProbe).not.toHaveBeenCalled()
  })

  it("returns the 401 refusal for a missing, malformed, or wrong bearer", () => {
    for (const authHeader of [undefined, null, "", "nope", "Bearer wrong"]) {
      const refusal = refuseUnlessLaneAdmitted({
        authHeader,
        getEnabled: () => true,
        getServiceKeys: () => LANE_KEYS,
      })
      expect(refusal).toEqual(BEARER_REQUIRED)
    }
  })

  it("fails closed on an empty allowlist (unprovisioned lane CSV shape)", () => {
    const refusal = refuseUnlessLaneAdmitted({
      authHeader: AUTH,
      getEnabled: () => true,
      getServiceKeys: () => [],
    })
    expect(refusal).toEqual(BEARER_REQUIRED)
  })

  it("returns null (admitted) for a lane key when the flag is on", () => {
    const refusal = refuseUnlessLaneAdmitted({
      authHeader: AUTH,
      getEnabled: () => true,
      getServiceKeys: () => LANE_KEYS,
    })
    expect(refusal).toBeNull()
  })
})

// ===========================================================================
// Default sourcing (the feat-283 gate — Ruling 1, requirement 1)
// ===========================================================================

// config/env.ts snapshots process.env at module load, so every test below
// stubs the env FIRST, resets the module registry, and dynamically imports the
// module under test — the config/env.test.ts pattern. Injecting a
// getServiceKeys seam would bypass the very default these tests exist to pin.

describe("default key sourcing (discriminating key-source test)", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function importWithStubbedCsvs() {
    // BOTH CSVs set to DISTINCT values: only a test shaped like this can tell
    // WHICH CSV the module's default reads (Correction 4 — with the lane CSV
    // merely unset, fail-closed-when-unset passes even if the default read the
    // pool). Editing readLaneServiceKeys to the pool CSV flips both
    // assertions: the pool key would be admitted and the lane key refused.
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "pool-only-key")
    vi.stubEnv("AI_CHAT_SERVICE_API_KEYS", "lane-only-key")
    vi.stubEnv("SEEKER_ROUTE_ENABLED", "true")
    vi.resetModules()
    return await import("./ai-chat-lane-admission")
  }

  it("refuses a POOL key and admits the LANE key through the DEFAULT source", async () => {
    const { refuseUnlessLaneAdmitted: refuse } = await importWithStubbedCsvs()

    // No seams injected — flag and keys both resolve through the defaults.
    expect(refuse({ authHeader: "Bearer pool-only-key" })).toEqual(
      BEARER_REQUIRED,
    )
    expect(refuse({ authHeader: "Bearer lane-only-key" })).toBeNull()
  })

  it("refuses every bearer through the DEFAULT flag when the enable flag is unset", async () => {
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "pool-only-key")
    vi.stubEnv("AI_CHAT_SERVICE_API_KEYS", "lane-only-key")
    vi.stubEnv("SEEKER_ROUTE_ENABLED", "")
    vi.resetModules()
    const { refuseUnlessLaneAdmitted: refuse } =
      await import("./ai-chat-lane-admission")

    expect(refuse({ authHeader: "Bearer lane-only-key" })).toEqual(NOT_FOUND)
  })

  // Handler-level companions: each production handler must reach the module's
  // default source when its registration passes no seams (the index.ts shape).
  // A handler that re-grew its own key default would pass the module-level
  // test above while silently diverging — these catch that.

  it("the seeker send handler discriminates pool vs lane through its default seam", async () => {
    await importWithStubbedCsvs()
    const { handleSeekerRouteRequest } = await import("./agents/seeker-route")

    const input = (authHeader: string) => ({
      authHeader,
      readJson: async () => ({}),
      getMastra: () => {
        throw new Error("admission must settle before any agent lookup")
      },
    })

    const pool = await handleSeekerRouteRequest(input("Bearer pool-only-key"))
    expect(pool.status).toBe(401)
    // Asserted through the actual Response so the handler's refusal
    // pass-through (jsonResponse(refusal.status, refusal.body)) stays pinned.
    expect(await pool.json()).toEqual({ error: "Service bearer required" })

    // Past admission: the empty body 400s at gate 3 — proof the lane key was
    // admitted through the default source without touching the agent.
    const lane = await handleSeekerRouteRequest(input("Bearer lane-only-key"))
    expect(lane.status).toBe(400)
    // 15s: the cold seeker-agent-graph import inside vi.resetModules exceeds
    // vitest's 5s default under full-suite parallelism (timing, not logic).
  }, 15_000)

  it("all four handlers refuse 404 through the DEFAULT flag when it is unset", async () => {
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "pool-only-key")
    vi.stubEnv("AI_CHAT_SERVICE_API_KEYS", "lane-only-key")
    vi.stubEnv("SEEKER_ROUTE_ENABLED", "")
    vi.resetModules()
    const { handleSeekerRouteRequest } = await import("./agents/seeker-route")
    const { handleAiChatHistoryListRequest, handleAiChatHistoryReplayRequest } =
      await import("./ai-chat-history-route")
    const { handleAiChatHistoryRenameRequest } =
      await import("./ai-chat-history-write-route")

    // No seams injected — a handler that re-grew a local `getEnabled` default
    // (bypassing the kill switch) would answer 400/401 here instead of 404.
    const seeker = await handleSeekerRouteRequest({
      authHeader: "Bearer lane-only-key",
      readJson: async () => ({}),
      getMastra: () => {
        throw new Error("admission must settle before any agent lookup")
      },
    })
    expect(seeker.status).toBe(404)
    expect(await seeker.json()).toEqual({ error: "Not found" })

    for (const handler of [
      handleAiChatHistoryListRequest,
      handleAiChatHistoryReplayRequest,
      handleAiChatHistoryRenameRequest,
    ]) {
      const outcome = await handler({
        authHeader: "Bearer lane-only-key",
        readJson: async () => ({}),
      })
      expect(outcome.status).toBe(404)
      expect(outcome.body).toEqual({ error: "Not found" })
    }
  })

  it("all three history handlers discriminate pool vs lane through their default seams", async () => {
    await importWithStubbedCsvs()
    const { handleAiChatHistoryListRequest, handleAiChatHistoryReplayRequest } =
      await import("./ai-chat-history-route")
    const { handleAiChatHistoryRenameRequest } =
      await import("./ai-chat-history-write-route")

    for (const handler of [
      handleAiChatHistoryListRequest,
      handleAiChatHistoryReplayRequest,
      handleAiChatHistoryRenameRequest,
    ]) {
      const pool = await handler({
        authHeader: "Bearer pool-only-key",
        readJson: async () => ({}),
      })
      expect(pool.status).toBe(401)

      // Past admission: the empty body 400s as invalid_body — proof the lane
      // key was admitted through the default source without any store I/O.
      const lane = await handler({
        authHeader: "Bearer lane-only-key",
        readJson: async () => ({}),
      })
      expect(lane.status).toBe(400)
      expect(lane.body).toEqual({ reason: "invalid_body" })
    }
  })
})
