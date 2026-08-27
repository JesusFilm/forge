import { beforeEach, describe, expect, it, vi } from "vitest"

const { comparisonMock, notFoundMock, requireAuthMock, viewMock } = vi.hoisted(
  () => ({
    comparisonMock: vi.fn(),
    notFoundMock: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND")
    }),
    requireAuthMock: vi.fn(),
    viewMock: vi.fn(() => null),
  }),
)

vi.mock("next/navigation", () => ({ notFound: notFoundMock }))
vi.mock("@/features/subtitle-lab/subtitle-lab-admin-client", () => ({
  SubtitleLabAdminClient: {
    configured: vi.fn(async () => ({ getComparison: comparisonMock })),
  },
}))
vi.mock("@/features/subtitle-lab/subtitle-run-comparison", () => ({
  SubtitleRunComparison: viewMock,
}))
vi.mock("@/lib/require-auth", () => ({ requireAuth: requireAuthMock }))

import SubtitleLabComparisonPage from "./page"

describe("Subtitle Lab comparison page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    comparisonMock.mockResolvedValue({ id: "comparison-1" })
    requireAuthMock.mockResolvedValue({ id: "operator-1" })
  })

  it("loads one immutable comparison after operator auth", async () => {
    const element = await SubtitleLabComparisonPage({
      params: Promise.resolve({ comparisonId: "comparison-1" }),
    })

    expect(requireAuthMock).toHaveBeenCalledOnce()
    expect(comparisonMock).toHaveBeenCalledWith("comparison-1")
    expect(element.props.children.type).toBe(viewMock)
    expect(element.props.children.props.comparison).toEqual({
      id: "comparison-1",
    })
  })
})
