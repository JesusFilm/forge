import { beforeEach, describe, expect, it, vi } from "vitest"
import { adminRecordWatchSurfaceExposureOperation } from "@forge/admin-graphql/operations"
import { resetRecommendationMutationAdmissionForTests } from "@/lib/recommendation-mutation-admission"

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }))
vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_CANONICAL_ORIGIN: "https://watch.example" },
}))
vi.mock("@/lib/admin-client", () => ({ default: { mutate } }))

const { POST } = await import("./route")
const event = {
  eventId: "00000000-0000-4000-8000-000000000001",
  windowId: "00000000-0000-4000-8000-000000000002",
  surface: "watch-search",
  block: "results",
  presentation: "result-list",
  placement: "search-results",
  policyVersion: "watch-exposure-v1",
  position: 0,
  itemPath: "/watch/example.html",
  kind: "rendered",
  visibilityCapability: null,
  occurredAt: "2026-09-28T00:00:00.000Z",
}
function request(events: unknown, origin = "https://watch.example") {
  return new Request(
    "https://watch.example/watch/api/recommendations/surface-exposure",
    {
      method: "POST",
      headers: {
        origin,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      body: JSON.stringify(events),
    },
  )
}

describe("POST /watch/api/recommendations/surface-exposure", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRecommendationMutationAdmissionForTests()
    mutate.mockImplementation(async ({ variables }) => ({
      data: {
        recordWatchSurfaceExposure: variables.events.map(
          (item: { eventId: string }) => ({
            eventId: item.eventId,
            status: "accepted",
          }),
        ),
      },
    }))
  })

  it("admits a normal 70-card page in two bounded requests", async () => {
    const events = Array.from({ length: 70 }, (_, index) => ({
      ...event,
      eventId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      itemPath: `/watch/video-${index}.html`,
      position: index % 64,
    }))
    for (const batch of [events.slice(0, 64), events.slice(64)]) {
      const response = await POST(request(batch))
      expect(response.status).toBe(200)
      expect((await response.json()).receipts).toHaveLength(batch.length)
    }
    expect(mutate).toHaveBeenCalledTimes(2)
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: adminRecordWatchSurfaceExposureOperation,
        variables: { events: events.slice(0, 64) },
      }),
    )
  })

  it("admits a normal multi-block page without exhausting its mutation bucket", async () => {
    for (let block = 0; block < 8; block += 1) {
      const batch = Array.from({ length: 40 }, (_, position) => ({
        ...event,
        eventId: `00000000-0000-4000-8000-${String(block * 40 + position + 1).padStart(12, "0")}`,
        windowId: `00000000-0000-4000-8000-${String(block + 1).padStart(12, "0")}`,
        placement: `collection-${block}`,
        position,
      }))
      expect((await POST(request(batch))).status).toBe(200)
    }
    expect(mutate).toHaveBeenCalledTimes(8)
  })

  it("rejects oversized, foreign-origin, and arbitrary-path events", async () => {
    expect(
      (await POST(request(Array.from({ length: 65 }, () => event)))).status,
    ).toBe(400)
    expect((await POST(request([event], "https://evil.example"))).status).toBe(
      403,
    )
    expect(
      (await POST(request([{ ...event, itemPath: "/watch/../secret.html" }])))
        .status,
    ).toBe(400)
    expect(mutate).not.toHaveBeenCalled()
  })
})
