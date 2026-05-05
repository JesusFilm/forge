import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  envMock,
  getJobMock,
  mergeJobArtifactsMock,
  updateJobMock,
  updateStepStatusMock,
} = vi.hoisted(() => ({
  envMock: {
    MANAGER_AGENTIC_API_KEY: "manager-agentic-key",
  },
  getJobMock: vi.fn(),
  mergeJobArtifactsMock: vi.fn(),
  updateJobMock: vi.fn(),
  updateStepStatusMock: vi.fn(),
}))

vi.mock("@/config/env", () => ({
  env: envMock,
}))

vi.mock("@/lib/state", () => {
  return {
    getJob: getJobMock,
    mergeArtifactEntries: (
      existing: Record<string, unknown>,
      incoming: Record<string, unknown>,
    ) => ({
      ...existing,
      ...incoming,
    }),
    mergeJobArtifacts: mergeJobArtifactsMock,
    updateJob: updateJobMock,
    updateStepStatus: updateStepStatusMock,
  }
})

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

function mockJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    muxAssetId: "mux-asset-1",
    muxPlaybackId: "mux-playback-1",
    languages: ["fr"],
    options: {},
    status: "pending",
    retries: 0,
    createdAt: "2026-05-05T09:00:00.000Z",
    updatedAt: "2026-05-05T09:00:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
  }
}

describe("POST /api/agentic/subtitle-enrichment-runs/[runId]/events", () => {
  beforeEach(() => {
    envMock.MANAGER_AGENTIC_API_KEY = "manager-agentic-key"
    mergeJobArtifactsMock.mockReset()
    updateJobMock.mockReset()
    updateStepStatusMock.mockReset()
    getJobMock.mockReset()
    getJobMock.mockResolvedValue(mockJob())
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
    expect(mergeJobArtifactsMock).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        "subtitles-fr": { kind: "downloadable" },
        "translation-fr": { kind: "downloadable" },
      }),
    )
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

  it("deduplicates already persisted callback events across restarts", async () => {
    getJobMock.mockResolvedValue(
      mockJob({
        artifacts: {
          agenticSubtitleCallbackState: {
            kind: "metadata",
            data: {
              runId: "persisted-run",
              lastAcceptedSequence: 7,
              acceptedEventIds: ["persisted-event"],
              lastEventId: "persisted-event",
              lastEventType: "step_completed",
              updatedAt: "2026-05-05T10:07:00.000Z",
            },
          },
        },
      }),
    )

    const response = await POST(
      buildRequest({
        ...baseEvent,
        eventId: "persisted-event",
        runId: "persisted-run",
        idempotencyKey: "agentic:persisted-event",
        type: "step_completed",
        sequence: 7,
        step: "translation",
      }),
      {
        params: Promise.resolve({ runId: "persisted-run" }),
      },
    )

    expect(response.status).toBe(202)
    expect(updateStepStatusMock).not.toHaveBeenCalled()
    expect(updateJobMock).not.toHaveBeenCalled()
    expect(mergeJobArtifactsMock).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      ok: true,
      deduped: true,
    })
  })

  it("ignores stale non-terminal events after a job is already terminal", async () => {
    getJobMock.mockResolvedValue(
      mockJob({
        status: "completed",
        completedAt: "2026-05-05T10:10:00.000Z",
      }),
    )

    const response = await POST(
      buildRequest({
        ...baseEvent,
        eventId: "terminal-stale-event",
        runId: "terminal-run",
        idempotencyKey: "agentic:terminal-stale-event",
        type: "step_started",
        sequence: 50,
        step: "translation",
      }),
      {
        params: Promise.resolve({ runId: "terminal-run" }),
      },
    )

    expect(response.status).toBe(202)
    expect(updateStepStatusMock).not.toHaveBeenCalled()
    expect(updateJobMock).not.toHaveBeenCalled()
    expect(mergeJobArtifactsMock).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      ok: true,
      deduped: true,
    })
  })

  it("persists workflow failure errors without leaking raw upstream objects", async () => {
    getJobMock.mockResolvedValue(
      mockJob({
        currentStep: "translation",
        errors: [],
      }),
    )

    const response = await POST(
      buildRequest({
        ...baseEvent,
        eventId: "workflow-failed-event",
        runId: "workflow-failed-run",
        idempotencyKey: "agentic:workflow-failed-event",
        type: "workflow_failed",
        sequence: 20,
        occurredAt: "2026-05-05T10:20:00.000Z",
        error: {
          message: "Translator rejected request",
          secret: "hidden",
        },
      }),
      {
        params: Promise.resolve({ runId: "workflow-failed-run" }),
      },
    )

    expect(response.status).toBe(202)
    expect(updateJobMock).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        status: "failed",
        completedAt: "2026-05-05T10:20:00.000Z",
        errors: [
          {
            step: "translation",
            message: "Translator rejected request",
            at: "2026-05-05T10:20:00.000Z",
            code: "agentic_workflow_failed",
          },
        ],
      }),
    )
    expect(JSON.stringify(updateJobMock.mock.calls[0]?.[1])).not.toContain(
      "hidden",
    )
  })

  it("persists callback state with accepted events", async () => {
    const response = await POST(
      buildRequest({
        ...baseEvent,
        eventId: "persist-state-event",
        runId: "persist-state-run",
        idempotencyKey: "agentic:persist-state-event",
        type: "workflow_started",
        sequence: 10,
        occurredAt: "2026-05-05T10:10:00.000Z",
      }),
      {
        params: Promise.resolve({ runId: "persist-state-run" }),
      },
    )

    expect(response.status).toBe(202)
    expect(mergeJobArtifactsMock).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        agenticSubtitleCallbackState: expect.objectContaining({
          kind: "metadata",
          data: expect.objectContaining({
            runId: "persist-state-run",
            lastAcceptedSequence: 10,
            acceptedEventIds: ["persist-state-event"],
          }),
        }),
      }),
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
