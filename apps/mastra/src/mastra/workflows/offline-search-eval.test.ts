import { describe, expect, it, vi } from "vitest"

import {
  _internal,
  handleOfflineSearchEvalRouteRequest,
  offlineSearchEvalWorkflow,
  runOfflineSearchEvalWorkflow,
} from "./offline-search-eval"
import { SEARCH_EVAL_SEED_PROMPT_LOCALES } from "../../services/offline-search-eval/seed-prompt-set"

const DEFAULT_SEED_LOCALES = [...SEARCH_EVAL_SEED_PROMPT_LOCALES]

describe("offline search eval workflow route", () => {
  it("defaults Studio/API inputs to a runnable all-locale baseline capture", () => {
    expect(_internal.OfflineSearchEvalInputSchema.parse({})).toEqual({
      mode: "capture-baseline",
      baselineName: "seed-baseline",
      locales: DEFAULT_SEED_LOCALES,
      searchLimit: 20,
      searchMode: "hybrid",
      contentType: "all",
    })
  })

  it("maps Studio form defaults to Admin's both-content search contract", () => {
    expect(
      _internal.workflowInputForRunner(
        _internal.OfflineSearchEvalInputSchema.parse({}),
      ),
    ).toEqual({
      mode: "capture-baseline",
      baselineName: "seed-baseline",
      locales: DEFAULT_SEED_LOCALES,
      searchLimit: 20,
      searchMode: "hybrid",
    })

    expect(
      _internal.workflowInputForRunner(
        _internal.OfflineSearchEvalInputSchema.parse({
          contentType: "experience",
        }),
      ).contentType,
    ).toBe("experience")
  })

  it("accepts semantic-only as an internal diagnostic search mode", () => {
    expect(
      _internal.OfflineSearchEvalInputSchema.parse({
        searchMode: "semantic-only",
      }).searchMode,
    ).toBe("semantic-only")
    expect(
      _internal.OfflineSearchEvalInputSchema.safeParse({
        searchMode: "algolia-backed",
      }).success,
    ).toBe(false)
  })

  it("exposes the structured input schema to Studio workflow metadata", () => {
    expect(offlineSearchEvalWorkflow.inputSchema).toBe(
      _internal.OfflineSearchEvalInputSchema,
    )
    expect(
      (
        offlineSearchEvalWorkflow.steps["run-offline-search-eval"] as {
          inputSchema?: unknown
        }
      ).inputSchema,
    ).toBe(_internal.OfflineSearchEvalInputSchema)
    expect(
      _internal.OfflineSearchEvalInputSchema.safeParse("bad").success,
    ).toBe(false)
    expect(
      _internal.OfflineSearchEvalInputSchema.safeParse({
        includeGeneratedCandidates: true,
      }).success,
    ).toBe(false)
  })

  it("requires service bearer before launching", async () => {
    const launch = vi.fn()
    const response = await handleOfflineSearchEvalRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: ["service-key"],
      readJson: async () => ({ mode: "capture-baseline" }),
      launch,
    })

    expect(response).toEqual({
      status: 401,
      body: { error: "Service bearer required" },
    })
    expect(launch).not.toHaveBeenCalled()
  })

  it("launches with parsed input for a valid service bearer", async () => {
    const launch = vi.fn(async () => ({
      ok: true as const,
      mode: "capture-baseline" as const,
      mastraRunId: "run-1",
      baselineName: "default",
      baselinePath: "/tmp/baseline.json",
      reportPath: "/tmp/report.json",
      report: {} as never,
    }))

    const response = await handleOfflineSearchEvalRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({
        mode: "capture-baseline",
        baselineName: "default",
      }),
      launch,
    })

    expect(response.status).toBe(200)
    expect(response.body.result).toMatchObject({ ok: true })
    expect(launch).toHaveBeenCalledWith(
      {
        mode: "capture-baseline",
        baselineName: "default",
        locales: DEFAULT_SEED_LOCALES,
        searchLimit: 20,
        searchMode: "hybrid",
        contentType: "all",
      },
      { runId: expect.any(String) },
    )
  })

  it("lets operators run the default all-locale baseline without hand-written params", async () => {
    const launch = vi.fn(async () => ({
      ok: true as const,
      mode: "capture-baseline" as const,
      mastraRunId: "run-1",
      baselineName: "seed-baseline",
      baselinePath: "/tmp/baseline.json",
      reportPath: "/tmp/report.json",
      report: {} as never,
    }))

    const response = await handleOfflineSearchEvalRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({}),
      launch,
    })

    expect(response.status).toBe(200)
    expect(response.body.result).toMatchObject({ ok: true })
    expect(launch).toHaveBeenCalledWith(
      {
        mode: "capture-baseline",
        baselineName: "seed-baseline",
        locales: DEFAULT_SEED_LOCALES,
        searchLimit: 20,
        searchMode: "hybrid",
        contentType: "all",
      },
      { runId: expect.any(String) },
    )
  })

  it("returns invalid_input when request JSON does not match workflow input", async () => {
    const response = await handleOfflineSearchEvalRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({ mode: "bad" }),
    })

    expect(response.status).toBe(400)
    expect(response.body.result).toMatchObject({
      ok: false,
      reason: "invalid_input",
    })
  })

  it("rejects unsafe baseline artifact names at the route boundary", async () => {
    const launch = vi.fn()
    const response = await handleOfflineSearchEvalRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({
        mode: "capture-baseline",
        baselineName: "../default",
      }),
      launch,
    })

    expect(response.status).toBe(400)
    expect(response.body.result).toMatchObject({
      ok: false,
      reason: "invalid_input",
    })
    expect(launch).not.toHaveBeenCalled()
  })

  it("rejects oversized route bodies before launching", async () => {
    const launch = vi.fn()
    const response = await handleOfflineSearchEvalRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      request: new Request("https://mastra.test/forge-offline-search-eval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        duplex: "half",
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(4097))
            controller.close()
          },
        }),
      } as RequestInit & { duplex: "half" }),
      launch,
    })

    expect(response).toEqual({
      status: 413,
      body: {
        result: { ok: false, reason: "invalid_input", retryable: false },
      },
    })
    expect(launch).not.toHaveBeenCalled()
  })

  it.each([
    ["admin_config_missing", 503],
    ["judge_config_missing", 503],
    ["admin_auth_failed", 502],
    ["admin_read_rejected", 409],
    ["artifact_not_found", 404],
    ["artifact_invalid", 502],
    ["artifact_read_failed", 503],
    ["artifact_write_failed", 503],
    ["judge_failed", 502],
  ] as const)("maps %s to HTTP %i", async (reason, status) => {
    const response = await handleOfflineSearchEvalRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({ mode: "compare", baselineName: "default" }),
      launch: vi.fn(async () => ({
        ok: false as const,
        reason,
        retryable: reason !== "admin_auth_failed",
      })),
    })

    expect(response.status).toBe(status)
    expect(response.body.result).toMatchObject({ ok: false, reason })
  })

  it("maps workflow launch rejections to a typed retryable failure", async () => {
    const response = await handleOfflineSearchEvalRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({ mode: "capture-baseline" }),
      launch: vi.fn(async () => {
        throw new Error("workflow storage down")
      }),
    })

    expect(response.status).toBe(502)
    expect(response.body.result).toEqual({
      ok: false,
      reason: "admin_read_failed",
      retryable: true,
    })
  })

  it("validates direct workflow input", async () => {
    await expect(
      runOfflineSearchEvalWorkflow({ mode: "bad" }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "invalid_input",
    })
  })

  it("rejects committed Mastra runs at the structured input boundary", async () => {
    const run = await offlineSearchEvalWorkflow.createRun({
      runId: "run-invalid-offline-search-eval-input",
    })

    await expect(
      run.start({ inputData: { mode: "bad" } as never }),
    ).rejects.toThrow(/Invalid input data/)
  })
})

describe("Mastra offline search eval import boundary", () => {
  it("does not import Admin, Manager, or Auth app code", async () => {
    const { readFile } = await import("node:fs/promises")
    const { fileURLToPath } = await import("node:url")
    const files = [
      new URL("./offline-search-eval.ts", import.meta.url),
      new URL("../../services/offline-search-eval/runner.ts", import.meta.url),
      new URL("../../services/admin-search-eval-client.ts", import.meta.url),
    ]
    const source = (
      await Promise.all(
        files.map((file) => readFile(fileURLToPath(file), "utf8")),
      )
    ).join("\n")

    expect(source).not.toMatch(/from ["'](?:apps\/)?(?:admin|manager|auth)\b/)
    expect(source).not.toMatch(/from ["']@forge\/(?:admin|manager|auth)\b/)
  })
})
