import { beforeEach, describe, expect, it, vi } from "vitest"
import { adminIssueWatchSurfaceDeliveryOperation } from "@forge/admin-graphql/operations"
import { resetRecommendationMutationAdmissionForTests } from "@/lib/recommendation-mutation-admission"
import { signWatchSurfaceManifest } from "@/lib/watch-surface-manifest.server"

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }))
vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_CANONICAL_ORIGIN: "https://watch.example",
    REVALIDATION_SECRET: "test-exposure-descriptor-secret",
  },
}))
vi.mock("@/lib/admin-client", () => ({ default: { mutate } }))
const { POST } = await import("./route")
const attemptId = "00000000-0000-4000-8000-000000000001"

function descriptor() {
  return signWatchSurfaceManifest({
    surface: "watch-home",
    block: "collections",
    presentation: "carousel",
    placement: "home-films",
    items: [{ position: 0, itemPath: "/watch/jesus.html" }],
  })!
}
function request(body: unknown, extraHeaders?: Record<string, string>) {
  return new Request(
    "https://watch.example/watch/api/recommendations/surface-delivery",
    {
      method: "POST",
      headers: {
        origin: "https://watch.example",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "user-agent": "Test browser",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    },
  )
}

describe("anonymous surface issuance proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRecommendationMutationAdmissionForTests()
    mutate.mockResolvedValue({
      data: {
        issueWatchSurfaceDelivery: {
          windowId: attemptId,
          disposition: "measured",
          status: "accepted",
          items: descriptor().manifest.items,
        },
      },
    })
  })
  it("forwards only verified origin content and authenticated traffic classification", async () => {
    const source = descriptor()
    const response = await POST(request({ descriptor: source, attemptId }))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: adminIssueWatchSurfaceDeliveryOperation,
        variables: {
          manifest: source.manifest,
          attemptId,
          trafficCategory: "ordinary_browser",
        },
      }),
    )
  })
  it("rejects a browser self-certified card list or changed placement", async () => {
    const source = descriptor()
    source.manifest.placement = "other-block"
    expect(
      (await POST(request({ descriptor: source, attemptId }))).status,
    ).toBe(400)
    expect(
      (
        await POST(
          request({
            descriptor: { manifest: descriptor().manifest },
            attemptId,
          }),
        )
      ).status,
    ).toBe(400)
    expect(mutate).not.toHaveBeenCalled()
  })
  const excludedTraffic: Record<string, string>[] = [
    { "user-agent": "Googlebot" },
    { "sec-purpose": "prefetch" },
    { "sec-purpose": "prefetch;prerender" },
  ]
  it.each(excludedTraffic)(
    "rejects excluded traffic before origin writes: %j",
    async (headers) => {
      expect(
        (await POST(request({ descriptor: descriptor(), attemptId }, headers)))
          .status,
      ).toBe(403)
      expect(mutate).not.toHaveBeenCalled()
    },
  )
  it("fails softly against an old Admin receiver without changing content delivery", async () => {
    mutate.mockRejectedValue(
      new Error("Unknown field issueWatchSurfaceDelivery"),
    )
    const response = await POST(
      request({ descriptor: descriptor(), attemptId }),
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: "recommendations_unavailable",
    })
  })
  it("rejects identity and client fact fields in the issuance envelope", async () => {
    expect(
      (
        await POST(
          request({ descriptor: descriptor(), attemptId, viewerId: "private" }),
        )
      ).status,
    ).toBe(400)
    expect(mutate).not.toHaveBeenCalled()
  })
})
