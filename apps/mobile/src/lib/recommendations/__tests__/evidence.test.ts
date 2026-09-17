import { RATE_LIMIT_WINDOW_MS, RecommendationClientError } from "../errors"
import {
  buildEvidenceVariables,
  createEvidenceLedger,
  evidencePayload,
  recordEvidence,
  type EvidenceDeps,
} from "../evidence"

const IDENTITY = { viewerToken: "v".repeat(43), sessionToken: "s".repeat(43) }
const SLATE = { requestId: "req-1" }
const ITEM = { id: "item-1", capability: "cap-1" }

function deps(overrides: Partial<EvidenceDeps> = {}) {
  const base: EvidenceDeps = {
    getIdentity: jest.fn(async () => ({
      kind: "ready" as const,
      identity: IDENTITY,
      personalization: true,
    })),
    send: jest.fn(async (variables) => [
      { eventId: variables.events[0].eventId, status: "accepted" },
    ]),
    invalidateIdentity: jest.fn(async () => undefined),
    touch: jest.fn(),
    now: () => Date.parse("2026-09-16T00:00:00.000Z"),
    eventId: (kind, itemId) => `${kind}:fixed:${itemId}`,
    report: jest.fn(),
    wait: jest.fn(async () => undefined),
  }
  return { ...base, ...overrides }
}

describe("evidence payload literals", () => {
  it("pins the surface as both policies, the values Admin checks", () => {
    expect(evidencePayload("render")).toEqual({
      surfacePolicy: "watch-for-you-v1",
    })
    expect(evidencePayload("impression")).toEqual({
      visibilityPolicy: "watch-for-you-v1",
    })
  })

  it("builds one event under the evidence contract with viewer tokens only", () => {
    const variables = buildEvidenceVariables(IDENTITY, SLATE, ITEM, "render", {
      eventId: "render:1",
      occurredAt: "2026-09-16T00:00:00.000Z",
    })
    expect(variables).toEqual({
      contractVersion: "recommendation-evidence-v1",
      capability: "cap-1",
      requestId: "req-1",
      itemId: "item-1",
      viewerToken: IDENTITY.viewerToken,
      sessionToken: IDENTITY.sessionToken,
      events: [
        {
          eventId: "render:1",
          kind: "render",
          occurredAt: "2026-09-16T00:00:00.000Z",
          payload: { surfacePolicy: "watch-for-you-v1" },
        },
      ],
    })
    expect(variables).not.toHaveProperty("sessionDigest")
  })
})

describe("createEvidenceLedger", () => {
  it("admits each request/item/kind once", () => {
    const ledger = createEvidenceLedger()
    expect(ledger.claim("req-1", "item-1", "render")).toBe(true)
    expect(ledger.claim("req-1", "item-1", "render")).toBe(false)
    expect(ledger.claim("req-1", "item-1", "impression")).toBe(true)
    expect(ledger.claim("req-2", "item-1", "render")).toBe(true)
    expect(ledger.size()).toBe(3)
  })
})

describe("recordEvidence", () => {
  it("sends once and reports sent on an accepted receipt", async () => {
    const d = deps()
    const ledger = createEvidenceLedger()
    expect(await recordEvidence("render", SLATE, ITEM, ledger, d)).toBe("sent")
    expect(d.send).toHaveBeenCalledTimes(1)
    expect(d.touch).toHaveBeenCalledTimes(1)
    expect(d.report).toHaveBeenCalledWith("render", "sent")
    expect(await recordEvidence("render", SLATE, ITEM, ledger, d)).toBe(
      "duplicate",
    )
    expect(d.send).toHaveBeenCalledTimes(1)
  })

  it("skips without an identity and leaves the ledger claimed", async () => {
    const d = deps({
      getIdentity: jest.fn(async () => ({ kind: "unprovisioned" as const })),
    })
    const ledger = createEvidenceLedger()
    expect(await recordEvidence("impression", SLATE, ITEM, ledger, d)).toBe(
      "skipped",
    )
    expect(d.send).not.toHaveBeenCalled()
  })

  it("treats a receipt that does not name the event as invalid, without retry", async () => {
    const d = deps({
      send: jest.fn(async () => [{ eventId: "other", status: "accepted" }]),
    })
    expect(
      await recordEvidence("render", SLATE, ITEM, createEvidenceLedger(), d),
    ).toBe("receipt_invalid")
    expect(d.send).toHaveBeenCalledTimes(1)
    expect(d.report).toHaveBeenCalledWith("render", "receipt_invalid")
  })

  it("retries a transient failure once, then gives up", async () => {
    const d = deps({
      send: jest.fn(async () => {
        throw new RecommendationClientError("NETWORK_ERROR")
      }),
    })
    expect(
      await recordEvidence("render", SLATE, ITEM, createEvidenceLedger(), d),
    ).toBe("failed")
    expect(d.send).toHaveBeenCalledTimes(2)
    expect(d.wait).toHaveBeenCalledTimes(1)
    expect(d.report).toHaveBeenCalledWith("render", "network_error")
  })

  it.each([
    ["the Retry-After window", 30_000, 30_000],
    [
      "the limiter's window when Retry-After is absent",
      null,
      RATE_LIMIT_WINDOW_MS,
    ],
  ])(
    "waits %s before the one retry of a rate-limited send",
    async (_label, retryAfterMs, expectedWait) => {
      let calls = 0
      const d = deps({
        send: jest.fn(async (variables) => {
          calls += 1
          if (calls === 1) {
            throw new RecommendationClientError("RATE_LIMITED", {
              retryAfterMs,
            })
          }
          return [{ eventId: variables.events[0].eventId, status: "accepted" }]
        }),
      })
      expect(
        await recordEvidence(
          "impression",
          SLATE,
          ITEM,
          createEvidenceLedger(),
          d,
        ),
      ).toBe("sent")
      expect(d.send).toHaveBeenCalledTimes(2)
      expect(d.wait).toHaveBeenCalledTimes(1)
      expect(d.wait).toHaveBeenCalledWith(expectedWait)
    },
  )

  it("does not retry a definitive failure and invalidates on UNAUTHENTICATED", async () => {
    const d = deps({
      send: jest.fn(async () => {
        throw new RecommendationClientError("UNAUTHENTICATED")
      }),
    })
    expect(
      await recordEvidence("render", SLATE, ITEM, createEvidenceLedger(), d),
    ).toBe("failed")
    expect(d.send).toHaveBeenCalledTimes(1)
    expect(d.invalidateIdentity).toHaveBeenCalledTimes(1)
  })
})
