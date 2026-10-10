import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { adminRecordRecommendationContentActionOperation } from "@forge/admin-graphql/operations"
import {
  RECOMMENDATION_MUTATION_CLIENT_LIMIT,
  resetRecommendationMutationAdmissionForTests,
} from "@/lib/recommendation-mutation-admission"

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_CANONICAL_ORIGIN: "https://watch.example" },
}))
vi.mock("@/lib/admin-client", () => ({ default: { mutate } }))

const { POST, dynamic, revalidate } = await import("./route")

const session = "a".repeat(43)
const body = {
  contractVersion: "recommendation-content-action-v1",
  eventId: "share-1",
  occurredAt: "2026-08-25T12:00:00.000Z",
  mediaId: "media-1",
  actionKind: "share",
  actionDetail: "link_copy",
}

function request(value: unknown, headers: HeadersInit = {}) {
  return new Request(
    "https://watch.example/watch/api/recommendations/content-actions",
    {
      method: "POST",
      headers: {
        origin: "https://watch.example",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        cookie: `forge_recommendation_session=${session}`,
        ...headers,
      },
      body: JSON.stringify(value),
    },
  )
}

describe("POST /watch/api/recommendations/content-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRecommendationMutationAdmissionForTests()
    mutate.mockResolvedValue({
      data: {
        recordRecommendationContentAction: {
          actionId: "action-1",
          eventId: "share-1",
          status: "accepted",
          matched: false,
          late: false,
        },
      },
    })
  })

  it("forwards only bounded action facts and digest-only session identity", async () => {
    expect(dynamic).toBe("force-dynamic")
    expect(revalidate).toBe(0)

    const response = await POST(request(body))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      receipt: {
        actionId: "action-1",
        eventId: "share-1",
        status: "accepted",
        matched: false,
        late: false,
      },
    })
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: adminRecordRecommendationContentActionOperation,
        variables: {
          ...body,
          sessionDigest: createHash("sha256").update(session).digest("hex"),
        },
        fetchPolicy: "no-cache",
      }),
    )
  })

  it("creates a session for a direct-arrival action so it remains unmatched", async () => {
    const response = await POST(request(body, { cookie: "unrelated=value" }))

    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toMatch(
      /forge_recommendation_session=/,
    )
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          sessionDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    )
  })

  it("rejects foreign origin, unknown kinds, and extra lineage", async () => {
    expect(
      (await POST(request(body, { origin: "https://evil.example" }))).status,
    ).toBe(403)
    expect(
      (await POST(request({ ...body, actionKind: "watch_duration" }))).status,
    ).toBe(400)
    expect(
      (await POST(request({ ...body, requestId: "fabricated" }))).status,
    ).toBe(400)
    expect(mutate).not.toHaveBeenCalled()
  })

  it("keeps the Watch action available when Admin telemetry fails", async () => {
    mutate.mockRejectedValueOnce(new Error("Bearer secret action payload"))
    const response = await POST(request(body))

    expect(response.status).toBe(503)
    expect(await response.text()).not.toMatch(/Bearer|secret|payload/)
  })

  it("does not let fresh cookies and event ids bypass shared anonymous admission", async () => {
    for (
      let attempt = 0;
      attempt < RECOMMENDATION_MUTATION_CLIENT_LIMIT;
      attempt += 1
    ) {
      const response = await POST(
        request(
          { ...body, eventId: `fresh-event-${attempt}` },
          {
            "cf-connecting-ip": "203.0.113.19",
            cookie: `forge_recommendation_session=${String(attempt).padStart(43, "a")}`,
          },
        ),
      )
      expect(response.status).toBe(200)
    }

    const blocked = await POST(
      request(
        { ...body, eventId: "fresh-event-over-limit" },
        {
          "cf-connecting-ip": "203.0.113.19",
          cookie: `forge_recommendation_session=${"z".repeat(43)}`,
        },
      ),
    )
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: "rate_limited" })
    expect(mutate).toHaveBeenCalledTimes(RECOMMENDATION_MUTATION_CLIENT_LIMIT)
  })
})
