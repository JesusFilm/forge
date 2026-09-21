import { RecommendationClientError } from "../errors"
import {
  PENDING_CLAIM_TTL_MS,
  buildSelectionVariables,
  createPendingClaimStore,
  selectRecommendation,
  type SelectionDeps,
} from "../selection"

const IDENTITY = { viewerToken: "v".repeat(43), sessionToken: "s".repeat(43) }
const SLATE = { requestId: "req-1" }
const ITEM = {
  id: "item-1",
  capability: "cap-1",
  targetMediaId: "media-1",
  videoSlug: "jesus",
}
const NONCE = "n".repeat(32)

describe("createPendingClaimStore", () => {
  it("hands a fresh claim out once, for its own media only", () => {
    let now = 1_000
    const store = createPendingClaimStore(() => now)
    store.set({ mediaId: "media-1", claimNonce: NONCE, selectedAt: now })
    expect(store.take("media-2")).toBeNull()
    expect(store.peek()?.claimNonce).toBe(NONCE)
    expect(store.take("media-1")).toBe(NONCE)
    expect(store.take("media-1")).toBeNull()
    now += 1
    expect(store.peek()).toBeNull()
  })

  it("expires a stale claim", () => {
    let now = 1_000
    const store = createPendingClaimStore(() => now)
    store.set({ mediaId: "media-1", claimNonce: NONCE, selectedAt: now })
    now += PENDING_CLAIM_TTL_MS
    expect(store.take("media-1")).toBeNull()
  })

  it("keeps only the latest selection", () => {
    const store = createPendingClaimStore(() => 1_000)
    store.set({ mediaId: "media-1", claimNonce: NONCE, selectedAt: 1_000 })
    store.set({
      mediaId: "media-2",
      claimNonce: "m".repeat(32),
      selectedAt: 1_000,
    })
    expect(store.take("media-1")).toBeNull()
    expect(store.take("media-2")).toBe("m".repeat(32))
  })
})

describe("buildSelectionVariables", () => {
  it("binds the nonce under the evidence contract without a tab digest", () => {
    const variables = buildSelectionVariables(IDENTITY, SLATE, ITEM, {
      eventId: "selection:1",
      occurredAt: "2026-09-16T00:00:00.000Z",
      claimNonce: NONCE,
    })
    expect(variables).toEqual({
      contractVersion: "recommendation-evidence-v1",
      capability: "cap-1",
      requestId: "req-1",
      itemId: "item-1",
      viewerToken: IDENTITY.viewerToken,
      sessionToken: IDENTITY.sessionToken,
      eventId: "selection:1",
      occurredAt: "2026-09-16T00:00:00.000Z",
      claimNonce: NONCE,
    })
    expect(variables).not.toHaveProperty("tabDigest")
    expect(variables).not.toHaveProperty("sessionDigest")
  })
})

describe("selectRecommendation", () => {
  function deps(overrides: Partial<SelectionDeps> = {}) {
    const base: SelectionDeps = {
      getIdentity: jest.fn(async () => ({
        kind: "ready" as const,
        identity: IDENTITY,
        personalization: true,
      })),
      send: jest.fn(async (variables) => ({
        status: "accepted",
        claimNonce: variables.claimNonce,
        canonicalHref:
          "https://www.jesusfilm.org/watch/jesus.html/english.html",
        targetMediaId: "media-1",
      })),
      invalidateIdentity: jest.fn(async () => undefined),
      touch: jest.fn(),
      pendingClaims: createPendingClaimStore(() => 1_000),
      now: () => 1_000,
      claimNonce: () => NONCE,
      eventId: (kind, itemId) => `${kind}:fixed:${itemId}`,
      report: jest.fn(),
    }
    return { ...base, ...overrides }
  }

  it("stores the pending claim, sends, and returns the slug to open", async () => {
    const d = deps()
    const result = await selectRecommendation(SLATE, ITEM, d)
    expect(result).toEqual({
      videoSlug: "jesus",
      targetMediaId: "media-1",
      claimNonce: NONCE,
      acknowledged: true,
    })
    expect(d.pendingClaims.take("media-1")).toBe(NONCE)
    expect(d.send).toHaveBeenCalledWith(
      expect.objectContaining({
        claimNonce: NONCE,
        eventId: "selection:fixed:item-1",
      }),
    )
    expect(d.touch).toHaveBeenCalledTimes(1)
  })

  it("still opens the video when the selection fails, keeping the local claim", async () => {
    const d = deps({
      send: jest.fn(async () => {
        throw new RecommendationClientError("TIMEOUT")
      }),
    })
    const result = await selectRecommendation(SLATE, ITEM, d)
    expect(result.acknowledged).toBe(false)
    expect(result.videoSlug).toBe("jesus")
    expect(d.pendingClaims.take("media-1")).toBe(NONCE)
    expect(d.report).toHaveBeenCalledWith("selection", "timeout")
  })

  it("opens the video without an identity and sends nothing", async () => {
    const d = deps({
      getIdentity: jest.fn(async () => ({ kind: "unprovisioned" as const })),
    })
    const result = await selectRecommendation(SLATE, ITEM, d)
    expect(result.acknowledged).toBe(false)
    expect(d.send).not.toHaveBeenCalled()
  })

  it("prefers the nonce Admin answers with when it differs", async () => {
    const served = "z".repeat(32)
    const d = deps({
      send: jest.fn(async () => ({
        status: "replay",
        claimNonce: served,
        canonicalHref:
          "https://www.jesusfilm.org/watch/jesus.html/english.html",
        targetMediaId: "media-1",
      })),
    })
    const result = await selectRecommendation(SLATE, ITEM, d)
    expect(result.claimNonce).toBe(served)
    expect(d.pendingClaims.take("media-1")).toBe(served)
  })

  it("does not treat a conflict receipt as acknowledged", async () => {
    const d = deps({
      send: jest.fn(async () => ({
        status: "conflict",
        claimNonce: "z".repeat(32),
        canonicalHref:
          "https://www.jesusfilm.org/watch/jesus.html/english.html",
        targetMediaId: "media-1",
      })),
    })
    const result = await selectRecommendation(SLATE, ITEM, d)
    expect(result.acknowledged).toBe(false)
    expect(result.videoSlug).toBe("jesus")
    // The local claim stays; the recorder's claim attempt decides.
    expect(d.pendingClaims.take("media-1")).toBe(NONCE)
    expect(d.report).toHaveBeenCalledWith("selection", "conflict")
  })

  // Admin's receipt status is a plain string: a value this client does not
  // know must not read as a binding.
  it("does not treat an unknown receipt status as acknowledged", async () => {
    const d = deps({
      send: jest.fn(async () => ({
        status: "queued",
        claimNonce: "z".repeat(32),
        canonicalHref:
          "https://www.jesusfilm.org/watch/jesus.html/english.html",
        targetMediaId: "media-1",
      })),
    })
    const result = await selectRecommendation(SLATE, ITEM, d)
    expect(result.acknowledged).toBe(false)
    expect(result.claimNonce).toBe(NONCE)
    expect(d.pendingClaims.take("media-1")).toBe(NONCE)
    expect(d.report).toHaveBeenCalledWith("selection", "unacknowledged")
  })

  it("invalidates the handle on UNAUTHENTICATED", async () => {
    const d = deps({
      send: jest.fn(async () => {
        throw new RecommendationClientError("UNAUTHENTICATED")
      }),
    })
    await selectRecommendation(SLATE, ITEM, d)
    expect(d.invalidateIdentity).toHaveBeenCalledTimes(1)
  })
})
