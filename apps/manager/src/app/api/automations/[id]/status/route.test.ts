import { beforeEach, describe, expect, it, vi } from "vitest"

const { authenticateRequestMock, updateAutomationStatusMock } = vi.hoisted(
  () => ({
    authenticateRequestMock: vi.fn(),
    updateAutomationStatusMock: vi.fn(),
  }),
)

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/features/agents/automation-store", () => ({
  updateAutomationStatus: updateAutomationStatusMock,
}))

import { PATCH } from "@/app/api/automations/[id]/status/route"

function buildPatchRequest(body: unknown) {
  return new Request(
    "http://example.test/api/automations/automation-1/status",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  )
}

describe("PATCH /api/automations/[id]/status", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    updateAutomationStatusMock.mockReset()
    authenticateRequestMock.mockResolvedValue(null)
  })

  it("rejects unsupported statuses", async () => {
    const response = await PATCH(buildPatchRequest({ status: "complete" }), {
      params: Promise.resolve({ id: "automation-1" }),
    })

    expect(response.status).toBe(400)
    expect(updateAutomationStatusMock).not.toHaveBeenCalled()
  })

  it("pauses and resumes existing automations", async () => {
    updateAutomationStatusMock.mockResolvedValue({ documentId: "automation-1" })

    const response = await PATCH(buildPatchRequest({ status: "paused" }), {
      params: Promise.resolve({ id: "automation-1" }),
    })

    expect(response.status).toBe(200)
    expect(updateAutomationStatusMock).toHaveBeenCalledWith("automation-1", {
      status: "paused",
      nextRunAt: null,
    })
  })
})
