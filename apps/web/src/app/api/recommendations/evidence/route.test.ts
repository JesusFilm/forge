import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { adminRecordSemanticRecommendationEvidenceOperation } from "@forge/admin-graphql/operations"

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_CANONICAL_ORIGIN: "https://watch.example" },
}))
vi.mock("@/lib/admin-client", () => ({ default: { mutate } }))

const { POST, dynamic, revalidate } = await import("./route")

const session = "a".repeat(43)

function request(body: string, headers: HeadersInit = {}) {
  return new Request(
    "https://watch.example/watch/api/recommendations/evidence",
    {
      method: "POST",
      headers: {
        origin: "https://watch.example",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        cookie: `forge_recommendation_session=${session}`,
        ...headers,
      },
      body,
    },
  )
}

const body = {
  contractVersion: "recommendation-evidence-v1",
  capability: "capability-secret",
  requestId: "request-1",
  itemId: "item-1",
  events: [
    {
      eventId: "event-1",
      kind: "impression",
      occurredAt: "2026-08-19T03:00:00.000Z",
      payload: { visibilityPolicy: "watch-below-player-v1" },
    },
  ],
}

describe("POST /watch/api/recommendations/evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutate.mockResolvedValue({
      data: {
        recordSemanticRecommendationEvidence: [
          { eventId: "event-1", status: "accepted" },
        ],
      },
    })
  })

  it("is dynamic/private and forwards the typed U2 mutation with digest-only session identity", async () => {
    expect(dynamic).toBe("force-dynamic")
    expect(revalidate).toBe(0)

    const response = await POST(request(JSON.stringify(body)))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    const responseBody = await response.json()
    expect(responseBody).toEqual({
      receipts: [{ eventId: "event-1", status: "accepted" }],
    })
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: adminRecordSemanticRecommendationEvidenceOperation,
        fetchPolicy: "no-cache",
      }),
    )
    const variables = mutate.mock.calls[0]?.[0]?.variables
    expect(variables.sessionDigest).toBe(
      createHash("sha256").update(session).digest("hex"),
    )
    expect(variables.capability).toBe("capability-secret")
    expect(JSON.stringify(variables)).not.toContain(session)
    expect(JSON.stringify(responseBody)).not.toContain("capability-secret")
  })

  it("rejects missing session, excessive events, malformed timestamps, and nested duplicate keys", async () => {
    const noSession = await POST(
      request(JSON.stringify(body), { cookie: "unrelated=value" }),
    )
    expect(noSession.status).toBe(401)

    const excessive = await POST(
      request(
        JSON.stringify({
          ...body,
          events: Array.from({ length: 17 }, (_, index) => ({
            ...body.events[0],
            eventId: `event-${index}`,
          })),
        }),
      ),
    )
    expect(excessive.status).toBe(400)

    const malformedTime = await POST(
      request(
        JSON.stringify({
          ...body,
          events: [{ ...body.events[0], occurredAt: "yesterday" }],
        }),
      ),
    )
    expect(malformedTime.status).toBe(400)

    const duplicate = await POST(
      request(
        '{"contractVersion":"recommendation-evidence-v1","capability":"one","requestId":"request-1","itemId":"item-1","events":[{"eventId":"event-1","kind":"render","occurredAt":"2026-08-19T03:00:00.000Z","payload":{"state":"one","state":"two"}}]}',
      ),
    )
    expect(duplicate.status).toBe(400)
    expect(mutate).not.toHaveBeenCalled()
  })

  it("keeps capability and upstream error details out of failures", async () => {
    mutate.mockRejectedValueOnce(
      new Error("Bearer admin-secret capability-secret"),
    )
    const response = await POST(request(JSON.stringify(body)))

    expect(response.status).toBe(503)
    expect(await response.text()).not.toMatch(
      /Bearer|admin-secret|capability-secret/,
    )
  })
})
