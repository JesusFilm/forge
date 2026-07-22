import { describe, expect, it, vi } from "vitest"

import {
  handleVideoFirstCancelRequest,
  handleVideoFirstResumeRequest,
  handleVideoFirstRetryRequest,
  handleVideoFirstStartRequest,
  handleVideoFirstStatusRequest,
  reservationOwnerFromState,
  type VideoFirstLifecycleDeps,
  type VideoFirstWorkflowState,
} from "./video-first-devotional-route"

const AUTH = { authHeader: "Bearer secret", serviceKeys: ["secret"] }
const APPROVAL_ACTOR = {
  subject: "reviewer-1",
  email: "reviewer@example.com",
  role: "editor" as const,
}
const ARTIFACTS = {
  portraitAsset: {
    assetId: "devo_1",
    artifactType: "devotional-output-portrait-v1" as const,
    ext: "mp4" as const,
  },
  wideAsset: {
    assetId: "devo_1",
    artifactType: "devotional-output-wide-v1" as const,
    ext: "mp4" as const,
  },
}
const SUSPENSION = {
  message: "Review",
  ...ARTIFACTS,
  portraitUrl:
    "/forge-video-first-devotional/assets/devo_1/devotional-output-portrait-v1/mp4",
  wideUrl:
    "/forge-video-first-devotional/assets/devo_1/devotional-output-wide-v1/mp4",
  title: "Hope",
  reference: "Luke 1:1",
  reflectionPreview: "Preview",
}

function harness(states: Record<string, VideoFirstWorkflowState> = {}) {
  const start = vi.fn(async () => ({ runId: "daily-devotional-20260721" }))
  const resume = vi.fn(async () => ({
    status: "success" as const,
    result: { status: "published" },
  }))
  const cancel = vi.fn(async () => undefined)
  const deps: VideoFirstLifecycleDeps = {
    workflow: {
      createRun: vi.fn(async () => ({ startAsync: start, resume, cancel })),
      getWorkflowRunById: vi.fn(async (runId) => states[runId] ?? null),
    },
    renewReservation: vi.fn(async () => undefined),
    releaseReservation: vi.fn(async () => undefined),
    now: () => new Date("2026-07-21T12:00:00Z"),
  }
  return { deps, start, resume, cancel }
}

describe("video-first devotional lifecycle routes", () => {
  it("finds a reservation owner inside persisted nested workflow steps", () => {
    expect(
      reservationOwnerFromState({
        runId: "run1",
        status: "suspended",
        steps: {
          "devotional-source.pick": {
            status: "success",
            output: {
              reservationId: "49cb0cc4-2fdd-4edb-a1f6-d90664d2c885",
              chapter: { id: "2_GOOD_NEWS", index: 2 },
            },
          },
          "devotional-render.render": {
            output: {
              reservationId: "49cb0cc4-2fdd-4edb-a1f6-d90664d2c885",
              devotional: {
                date: "2026-07-21",
                sequence: 3,
                clip: { id: "2_GOOD_NEWS", index: 2 },
              },
            },
          },
        },
      }),
    ).toEqual({
      chapterId: "2_GOOD_NEWS",
      reservationId: "49cb0cc4-2fdd-4edb-a1f6-d90664d2c885",
      chapterIndex: 2,
    })
  })

  it("fails closed without a service bearer", async () => {
    const { deps } = harness()
    const outcome = await handleVideoFirstStartRequest({
      authHeader: undefined,
      serviceKeys: ["secret"],
      readJson: async () => ({}),
      deps,
    })
    expect(outcome.status).toBe(401)
  })

  it("blocks new starts when the architecture exception kill switch is off", async () => {
    const { deps, start } = harness()
    const outcome = await handleVideoFirstStartRequest({
      ...AUTH,
      newRunsEnabled: false,
      readJson: async () => ({}),
      deps,
    })
    expect(outcome).toEqual({
      status: 503,
      body: { error: "new_runs_disabled" },
    })
    expect(start).not.toHaveBeenCalled()
  })

  it("starts the date-idempotent run asynchronously for status polling", async () => {
    const { deps, start } = harness()
    const outcome = await handleVideoFirstStartRequest({
      ...AUTH,
      readJson: async () => ({ date: "2026-07-21" }),
      deps,
    })
    expect(outcome).toMatchObject({
      status: 202,
      body: {
        runId: "daily-devotional-20260721",
        status: "pending",
      },
    })
    expect(start).toHaveBeenCalledWith({
      inputData: expect.objectContaining({ date: "2026-07-21" }),
    })
  })

  it("reattaches a same-date launch instead of starting a second run", async () => {
    const state: VideoFirstWorkflowState = {
      runId: "daily-devotional-20260721",
      status: "suspended",
      steps: { approve: { status: "suspended", suspendPayload: SUSPENSION } },
    }
    const { deps, start } = harness({ [state.runId]: state })
    const outcome = await handleVideoFirstStartRequest({
      ...AUTH,
      readJson: async () => ({ date: "2026-07-21" }),
      deps,
    })
    expect(outcome).toMatchObject({
      status: 200,
      body: { runId: state.runId, status: "suspended", existing: true },
    })
    expect(start).not.toHaveBeenCalled()
    expect(deps.renewReservation).toHaveBeenCalledWith(state)
  })

  it("serializes concurrent same-date launches", async () => {
    const states: Record<string, VideoFirstWorkflowState> = {}
    const start = vi.fn(
      async ({ inputData }: { inputData: Record<string, unknown> }) => {
        states["daily-devotional-20260721"] = {
          runId: "daily-devotional-20260721",
          status: "running",
          payload: inputData,
        }
        return { runId: "daily-devotional-20260721" }
      },
    )
    const deps: VideoFirstLifecycleDeps = {
      workflow: {
        createRun: vi.fn(async () => ({
          startAsync: start,
          resume: vi.fn(),
          cancel: vi.fn(),
        })),
        getWorkflowRunById: vi.fn(async (runId) => states[runId] ?? null),
      },
      renewReservation: vi.fn(),
      releaseReservation: vi.fn(),
    }

    const request = () =>
      handleVideoFirstStartRequest({
        ...AUTH,
        readJson: async () => ({ date: "2026-07-21" }),
        deps,
      })
    const outcomes = await Promise.all([request(), request()])

    expect(start).toHaveBeenCalledOnce()
    expect(outcomes.map(({ body }) => body.existing)).toEqual([false, true])
  })

  it("renews and resumes only suspended runs", async () => {
    const state: VideoFirstWorkflowState = {
      runId: "run1",
      status: "suspended",
    }
    const { deps, resume } = harness({ run1: state })
    const outcome = await handleVideoFirstResumeRequest({
      ...AUTH,
      runId: "run1",
      approvalActor: APPROVAL_ACTOR,
      readJson: async () => ({ approved: true, notes: "looks good" }),
      deps,
    })
    expect(outcome).toMatchObject({
      status: 200,
      body: { runId: "run1", result: { status: "published" } },
    })
    expect(deps.renewReservation).toHaveBeenCalledWith(state)
    expect(resume).toHaveBeenCalledWith({
      resumeData: {
        approved: true,
        notes: "looks good",
        approvedBy: APPROVAL_ACTOR,
      },
    })
  })

  it("fails closed when approval actor attribution is absent", async () => {
    const { deps, resume } = harness({
      run1: { runId: "run1", status: "suspended" },
    })
    const outcome = await handleVideoFirstResumeRequest({
      ...AUTH,
      runId: "run1",
      approvalActor: undefined,
      readJson: async () => ({ approved: true }),
      deps,
    })
    expect(outcome).toEqual({
      status: 401,
      body: { error: "approval_actor_required" },
    })
    expect(resume).not.toHaveBeenCalled()
  })

  it("serializes concurrent resume and cancel transitions", async () => {
    let state: VideoFirstWorkflowState = {
      runId: "run1",
      status: "suspended",
    }
    const resume = vi.fn(async () => {
      state = { ...state, status: "success", result: { status: "published" } }
      return { status: "success", result: { status: "published" } }
    })
    const cancel = vi.fn(async () => {
      state = { ...state, status: "canceled" }
    })
    const deps: VideoFirstLifecycleDeps = {
      workflow: {
        createRun: vi.fn(async () => ({
          startAsync: vi.fn(),
          resume,
          cancel,
        })),
        getWorkflowRunById: vi.fn(async () => state),
      },
      renewReservation: vi.fn(),
      releaseReservation: vi.fn(),
    }

    const [resumeOutcome, cancelOutcome] = await Promise.all([
      handleVideoFirstResumeRequest({
        ...AUTH,
        runId: "run1",
        approvalActor: APPROVAL_ACTOR,
        readJson: async () => ({ approved: true }),
        deps,
      }),
      handleVideoFirstCancelRequest({ ...AUTH, runId: "run1", deps }),
    ])

    expect([resumeOutcome.status, cancelOutcome.status].sort()).toEqual([
      200, 409,
    ])
    expect(resume.mock.calls.length + cancel.mock.calls.length).toBe(1)
  })

  it("renews suspended reservations when status is polled", async () => {
    const state: VideoFirstWorkflowState = {
      runId: "run1",
      status: "suspended",
    }
    const { deps } = harness({ run1: state })
    expect(
      await handleVideoFirstStatusRequest({ ...AUTH, runId: "run1", deps }),
    ).toMatchObject({ status: 200, body: { status: "suspended" } })
    expect(deps.renewReservation).toHaveBeenCalledWith(state)
  })

  it("keeps playback-authorized status reads side-effect free", async () => {
    const state: VideoFirstWorkflowState = {
      runId: "run1",
      status: "suspended",
    }
    const { deps } = harness({ run1: state })
    expect(
      await handleVideoFirstStatusRequest({
        ...AUTH,
        runId: "run1",
        renewReservationOnRead: false,
        deps,
      }),
    ).toMatchObject({ status: 200, body: { status: "suspended" } })
    expect(deps.renewReservation).not.toHaveBeenCalled()
  })

  it("cancels and releases an active run reservation", async () => {
    const state: VideoFirstWorkflowState = {
      runId: "run1",
      status: "suspended",
    }
    const { deps, cancel } = harness({ run1: state })
    const outcome = await handleVideoFirstCancelRequest({
      ...AUTH,
      runId: "run1",
      deps,
    })
    expect(outcome).toEqual({
      status: 200,
      body: { runId: "run1", status: "canceled" },
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(deps.releaseReservation).toHaveBeenCalledWith(state)
  })

  it("retries a failed run with explicit regeneration flags", async () => {
    const state: VideoFirstWorkflowState = {
      runId: "run1",
      status: "failed",
      payload: { date: "2026-07-20", chapterIndex: 4 },
    }
    const { deps, start } = harness({ run1: state })
    const outcome = await handleVideoFirstRetryRequest({
      ...AUTH,
      runId: "run1",
      readJson: async () => ({ regenerateAudio: true }),
      deps,
    })
    expect(outcome.body.runId).toMatch(/^run1-retry-[a-f0-9]{12}$/)
    expect(start).toHaveBeenCalledWith({
      inputData: {
        date: "2026-07-20",
        chapterIndex: 4,
        regenerate: false,
        regenerateAudio: true,
      },
    })
  })

  it("blocks retries when the architecture exception kill switch is off", async () => {
    const { deps, start } = harness({
      run1: {
        runId: "run1",
        status: "failed",
        payload: { date: "2026-07-20" },
      },
    })
    const outcome = await handleVideoFirstRetryRequest({
      ...AUTH,
      runId: "run1",
      newRunsEnabled: false,
      readJson: async () => ({}),
      deps,
    })
    expect(outcome).toEqual({
      status: 503,
      body: { error: "new_runs_disabled" },
    })
    expect(start).not.toHaveBeenCalled()
  })

  it("reattaches duplicate retries to one deterministic child run", async () => {
    const states: Record<string, VideoFirstWorkflowState> = {
      run1: {
        runId: "run1",
        status: "failed",
        payload: { date: "2026-07-20" },
      },
    }
    const start = vi.fn(
      async ({ inputData }: { inputData: Record<string, unknown> }) => {
        const childId = Object.keys(states).find((id) => id !== "run1")
        if (childId) states[childId]!.payload = inputData
        return { runId: childId ?? "pending" }
      },
    )
    const deps: VideoFirstLifecycleDeps = {
      workflow: {
        createRun: vi.fn(async ({ runId }) => {
          states[runId] = { runId, status: "running" }
          return { startAsync: start, resume: vi.fn(), cancel: vi.fn() }
        }),
        getWorkflowRunById: vi.fn(async (runId) => states[runId] ?? null),
      },
      renewReservation: vi.fn(),
      releaseReservation: vi.fn(),
    }
    const request = () =>
      handleVideoFirstRetryRequest({
        ...AUTH,
        runId: "run1",
        readJson: async () => ({ regenerateAudio: true }),
        deps,
      })

    const outcomes = await Promise.all([request(), request()])

    expect(start).toHaveBeenCalledOnce()
    expect(outcomes[0].body.runId).toBe(outcomes[1].body.runId)
    expect(outcomes.map(({ body }) => body.existing)).toEqual([false, true])
  })

  it("never retries an already published date", async () => {
    const { deps } = harness({
      run1: {
        runId: "run1",
        status: "success",
        payload: { date: "2026-07-20" },
        result: { status: "published" },
      },
    })
    expect(
      await handleVideoFirstRetryRequest({
        ...AUTH,
        runId: "run1",
        readJson: async () => ({}),
        deps,
      }),
    ).toEqual({
      status: 409,
      body: { error: "published_run_not_retryable" },
    })
  })
})
