import { describe, expect, it, vi } from "vitest"

import {
  handleSubtitleTranslationEvalRouteRequest,
  launchSubtitleTranslationEvalWorkflow,
  readBoundedSubtitleTranslationEvalJson,
  runSubtitleTranslationEvalWorkflow,
  subtitleEvalExecutionRunId,
} from "./subtitle-translation-eval"

describe("subtitle translation eval workflow route", () => {
  it("checks the shared service bearer before reading a potentially large body", async () => {
    const readJson = vi.fn(async () => ({ cellId: "cell-1" }))

    const result = await handleSubtitleTranslationEvalRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: ["secret"],
      readJson,
    })

    expect(result).toEqual({
      status: 401,
      body: { error: "Service bearer required" },
    })
    expect(readJson).not.toHaveBeenCalled()
  })

  it("returns the strict cell envelope from an authorized route", async () => {
    const launch = vi.fn(async () => ({
      ok: false as const,
      cellId: "cell-1",
      reason: "identity_mismatch" as const,
      failureClass: "deterministic" as const,
      retryable: false,
      message: "Frozen subtitle identity did not match the packaged corpus.",
      providerCalls: [],
    }))

    const result = await handleSubtitleTranslationEvalRouteRequest({
      authHeader: "Bearer secret",
      serviceKeys: ["secret"],
      readJson: async () => ({ cellId: "cell-1" }),
      launch,
    })

    expect(launch).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      status: 400,
      body: {
        result: {
          ok: false,
          cellId: "cell-1",
          reason: "identity_mismatch",
          failureClass: "deterministic",
          retryable: false,
          message:
            "Frozen subtitle identity did not match the packaged corpus.",
          providerCalls: [],
        },
      },
    })
  })

  it("classifies malformed JSON without launching", async () => {
    const launch = vi.fn()
    const result = await handleSubtitleTranslationEvalRouteRequest({
      authHeader: "Bearer secret",
      serviceKeys: ["secret"],
      readJson: async () => {
        throw new Error("bad json")
      },
      launch,
    })

    expect(result).toMatchObject({
      status: 400,
      body: {
        result: {
          ok: false,
          reason: "invalid_input",
          failureClass: "deterministic",
          retryable: false,
        },
      },
    })
    expect(launch).not.toHaveBeenCalled()
  })

  it("rejects an oversized route body through the fixed failure vocabulary", async () => {
    const launch = vi.fn()
    const result = await handleSubtitleTranslationEvalRouteRequest({
      authHeader: "Bearer secret",
      serviceKeys: ["secret"],
      readJson: () =>
        readBoundedSubtitleTranslationEvalJson(
          new Request("https://mastra.test/forge-subtitle-translation-eval", {
            method: "POST",
            body: '{"ok":true}',
          }),
          10,
        ),
      launch,
    })

    expect(result).toMatchObject({
      status: 400,
      body: {
        result: {
          ok: false,
          reason: "payload_too_large",
          failureClass: "deterministic",
          retryable: false,
        },
      },
    })
    expect(launch).not.toHaveBeenCalled()
  })

  it("delegates workflow execution through the bounded cloud seam", async () => {
    const execute = vi.fn(async () => ({
      ok: false as const,
      cellId: "cell-1",
      reason: "provider_failed" as const,
      failureClass: "retryable" as const,
      retryable: true,
      message: "Subtitle provider execution failed.",
      providerCalls: [],
    }))

    const result = await runSubtitleTranslationEvalWorkflow(
      { cellId: "cell-1" },
      { execute },
    )

    expect(execute).toHaveBeenCalledWith({ cellId: "cell-1" }, undefined)
    expect(result).toMatchObject({
      ok: false,
      reason: "provider_failed",
      retryable: true,
    })
  })

  it("maps a rejected route launch to the strict execution failure envelope", async () => {
    const result = await handleSubtitleTranslationEvalRouteRequest({
      authHeader: "Bearer secret",
      serviceKeys: ["secret"],
      readJson: async () => ({ cellId: "cell-1" }),
      launch: async () => {
        throw new Error("private launch failure")
      },
    })

    expect(result).toEqual({
      status: 502,
      body: {
        result: {
          ok: false,
          cellId: "cell-1",
          reason: "execution_failed",
          failureClass: "retryable",
          retryable: true,
          message: "Subtitle evaluation workflow execution failed.",
          providerCalls: [],
        },
      },
    })
  })

  it("maps createRun failures to the strict execution failure envelope", async () => {
    const result = await launchSubtitleTranslationEvalWorkflow(
      schemaValidRequest(),
      {
        createRun: async () => {
          throw new Error("private createRun failure")
        },
      },
    )

    expect(result).toMatchObject({
      ok: false,
      cellId: "cell-1",
      reason: "execution_failed",
      failureClass: "retryable",
      retryable: true,
    })
    expect(JSON.stringify(result)).not.toContain("private createRun")
  })

  it("replays a completed execution after the first response is lost", async () => {
    const request = schemaValidRequest()
    const result = workflowFailure()
    let stored: {
      status: "success"
      result: typeof result
    } | null = null
    const createRun = vi.fn(async () => ({
      start: vi.fn(async () => {
        stored = { status: "success", result }
        return { status: "success" as const, result }
      }),
    }))
    const options = {
      createRun: createRun as never,
      getRun: vi.fn(async () => stored) as never,
      withExecutionLock: passThroughExecutionLock,
    }

    await expect(
      launchSubtitleTranslationEvalWorkflow(request, options),
    ).resolves.toEqual(result)
    await expect(
      launchSubtitleTranslationEvalWorkflow(request, options),
    ).resolves.toEqual(result)

    expect(createRun).toHaveBeenCalledOnce()
    expect(createRun).toHaveBeenCalledWith({
      runId: subtitleEvalExecutionRunId(request),
    })
  })

  it("coalesces concurrent requests for the same frozen cell", async () => {
    const request = schemaValidRequest()
    const result = workflowFailure()
    let complete: ((value: unknown) => void) | undefined
    const started = new Promise((resolve) => {
      complete = resolve
    })
    const createRun = vi.fn(async () => ({
      start: vi.fn(async () => {
        await started
        return { status: "success" as const, result }
      }),
    }))
    const options = {
      createRun: createRun as never,
      getRun: vi.fn(async () => null) as never,
      withExecutionLock: passThroughExecutionLock,
    }

    const first = launchSubtitleTranslationEvalWorkflow(request, options)
    const second = launchSubtitleTranslationEvalWorkflow(request, options)
    complete?.(undefined)

    await expect(Promise.all([first, second])).resolves.toEqual([
      result,
      result,
    ])
    expect(createRun).toHaveBeenCalledOnce()
  })

  it("uses a fresh execution key only for an authorized provider retry", () => {
    const request = schemaValidRequest()
    expect(
      subtitleEvalExecutionRunId({ ...request, executionAttempt: 2 }),
    ).not.toBe(subtitleEvalExecutionRunId(request))
  })

  it("does not restart a durable execution awaiting reconciliation", async () => {
    const createRun = vi.fn()
    await expect(
      launchSubtitleTranslationEvalWorkflow(schemaValidRequest(), {
        createRun: createRun as never,
        getRun: vi.fn(async () => ({ status: "running" })) as never,
        withExecutionLock: passThroughExecutionLock,
      }),
    ).resolves.toMatchObject({
      ok: false,
      cellId: "cell-1",
      reason: "execution_in_progress",
      retryable: true,
      providerCalls: [],
    })
    expect(createRun).not.toHaveBeenCalled()
  })
})

const passThroughExecutionLock = async <T>(
  _executionKey: string,
  execute: () => Promise<T>,
) => execute()

function workflowFailure() {
  return {
    ok: false as const,
    cellId: "cell-1",
    reason: "provider_failed" as const,
    failureClass: "retryable" as const,
    retryable: true,
    message: "Subtitle provider execution failed.",
    providerCalls: [],
  }
}

function schemaValidRequest() {
  const digest = "a".repeat(64)
  const track = (role: "source" | "reference", language: string) => ({
    body: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nText.\n",
    sha256: digest,
    rawSha256: digest,
    clippedSha256: digest,
    byteLength: 50,
    mediaType: "text/vtt" as const,
    track: {
      role,
      language,
      coreLanguageId: "core-language",
      subtitleId: `${role}-subtitle`,
      videoId: "video",
      edition: "base",
      coreVideoEditionId: "edition",
      cueCount: 1,
    },
  })
  return {
    schemaVersion: "subtitle-translation-eval-cell-request/v1" as const,
    cellId: "cell-1",
    caseId: "sample",
    manifestDigest: digest,
    lockDigest: digest,
    targetLanguage: "es",
    provider: "openrouter",
    model: "fixture/model",
    promptPolicyId: "subtitle-enrichment-production-v1",
    workflowPolicyDigest: digest,
    codeRevision: "local-development",
    executionAttempt: 1,
    timeoutMs: 60_000,
    concurrency: 1 as const,
    source: track("source", "en"),
    reference: track("reference", "es"),
  }
}
