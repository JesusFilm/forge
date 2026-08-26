import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getRunMock,
  listAssignmentsMock,
  listCandidatesMock,
  notFoundMock,
  reportMock,
  requireAuthMock,
} = vi.hoisted(() => ({
  getRunMock: vi.fn(),
  listAssignmentsMock: vi.fn(),
  listCandidatesMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
  reportMock: vi.fn(() => null),
  requireAuthMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({ notFound: notFoundMock }))
vi.mock("@/features/subtitle-lab/subtitle-lab-admin-client", () => ({
  SubtitleLabAdminClient: {
    configured: vi.fn(async () => ({
      getRun: getRunMock,
      listOperatorAssignments: listAssignmentsMock,
      listOperatorReviewerCandidates: listCandidatesMock,
    })),
  },
}))
vi.mock("@/features/subtitle-lab/subtitle-run-report", () => ({
  SubtitleRunReport: reportMock,
}))
vi.mock("@/lib/require-auth", () => ({ requireAuth: requireAuthMock }))

import SubtitleLabRunPage from "./page"

const run = {
  id: "run-1",
  cells: [
    {
      id: "cell-es-1",
      targetLanguageId: "language-es",
      targetLanguageSlug: "spanish",
    },
    {
      id: "cell-es-2",
      targetLanguageId: "language-es",
      targetLanguageSlug: "spanish",
    },
    {
      id: "cell-fr",
      targetLanguageId: "language-fr",
      targetLanguageSlug: "french",
    },
  ],
}

describe("Subtitle Lab run report page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ id: "operator-1" })
    getRunMock.mockResolvedValue(run)
    listAssignmentsMock.mockResolvedValue({ nodes: [{ id: "assignment-1" }] })
    listCandidatesMock.mockImplementation(
      async (languageId: string, languageSlug: string) => ({
        nodes: [{ membershipId: `${languageId}:${languageSlug}` }],
      }),
    )
  })

  it("loads assignment progress and candidates once per exact language pair", async () => {
    const element = await SubtitleLabRunPage({
      params: Promise.resolve({ runId: "run-1" }),
    })

    expect(requireAuthMock).toHaveBeenCalledOnce()
    expect(getRunMock).toHaveBeenCalledWith("run-1")
    expect(listAssignmentsMock).toHaveBeenCalledWith("run-1", undefined, 50)
    expect(listCandidatesMock).toHaveBeenCalledTimes(2)
    expect(listCandidatesMock).toHaveBeenCalledWith(
      "language-es",
      "spanish",
      undefined,
      50,
    )
    expect(listCandidatesMock).toHaveBeenCalledWith(
      "language-fr",
      "french",
      undefined,
      50,
    )
    expect(element.props.children.type).toBe(reportMock)
    expect(element.props.children.props.assignments).toEqual([
      { id: "assignment-1" },
    ])
    expect(element.props.children.props.reviewerCandidates).toHaveLength(2)
  })

  it("returns not found without querying Admin for an invalid run identity", async () => {
    await expect(
      SubtitleLabRunPage({ params: Promise.resolve({ runId: "" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND")

    expect(getRunMock).not.toHaveBeenCalled()
  })
})
