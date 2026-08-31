import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { adminSelectSemanticRecommendationOperation } from "@forge/admin-graphql/operations"

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_CANONICAL_ORIGIN: "https://watch.example" },
}))
vi.mock("@/lib/admin-client", () => ({ default: { mutate } }))

const { POST, dynamic, revalidate } = await import("./route")

const session = "b".repeat(43)
const tabNonce = "tab_correlation_nonce_123"

function request(body: string) {
  return new Request("https://watch.example/watch/api/recommendations/select", {
    method: "POST",
    headers: {
      origin: "https://watch.example",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      cookie: `forge_recommendation_session=${session}`,
    },
    body,
  })
}

const body = {
  contractVersion: "recommendation-evidence-v1",
  capability: "capability-secret",
  requestId: "request-1",
  itemId: "item-1",
  eventId: "selection-1",
  occurredAt: "2026-08-19T03:00:00.000Z",
  tabNonce,
}

describe("POST /watch/api/recommendations/select", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutate.mockResolvedValue({
      data: {
        selectSemanticRecommendation: {
          status: "accepted",
          claimNonce: "fresh_claim_nonce_1234567890",
          canonicalHref: "/watch/target.html",
          targetMediaId: "target-1",
        },
      },
    })
  })

  it("is dynamic/private, hashes session and tab correlation, and returns only a fresh handoff", async () => {
    expect(dynamic).toBe("force-dynamic")
    expect(revalidate).toBe(0)

    const response = await POST(request(JSON.stringify(body)))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    const responseBody = await response.json()
    expect(responseBody).toEqual({
      claimNonce: "fresh_claim_nonce_1234567890",
      canonicalHref: "/watch/target.html",
      targetMediaId: "target-1",
    })
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: adminSelectSemanticRecommendationOperation,
        fetchPolicy: "no-cache",
      }),
    )
    const variables = mutate.mock.calls[0]?.[0]?.variables
    expect(variables.sessionDigest).toBe(
      createHash("sha256").update(session).digest("hex"),
    )
    expect(variables.tabDigest).toBe(
      createHash("sha256").update(tabNonce).digest("hex"),
    )
    expect(JSON.stringify(variables)).not.toContain(session)
    expect(JSON.stringify(variables)).not.toContain(tabNonce)
    expect(JSON.stringify(responseBody)).not.toContain("capability-secret")
  })

  it("refuses replay/null handoffs and non-canonical Admin targets", async () => {
    mutate.mockResolvedValueOnce({
      data: {
        selectSemanticRecommendation: {
          status: "replay",
          claimNonce: null,
          canonicalHref: "/watch/target.html",
          targetMediaId: "target-1",
        },
      },
    })
    const replay = await POST(request(JSON.stringify(body)))
    expect(replay.status).toBe(409)

    mutate.mockResolvedValueOnce({
      data: {
        selectSemanticRecommendation: {
          status: "accepted",
          claimNonce: "fresh_claim_nonce_1234567890",
          canonicalHref: "https://attacker.example/steal",
          targetMediaId: "target-1",
        },
      },
    })
    const external = await POST(request(JSON.stringify(body)))
    expect(external.status).toBe(502)
    expect(await external.text()).not.toContain("attacker.example")
  })

  it("rejects malformed input before creating a handoff", async () => {
    const duplicate = await POST(
      request(
        '{"contractVersion":"recommendation-evidence-v1","capability":"one","requestId":"request-1","itemId":"item-1","eventId":"selection-1","occurredAt":"2026-08-19T03:00:00.000Z","tabNonce":"one","tabNonce":"two"}',
      ),
    )
    expect(duplicate.status).toBe(400)
    expect(mutate).not.toHaveBeenCalled()
  })
})
