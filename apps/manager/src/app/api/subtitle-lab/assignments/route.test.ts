import { beforeEach, describe, expect, it, vi } from "vitest"

const { queueMock } = vi.hoisted(() => ({ queueMock: vi.fn() }))

vi.mock("@/features/subtitle-lab/subtitle-lab-admin-client", () => ({
  SubtitleLabAdminClient: {
    configured: vi.fn(async () => ({ reviewerQueue: queueMock })),
  },
}))
vi.mock("@/features/subtitle-lab/subtitle-lab-route", () => ({
  requireSubtitleLabReviewer: vi.fn(async () => ({ id: "reviewer-1" })),
  requireSubtitleLabOperator: vi.fn(),
  guardSubtitleLabMutation: vi.fn(),
  readBoundedSubtitleLabJson: vi.fn(),
  privateNoStoreJson: (value: unknown, init?: ResponseInit) =>
    Response.json(value, {
      ...init,
      headers: { "cache-control": "private, no-store", ...init?.headers },
    }),
  subtitleLabUpstreamUnavailable: () =>
    Response.json(
      { error: "Temporarily unavailable", retryable: true },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    ),
}))

import { GET } from "./route"

describe("reviewer assignment queue BFF", () => {
  beforeEach(() => queueMock.mockReset())

  it("keeps a real empty queue distinct from an outage", async () => {
    queueMock.mockResolvedValueOnce({ nodes: [], nextCursor: null })
    const response = await GET(
      new Request("https://manager.example/api/subtitle-lab/assignments"),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ nodes: [], nextCursor: null })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("returns a typed retryable outage instead of a false empty queue", async () => {
    queueMock.mockRejectedValueOnce(new Error("Admin unavailable"))
    const response = await GET(
      new Request("https://manager.example/api/subtitle-lab/assignments"),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: "Temporarily unavailable",
      retryable: true,
    })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
})
