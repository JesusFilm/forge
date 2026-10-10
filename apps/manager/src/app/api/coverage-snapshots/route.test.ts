import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_MOCK_CMS_SEED, cloneMockCmsSeed } from "@/cms/mock-seed"

const { authenticateRequestMock, getCmsGatewayMock } = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
  getCmsGatewayMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/cms/gateway", async () => {
  const actual =
    await vi.importActual<typeof import("@/cms/gateway")>("@/cms/gateway")
  return {
    ...actual,
    getCmsGateway: getCmsGatewayMock,
  }
})

vi.mock("@/cms/client", () => ({
  default: vi.fn(() => ({
    query: vi.fn(),
  })),
}))

import { GET } from "./route"

describe("GET /api/coverage-snapshots in mock mode", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    getCmsGatewayMock.mockReset()
    authenticateRequestMock.mockResolvedValue(null)
  })

  it("returns the latest mock snapshot", async () => {
    const snapshots = cloneMockCmsSeed(
      DEFAULT_MOCK_CMS_SEED.readModels.coverageSnapshots,
    )
    const latestSnapshot = snapshots.find(
      (snapshot) => snapshot.documentId === "snapshot-2026-04-22",
    )

    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      getCoverageSnapshots: vi.fn(async (query) =>
        query?.latest ? [latestSnapshot] : snapshots,
      ),
    })

    const response = await GET(
      new Request("http://example.test/api/coverage-snapshots?latest=true"),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      snapshot: expect.objectContaining({
        documentId: "snapshot-2026-04-22",
      }),
    })
  })

  it("filters mock snapshots by date range", async () => {
    const snapshots = cloneMockCmsSeed(
      DEFAULT_MOCK_CMS_SEED.readModels.coverageSnapshots,
    )
    const rangeSnapshots = snapshots.filter(
      (snapshot) => snapshot.date === "2026-04-15",
    )

    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      getCoverageSnapshots: vi.fn(async ({ startDate, endDate }) =>
        snapshots.filter(
          (snapshot) =>
            (!startDate || snapshot.date >= startDate) &&
            (!endDate || snapshot.date <= endDate),
        ),
      ),
    })

    const response = await GET(
      new Request(
        "http://example.test/api/coverage-snapshots?startDate=2026-04-15&endDate=2026-04-15",
      ),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      snapshots: rangeSnapshots,
    })
  })
})
