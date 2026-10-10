import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_MOCK_CMS_SEED, cloneMockCmsSeed } from "@/cms/mock-seed"

const { cmsPostMock, getCmsGatewayMock, mutateMock, queryMock } = vi.hoisted(
  () => ({
    cmsPostMock: vi.fn(),
    getCmsGatewayMock: vi.fn(),
    mutateMock: vi.fn(),
    queryMock: vi.fn(),
  }),
)

vi.mock("@/cms/client", () => ({
  default: () => ({
    mutate: mutateMock,
    query: queryMock,
  }),
}))

vi.mock("@/services/cmsClient", () => ({
  cmsPost: cmsPostMock,
}))

vi.mock("@/cms/gateway", async () => {
  const actual =
    await vi.importActual<typeof import("@/cms/gateway")>("@/cms/gateway")
  return {
    ...actual,
    getCmsGateway: getCmsGatewayMock,
  }
})

import { createJob, listJobs } from "./state"

describe("createJob in mock mode", () => {
  beforeEach(() => {
    cmsPostMock.mockReset()
    mutateMock.mockReset()
    queryMock.mockReset()
    getCmsGatewayMock.mockReset()
  })

  it("persists a demo job locally without hitting CMS writers", async () => {
    let state = cloneMockCmsSeed(DEFAULT_MOCK_CMS_SEED)
    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      readMockState: vi.fn(async () => state),
      updateMockState: vi.fn(async (updater) => {
        state = updater(state)
        return state
      }),
    })

    const job = await createJob(
      "mock-created-asset",
      "mock-created-playback",
      ["6414"],
      {
        videoDocumentId: "video-doc-episode-2",
        initialArtifacts: {
          metadataSeed: {
            kind: "metadata",
            data: { source: "mock-test" },
          },
        },
      },
    )

    expect(job.id).toBe("mock-job-3")
    expect(job.sourceCollectionTitle).toBe("Hope Stories")
    expect(job.sourceMediaTitle).toBe("Episode 2")
    expect(job.artifacts).toMatchObject({
      metadataSeed: {
        kind: "metadata",
        data: { source: "mock-test" },
      },
    })
    expect(cmsPostMock).not.toHaveBeenCalled()
    expect(mutateMock).not.toHaveBeenCalled()
    await expect(listJobs()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "mock-job-3" })]),
    )
  })
})
