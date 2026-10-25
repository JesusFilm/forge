import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateServiceBearerRequestMock,
  configuredMock,
  launchSubtitleEvalMock,
  recoverStaleSubtitleEvalRunsMock,
} = vi.hoisted(() => ({
  authenticateServiceBearerRequestMock: vi.fn(),
  configuredMock: vi.fn(),
  launchSubtitleEvalMock: vi.fn(),
  recoverStaleSubtitleEvalRunsMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateServiceBearerRequest: authenticateServiceBearerRequestMock,
}))
vi.mock("@/features/subtitle-lab/subtitle-lab-admin-client", () => ({
  SubtitleLabAdminClient: { configured: configuredMock },
}))
vi.mock("@/workflows/launchSubtitleEval", () => ({
  launchSubtitleEval: launchSubtitleEvalMock,
}))
vi.mock("@/workflows/subtitleEvalRecovery", () => ({
  recoverStaleSubtitleEvalRuns: recoverStaleSubtitleEvalRunsMock,
}))

import { POST } from "./route"

describe("scheduled subtitle evaluation recovery", () => {
  beforeEach(() => {
    authenticateServiceBearerRequestMock.mockReset()
    configuredMock.mockReset()
    launchSubtitleEvalMock.mockReset()
    recoverStaleSubtitleEvalRunsMock.mockReset()
  })

  it("short-circuits before configuring Admin when service auth fails", async () => {
    authenticateServiceBearerRequestMock.mockReturnValueOnce(
      Response.json({ error: "Unauthorized" }, { status: 401 }),
    )

    const response = await POST(
      new Request(
        "https://manager.example/api/scheduled/subtitle-eval-recovery",
        {
          method: "POST",
        },
      ),
    )

    expect(response.status).toBe(401)
    expect(configuredMock).not.toHaveBeenCalled()
    expect(recoverStaleSubtitleEvalRunsMock).not.toHaveBeenCalled()
  })

  it("runs bounded recovery with the configured Admin client", async () => {
    const client = { listStaleRuns: vi.fn() }
    authenticateServiceBearerRequestMock.mockReturnValueOnce(undefined)
    configuredMock.mockResolvedValueOnce(client)
    recoverStaleSubtitleEvalRunsMock.mockResolvedValueOnce([
      { runId: "run-1", status: "recovered" },
    ])

    const response = await POST(
      new Request(
        "https://manager.example/api/scheduled/subtitle-eval-recovery",
        {
          method: "POST",
          headers: { authorization: "Bearer service-secret" },
        },
      ),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      outcomes: [{ runId: "run-1", status: "recovered" }],
    })
    expect(recoverStaleSubtitleEvalRunsMock).toHaveBeenCalledWith({
      client,
      launch: launchSubtitleEvalMock,
    })
  })
})
