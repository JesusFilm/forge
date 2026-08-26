import { beforeEach, describe, expect, it, vi } from "vitest"

const { listRunsMock } = vi.hoisted(() => ({ listRunsMock: vi.fn() }))

vi.mock("@/features/subtitle-lab/subtitle-lab-admin-client", () => ({
  SubtitleLabAdminClient: {
    configured: vi.fn(async () => ({ listRuns: listRunsMock })),
  },
}))
vi.mock("@/features/subtitle-lab/subtitle-lab-route", () => ({
  requireSubtitleLabOperator: vi.fn(async () => ({ id: "operator-1" })),
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
vi.mock("@/workflows/launchSubtitleEval", () => ({
  launchSubtitleEval: vi.fn(),
}))
vi.mock("@/workflows/subtitleEvalLaunch", () => ({
  createAndLaunchSubtitleEvalRun: vi.fn(),
}))

import { GET } from "./route"

describe("operator subtitle run list BFF", () => {
  beforeEach(() => listRunsMock.mockReset())

  it("returns a bounded private list", async () => {
    listRunsMock.mockResolvedValueOnce({ nodes: [], nextCursor: null })
    const response = await GET(
      new Request("https://manager.example/api/subtitle-lab/runs?limit=50"),
    )

    expect(response.status).toBe(200)
    expect(listRunsMock).toHaveBeenCalledWith(50, undefined)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("returns a typed private outage without upstream details", async () => {
    listRunsMock.mockRejectedValueOnce(new Error("secret upstream detail"))
    const response = await GET(
      new Request("https://manager.example/api/subtitle-lab/runs"),
    )

    expect(response.status).toBe(503)
    expect(await response.text()).not.toMatch(/secret/i)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("rejects pagination outside the public ceiling", async () => {
    const response = await GET(
      new Request("https://manager.example/api/subtitle-lab/runs?limit=51"),
    )

    expect(response.status).toBe(400)
    expect(listRunsMock).not.toHaveBeenCalled()
  })
})
