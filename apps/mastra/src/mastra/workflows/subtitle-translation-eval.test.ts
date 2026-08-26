import { describe, expect, it, vi } from "vitest"

import {
  handleSubtitleTranslationEvalRouteRequest,
  launchSubtitleTranslationEvalWorkflow,
  readBoundedSubtitleTranslationEvalJson,
  runSubtitleTranslationEvalWorkflow,
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
})

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
    timeoutMs: 60_000,
    concurrency: 1 as const,
    source: track("source", "en"),
    reference: track("reference", "es"),
  }
}
