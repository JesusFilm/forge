import { beforeEach, describe, expect, it, vi } from "vitest"

const { enqueueAutomationRunMock } = vi.hoisted(() => ({
  enqueueAutomationRunMock: vi.fn(),
}))

vi.mock("@/features/agents/automation-runner", () => ({
  enqueueAutomationRun: enqueueAutomationRunMock,
}))

import { POST } from "@/app/api/automations/runs/[id]/enqueue/route"

const body = {
  automation: {
    documentId: "automation-1",
    name: "Missing metadata",
    template: "metadata_missing",
    status: "active",
    schedule: { kind: "every_minute", timezone: "UTC" },
    refreshMode: "missing_only",
    targetLanguageIds: [],
    maxVideosPerRun: 1,
    nextRunAt: "2026-04-12T09:00:00.000Z",
  },
}

function buildRequest(headers: HeadersInit) {
  return new Request("http://example.test/api/automations/runs/run-1/enqueue", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function buildRequestWithBody(input: unknown) {
  return new Request("http://example.test/api/automations/runs/run-1/enqueue", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: "Bearer test-manager-api-key",
    },
    body: JSON.stringify(input),
  })
}

describe("POST /api/automations/runs/[id]/enqueue", () => {
  beforeEach(() => {
    enqueueAutomationRunMock.mockReset()
    enqueueAutomationRunMock.mockResolvedValue({
      status: "no_op",
      eligibleCount: 0,
      enqueuedCount: 0,
      skippedDuplicateCount: 0,
      errorCount: 0,
      jobDocumentIds: [],
      errors: [],
      summary: "No eligible videos.",
    })
  })

  it("rejects cookie-only session callers", async () => {
    const response = await POST(buildRequest({ cookie: "strapi-jwt=test" }), {
      params: Promise.resolve({ id: "run-1" }),
    })

    expect(response.status).toBe(403)
    expect(enqueueAutomationRunMock).not.toHaveBeenCalled()
  })

  it("accepts the configured bearer key for service-to-service enqueue", async () => {
    const response = await POST(
      buildRequest({ authorization: "Bearer test-manager-api-key" }),
      {
        params: Promise.resolve({ id: "run-1" }),
      },
    )

    expect(response.status).toBe(200)
    expect(enqueueAutomationRunMock).toHaveBeenCalledWith({
      runDocumentId: "run-1",
      runMode: "live",
      automation: {
        ...body.automation,
        runMode: "live",
        timezone: "UTC",
        runs: [],
      },
    })
    await expect(response.json()).resolves.toMatchObject({
      status: "no_op",
      enqueuedCount: 0,
    })
  })

  it("accepts dry-run mode for service-to-service enqueue", async () => {
    const response = await POST(
      buildRequestWithBody({
        ...body,
        runMode: "dry_run",
        automation: {
          ...body.automation,
          runMode: "dry_run",
        },
      }),
      {
        params: Promise.resolve({ id: "run-1" }),
      },
    )

    expect(response.status).toBe(200)
    expect(enqueueAutomationRunMock).toHaveBeenCalledWith({
      runDocumentId: "run-1",
      runMode: "dry_run",
      automation: {
        ...body.automation,
        runMode: "dry_run",
        timezone: "UTC",
        runs: [],
      },
    })
  })

  it("rejects malformed run mode payloads before enqueue", async () => {
    const response = await POST(
      buildRequestWithBody({
        ...body,
        runMode: "preview",
      }),
      {
        params: Promise.resolve({ id: "run-1" }),
      },
    )

    expect(response.status).toBe(400)
    expect(enqueueAutomationRunMock).not.toHaveBeenCalled()
  })

  it("rejects malformed target language payloads before enqueue", async () => {
    const response = await POST(
      buildRequestWithBody({
        automation: {
          ...body.automation,
          template: "target_subtitles_missing",
          targetLanguageIds: "529",
        },
      }),
      {
        params: Promise.resolve({ id: "run-1" }),
      },
    )

    expect(response.status).toBe(400)
    expect(enqueueAutomationRunMock).not.toHaveBeenCalled()
  })

  it("rejects target subtitle enqueue payloads with more than one target language", async () => {
    const response = await POST(
      buildRequestWithBody({
        automation: {
          ...body.automation,
          template: "target_subtitles_missing",
          targetLanguageIds: ["529", "6414"],
        },
      }),
      {
        params: Promise.resolve({ id: "run-1" }),
      },
    )

    expect(response.status).toBe(400)
    expect(enqueueAutomationRunMock).not.toHaveBeenCalled()
  })
})
