import { readFileSync } from "node:fs"

import { describe, expect, it, vi } from "vitest"

import {
  createStorefrontHomepageCurationApiRoutes,
  handleStorefrontHomepageCurationRouteRequest,
  handleStorefrontRunListRequest,
  handleStorefrontRunReadRequest,
  launchStoredStorefrontHomepageCurationRun,
} from "./storefront-homepage-curation-route"

const CURATOR_KEYS = ["curator-only-key"] as const
const AUTH = "Bearer curator-only-key"
const RUN_ID = "storefront-run-1"

const completedOutput = {
  ok: true,
  mode: "dry_run" as const,
  locale: "en",
  reason: "dry_run_complete" as const,
  homepageLocaleId: "locale-1",
  changed: true,
  candidateDiffers: true,
  draftStaged: false,
  writeOutcome: "no_write" as const,
  operationId: null,
  candidateDigest: "a".repeat(64),
  sectionKeys: ["storefront-curator-seasonal"],
  previewUrl: null,
  decision: null,
  notes: [],
}

describe("storefront homepage curation operator route", () => {
  it("fails closed when the dedicated bearer is missing or wrong", async () => {
    const launch = vi.fn()
    for (const authHeader of [undefined, "Bearer shared-service-key"]) {
      const outcome = await handleStorefrontHomepageCurationRouteRequest({
        authHeader,
        curatorServiceKeys: CURATOR_KEYS,
        readJson: async () => ({ locale: "en" }),
        launch,
      })

      expect(outcome).toEqual({
        status: 401,
        body: { error: "Storefront curator operator bearer required" },
      })
    }
    expect(launch).not.toHaveBeenCalled()
  })

  it("does not accept a shared pool key when the dedicated pool differs", async () => {
    const outcome = await handleStorefrontHomepageCurationRouteRequest({
      authHeader: "Bearer shared-pool-key",
      curatorServiceKeys: ["curator-key"],
      readJson: async () => ({ locale: "en" }),
      launch: vi.fn(),
    })

    expect(outcome.status).toBe(401)
  })

  it("rejects malformed JSON and unknown fields before creating a run", async () => {
    const launch = vi.fn()
    for (const readJson of [
      async () => {
        throw new Error("bad json")
      },
      async () => ({ locale: "en", publish: true }),
    ]) {
      const outcome = await handleStorefrontHomepageCurationRouteRequest({
        authHeader: AUTH,
        curatorServiceKeys: CURATOR_KEYS,
        readJson,
        launch,
      })
      expect(outcome.status).toBe(400)
      expect(outcome.body).toMatchObject({
        ok: false,
        reason: "invalid_input",
        retryable: false,
      })
    }
    expect(launch).not.toHaveBeenCalled()
  })

  it("returns validated structured workflow output", async () => {
    const launch = vi.fn().mockResolvedValue({
      runId: RUN_ID,
      result: { status: "success", result: completedOutput },
    })
    const outcome = await handleStorefrontHomepageCurationRouteRequest({
      authHeader: AUTH,
      curatorServiceKeys: CURATOR_KEYS,
      readJson: async () => ({ locale: "EN", dryRun: true }),
      launch,
    })

    expect(launch).toHaveBeenCalledWith({
      locale: "EN",
      dryRun: true,
    })
    expect(outcome).toEqual({
      status: 200,
      body: { runId: RUN_ID, ...completedOutput },
    })
  })

  it("returns a successful stage_outcome_unknown result without retrying the write", async () => {
    const output = {
      ...completedOutput,
      ok: false,
      mode: "stage" as const,
      reason: "stage_outcome_unknown" as const,
      writeOutcome: "stage_outcome_unknown" as const,
      operationId: "8d5d9d12-02cb-4a50-98c7-069d27d7278c",
      draftStaged: false,
      notes: ["Inspect Admin draft attribution before retrying."],
    }
    const launch = vi.fn().mockResolvedValue({
      runId: RUN_ID,
      result: { status: "success", result: output },
    })

    const outcome = await handleStorefrontHomepageCurationRouteRequest({
      authHeader: AUTH,
      curatorServiceKeys: CURATOR_KEYS,
      readJson: async () => ({ locale: "en" }),
      launch,
    })

    expect(outcome).toEqual({
      status: 200,
      body: { runId: RUN_ID, ...output },
    })
    expect(launch).toHaveBeenCalledTimes(1)
  })

  it("makes post-launch 5xx failures non-retryable to prevent stage replay", async () => {
    const cases = [
      {
        launch: vi.fn().mockRejectedValue(new Error("storage offline")),
        status: 503,
        reason: "workflow_unavailable",
      },
      {
        launch: vi.fn().mockResolvedValue({
          runId: RUN_ID,
          result: { status: "failed", error: new Error("agent failed") },
        }),
        status: 502,
        reason: "workflow_failed",
      },
      {
        launch: vi.fn().mockResolvedValue({
          runId: RUN_ID,
          result: { status: "success", result: { ok: true } },
        }),
        status: 502,
        reason: "invalid_workflow_output",
      },
    ]

    for (const testCase of cases) {
      const outcome = await handleStorefrontHomepageCurationRouteRequest({
        authHeader: AUTH,
        curatorServiceKeys: CURATOR_KEYS,
        readJson: async () => ({ locale: "en" }),
        launch: testCase.launch,
      })
      expect(outcome.status).toBe(testCase.status)
      expect(outcome.body).toMatchObject({
        ok: false,
        reason: testCase.reason,
        retryable: false,
      })
    }
  })

  it("creates and starts a stored workflow run through the Mastra seam", async () => {
    const start = vi.fn().mockResolvedValue({
      status: "success",
      result: completedOutput,
    })
    const createRun = vi.fn().mockResolvedValue({ start, runId: "run-1" })
    const result = await launchStoredStorefrontHomepageCurationRun({
      workflow: { createRun } as never,
      input: { locale: "en", dryRun: true },
    })

    expect(createRun).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith({
      inputData: { locale: "en", dryRun: true },
    })
    expect(result).toEqual({
      runId: "run-1",
      result: { status: "success", result: completedOutput },
    })
  })

  it("registers private start, bounded-list, and read routes", () => {
    const routes = createStorefrontHomepageCurationApiRoutes("curator-only-key")

    expect(routes.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /forge-storefront-curation",
      "GET /forge-storefront-curation/runs",
      "GET /forge-storefront-curation/runs/:runId",
    ])
  })

  it("wires every operator route to the dedicated production key pool", () => {
    const indexSource = readFileSync(
      new URL("../index.ts", import.meta.url),
      "utf8",
    )

    expect(indexSource).toContain(
      "const serviceKeys = parseServiceApiKeys(env.MASTRA_SERVICE_API_KEYS)",
    )
    expect(indexSource).toMatch(
      /createStorefrontHomepageCurationApiRoutes\(\s*env\.STOREFRONT_CURATOR_SERVICE_API_KEYS,?\s*\)/,
    )
    expect(indexSource).not.toMatch(
      /createStorefrontHomepageCurationApiRoutes\(\s*(?:env\.MASTRA_SERVICE_API_KEYS|serviceKeys),?\s*\)/,
    )
  })

  it("rejects a shared key before listing stored runs", async () => {
    const workflow = {
      listWorkflowRuns: vi.fn(),
      getWorkflowRunById: vi.fn(),
    }

    const outcome = await handleStorefrontRunListRequest({
      authHeader: "Bearer shared-service-key",
      curatorServiceKeys: CURATOR_KEYS,
      limit: "10",
      workflow: workflow as never,
    })

    expect(outcome.status).toBe(401)
    expect(workflow.listWorkflowRuns).not.toHaveBeenCalled()
    expect(workflow.getWorkflowRunById).not.toHaveBeenCalled()
  })

  it("lists bounded sanitized stored runs with validated outputs", async () => {
    const state = {
      runId: RUN_ID,
      status: "success",
      result: completedOutput,
      createdAt: new Date("2026-08-26T10:00:00.000Z"),
      updatedAt: new Date("2026-08-26T10:01:00.000Z"),
      payload: { accessToken: "must-not-leak" },
      steps: { secret: "must-not-leak" },
      error: { message: "must-not-leak" },
    }
    const workflow = {
      listWorkflowRuns: vi.fn().mockResolvedValue({
        runs: [{ runId: RUN_ID }],
        total: 1,
      }),
      getWorkflowRunById: vi.fn().mockResolvedValue(state),
    }
    const outcome = await handleStorefrontRunListRequest({
      authHeader: AUTH,
      curatorServiceKeys: CURATOR_KEYS,
      limit: "25",
      workflow: workflow as never,
    })

    expect(workflow.listWorkflowRuns).toHaveBeenCalledWith({
      perPage: 25,
      page: 0,
    })
    expect(workflow.getWorkflowRunById).toHaveBeenCalledWith(RUN_ID, {
      fields: ["result"],
    })
    expect(outcome).toEqual({
      status: 200,
      body: {
        runs: [
          {
            runId: RUN_ID,
            status: "success",
            createdAt: "2026-08-26T10:00:00.000Z",
            updatedAt: "2026-08-26T10:01:00.000Z",
            output: completedOutput,
          },
        ],
        total: 1,
        limit: 25,
      },
    })
    expect(JSON.stringify(outcome)).not.toContain("must-not-leak")
  })

  it("reads one sanitized run and fails closed for unauthorized inspection", async () => {
    const workflow = {
      getWorkflowRunById: vi.fn().mockResolvedValue({
        runId: RUN_ID,
        status: "failed",
        result: { malformed: true },
        createdAt: new Date("2026-08-26T10:00:00.000Z"),
        updatedAt: new Date("2026-08-26T10:01:00.000Z"),
      }),
    }
    const unauthorized = await handleStorefrontRunReadRequest({
      authHeader: "Bearer shared-key",
      curatorServiceKeys: CURATOR_KEYS,
      runId: RUN_ID,
      workflow: workflow as never,
    })
    expect(unauthorized.status).toBe(401)
    expect(workflow.getWorkflowRunById).not.toHaveBeenCalled()

    const outcome = await handleStorefrontRunReadRequest({
      authHeader: AUTH,
      curatorServiceKeys: CURATOR_KEYS,
      runId: RUN_ID,
      workflow: workflow as never,
    })
    expect(outcome).toEqual({
      status: 200,
      body: {
        runId: RUN_ID,
        status: "failed",
        createdAt: "2026-08-26T10:00:00.000Z",
        updatedAt: "2026-08-26T10:01:00.000Z",
        output: null,
      },
    })
  })

  it("rejects unbounded lists and unsafe run IDs before storage access", async () => {
    const workflow = {
      listWorkflowRuns: vi.fn(),
      getWorkflowRunById: vi.fn(),
    }
    const list = await handleStorefrontRunListRequest({
      authHeader: AUTH,
      curatorServiceKeys: CURATOR_KEYS,
      limit: "26",
      workflow: workflow as never,
    })
    const read = await handleStorefrontRunReadRequest({
      authHeader: AUTH,
      curatorServiceKeys: CURATOR_KEYS,
      runId: "../other-workflow",
      workflow: workflow as never,
    })

    expect(list.status).toBe(400)
    expect(read.status).toBe(400)
    expect(workflow.listWorkflowRuns).not.toHaveBeenCalled()
    expect(workflow.getWorkflowRunById).not.toHaveBeenCalled()
  })
})
