import { beforeEach, describe, expect, it, vi } from "vitest"

const { envMock, mergeJobArtifactsMock, updateJobMock, updateStepStatusMock } =
  vi.hoisted(() => ({
    envMock: {
      MANAGER_AGENTIC_API_KEY: "manager-agentic-key",
    },
    mergeJobArtifactsMock: vi.fn(),
    updateJobMock: vi.fn(),
    updateStepStatusMock: vi.fn(),
  }))

vi.mock("@/config/env", () => ({
  env: envMock,
}))

vi.mock("@/lib/state", () => ({
  mergeJobArtifacts: mergeJobArtifactsMock,
  updateJob: updateJobMock,
  updateStepStatus: updateStepStatusMock,
}))

import { POST } from "./route"

function buildRequest(body: unknown, token = "manager-agentic-key") {
  return new Request(
    "http://example.test/api/agentic/subtitle-enrichment-runs/run-1/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  )
}

const baseEvent = {
  eventId: "event-1",
  runId: "run-1",
  jobId: "job-1",
  idempotencyKey: "agentic:event-1",
  sequence: 1,
}

describe("POST /api/agentic/subtitle-enrichment-runs/[runId]/events", () => {
  beforeEach(() => {
    envMock.MANAGER_AGENTIC_API_KEY = "manager-agentic-key"
    mergeJobArtifactsMock.mockReset()
    updateJobMock.mockReset()
    updateStepStatusMock.mockReset()
    mergeJobArtifactsMock.mockResolvedValue({})
    updateJobMock.mockResolvedValue({})
    updateStepStatusMock.mockResolvedValue({})
  })

  it("rejects requests without the Manager Agentic bearer key", async () => {
    const response = await POST(
      buildRequest({ ...baseEvent, type: "workflow_started" }, "wrong"),
      {
        params: Promise.resolve({ runId: "run-1" }),
      },
    )

    expect(response.status).toBe(403)
    expect(updateJobMock).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "service_bearer_required",
    })
  })

  it("maps workflow events to job status updates", async () => {
    const response = await POST(
      buildRequest({
        ...baseEvent,
        type: "workflow_started",
        occurredAt: "2026-05-05T10:00:00.000Z",
      }),
      {
        params: Promise.resolve({ runId: "run-1" }),
      },
    )

    expect(response.status).toBe(202)
    expect(updateJobMock).toHaveBeenCalledWith("job-1", {
      status: "running",
      startedAt: "2026-05-05T10:00:00.000Z",
    })
    await expect(response.json()).resolves.toEqual({
      ok: true,
      deduped: false,
    })
  })

  it("maps step events to existing step state helpers and merges artifacts", async () => {
    const response = await POST(
      buildRequest({
        ...baseEvent,
        eventId: "event-step-completed",
        idempotencyKey: "agentic:event-step-completed",
        type: "step_completed",
        sequence: 2,
        step: "translation",
        artifacts: {
          "subtitles-fr": { kind: "downloadable" },
          "translation-fr": { kind: "downloadable" },
        },
      }),
      {
        params: Promise.resolve({ runId: "run-1" }),
      },
    )

    expect(response.status).toBe(202)
    expect(updateStepStatusMock).toHaveBeenCalledWith(
      "job-1",
      "translation",
      "completed",
    )
    expect(mergeJobArtifactsMock).toHaveBeenCalledWith("job-1", {
      "subtitles-fr": { kind: "downloadable" },
      "translation-fr": { kind: "downloadable" },
    })
  })

  it("maps failed events to failed job or step state with sanitized errors", async () => {
    const response = await POST(
      buildRequest({
        ...baseEvent,
        eventId: "event-step-failed",
        idempotencyKey: "agentic:event-step-failed",
        type: "step_failed",
        sequence: 3,
        step: "translation",
        error: { message: "Translator rejected request", secret: "hidden" },
      }),
      {
        params: Promise.resolve({ runId: "run-1" }),
      },
    )

    expect(response.status).toBe(202)
    expect(updateStepStatusMock).toHaveBeenCalledWith(
      "job-1",
      "translation",
      "failed",
      "Translator rejected request",
    )
  })

  it("deduplicates already accepted events in-process", async () => {
    const event = {
      ...baseEvent,
      eventId: "event-dedupe",
      idempotencyKey: "agentic:event-dedupe",
      type: "workflow_completed",
      sequence: 4,
      occurredAt: "2026-05-05T10:05:00.000Z",
    }

    const first = await POST(buildRequest(event), {
      params: Promise.resolve({ runId: "run-1" }),
    })
    const second = await POST(buildRequest(event), {
      params: Promise.resolve({ runId: "run-1" }),
    })

    expect(first.status).toBe(202)
    expect(second.status).toBe(202)
    expect(updateJobMock).toHaveBeenCalledTimes(1)
    await expect(second.json()).resolves.toEqual({
      ok: true,
      deduped: true,
    })
  })

  it("rejects events that do not match the route run id", async () => {
    const response = await POST(
      buildRequest({
        ...baseEvent,
        runId: "different-run",
        type: "workflow_started",
      }),
      {
        params: Promise.resolve({ runId: "run-1" }),
      },
    )

    expect(response.status).toBe(400)
    expect(updateJobMock).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "invalid_event",
    })
  })
})
