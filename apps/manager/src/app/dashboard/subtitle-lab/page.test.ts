import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  dashboardMock,
  getCorpusMock,
  listIssuesMock,
  listRunsMock,
  requireAuthMock,
} = vi.hoisted(() => ({
  dashboardMock: vi.fn(() => null),
  getCorpusMock: vi.fn(),
  listIssuesMock: vi.fn(),
  listRunsMock: vi.fn(),
  requireAuthMock: vi.fn(),
}))

vi.mock("@/features/subtitle-lab/subtitle-lab-admin-client", () => ({
  SubtitleLabAdminClient: {
    configured: vi.fn(async () => ({
      getCorpusVersion: getCorpusMock,
      listReferenceIssues: listIssuesMock,
      listRuns: listRunsMock,
    })),
  },
}))
vi.mock("@/features/subtitle-lab/subtitle-lab-dashboard", () => ({
  SubtitleLabDashboard: dashboardMock,
}))
vi.mock("@/lib/require-auth", () => ({ requireAuth: requireAuthMock }))

import SubtitleLabPage from "./page"

describe("Subtitle Lab operator overview page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ id: "operator-1" })
    getCorpusMock.mockResolvedValue({ id: "corpus-1" })
    listIssuesMock.mockResolvedValue({ nodes: [{ id: "issue-1" }] })
    listRunsMock.mockResolvedValue({ nodes: [{ id: "run-1" }] })
  })

  it("loads bounded corpus, run, and open-issue projections after operator auth", async () => {
    const element = await SubtitleLabPage({
      searchParams: Promise.resolve({ corpusId: "corpus-1" }),
    })

    expect(requireAuthMock).toHaveBeenCalledOnce()
    expect(getCorpusMock).toHaveBeenCalledWith("corpus-1")
    expect(listRunsMock).toHaveBeenCalledWith(25)
    expect(listIssuesMock).toHaveBeenCalledWith("OPEN", 25)
    expect(element.props.children.type).toBe(dashboardMock)
    expect(element.props.children.props).toEqual({
      initialCorpus: { id: "corpus-1" },
      initialReferenceIssues: [{ id: "issue-1" }],
      initialRuns: [{ id: "run-1" }],
    })
  })

  it("does not send an invalid query identity to Admin", async () => {
    await SubtitleLabPage({
      searchParams: Promise.resolve({ corpusId: "" }),
    })

    expect(getCorpusMock).not.toHaveBeenCalled()
  })
})
