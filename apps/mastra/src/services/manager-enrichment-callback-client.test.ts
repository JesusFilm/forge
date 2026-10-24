import steps from "../../../../docs/fixtures/manager-enrichment-steps.json"
import { FORGE_WORKFLOW_STEPS } from "./manager-enrichment-callback-client"
import { describe, expect, it, vi } from "vitest"

import callbackFixtures from "../../../../docs/fixtures/manager-enrichment-callbacks.json"
import {
  ManagerEnrichmentCallbackSchema,
  isManagerEnrichmentCallbackConfigured,
  postManagerEnrichmentCallback,
  sendManagerEnrichmentCallback,
} from "./manager-enrichment-callback-client"

const validCallback = {
  jobId: "job-1",
  engine: "mastra",
  runId: "run-1",
  sequence: 1,
  status: "running",
  step: "transcription",
} as const

describe("manager enrichment callback schema", () => {
  it("accepts Manager's strict callback shape", () => {
    expect(
      ManagerEnrichmentCallbackSchema.safeParse(validCallback).success,
    ).toBe(true)
  })

  it.each(Object.entries(callbackFixtures))(
    "accepts shared Manager fixture %s",
    (_name, callback) => {
      expect(ManagerEnrichmentCallbackSchema.safeParse(callback).success).toBe(
        true,
      )
    },
  )

  it("rejects pending and scene_analysis callback transitions", () => {
    expect(
      ManagerEnrichmentCallbackSchema.safeParse({
        ...validCallback,
        status: "pending",
      }).success,
    ).toBe(false)

    expect(
      ManagerEnrichmentCallbackSchema.safeParse({
        ...validCallback,
        step: "scene_analysis",
      }).success,
    ).toBe(false)
  })
})

describe("postManagerEnrichmentCallback", () => {
  it("reports config_missing when callback credentials are absent", async () => {
    await expect(
      postManagerEnrichmentCallback(validCallback, {
        callbackUrl: "",
        bearer: "",
      }),
    ).resolves.toEqual({ ok: false, reason: "config_missing" })
  })

  it("validates callback payloads locally before posting", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch

    await expect(
      postManagerEnrichmentCallback(
        {
          ...validCallback,
          step: "scene_analysis",
        },
        {
          callbackUrl:
            "https://manager.internal/api/internal/enrichment-callback",
          bearer: "secret",
          fetchImpl,
        },
      ),
    ).resolves.toMatchObject({ ok: false, reason: "invalid_payload" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("posts the callback to Manager with a bearer token", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true, action: "applied" }, { status: 200 }),
    )
    const fetchImpl = fetchMock as unknown as typeof fetch

    await expect(
      postManagerEnrichmentCallback(validCallback, {
        callbackUrl:
          "https://manager.internal/api/internal/enrichment-callback",
        bearer: "secret",
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: true, status: 200 })

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://manager.internal/api/internal/enrichment-callback",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer secret",
          "content-type": "application/json",
        }),
        body: expect.any(String),
      }),
    )
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(JSON.parse(String(requestInit.body))).toEqual(validCallback)
  })

  it("maps Manager auth failures", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "nope" }, { status: 401 }),
    ) as unknown as typeof fetch

    await expect(
      postManagerEnrichmentCallback(validCallback, {
        callbackUrl:
          "https://manager.internal/api/internal/enrichment-callback",
        bearer: "bad-secret",
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: false, reason: "auth_failed", status: 401 })
  })

  it("throws a typed error when callback delivery is rejected", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "retry later" }, { status: 503 }),
    ) as unknown as typeof fetch

    await expect(
      sendManagerEnrichmentCallback(validCallback, {
        callbackUrl:
          "https://manager.internal/api/internal/enrichment-callback",
        bearer: "secret",
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      result: { ok: false, reason: "rejected", status: 503 },
    })
  })
})

describe("isManagerEnrichmentCallbackConfigured", () => {
  it("requires both the callback URL and callback bearer", () => {
    expect(
      isManagerEnrichmentCallbackConfigured({
        MANAGER_ENRICHMENT_CALLBACK_URL:
          "https://manager.internal/api/internal/enrichment-callback",
        MANAGER_ENRICHMENT_CALLBACK_API_KEY: "secret",
      }),
    ).toBe(true)

    expect(
      isManagerEnrichmentCallbackConfigured({
        MANAGER_ENRICHMENT_CALLBACK_URL:
          "https://manager.internal/api/internal/enrichment-callback",
      }),
    ).toBe(false)
  })
})

// Shared data fixtures keep app-local schemas aligned without app imports.
describe("complete callback inventory", () => {
  it("matches every current Manager enrichment step", () => {
    expect(FORGE_WORKFLOW_STEPS).toEqual(steps)
  })
  it.each(steps)(
    "validates all callback statuses and strict fields for %s",
    (step) => {
      const base = {
        jobId: "dummy-job",
        engine: "mastra",
        runId: "dummy-run",
        sequence: 1,
        step,
      }
      for (const status of ["running", "completed", "failed", "skipped"]) {
        const callback = {
          ...base,
          status,
          ...(status === "failed" ? { error: "dummy failure" } : {}),
        }
        expect(
          ManagerEnrichmentCallbackSchema.safeParse(callback).success,
        ).toBe(true)
        expect(
          ManagerEnrichmentCallbackSchema.safeParse({
            ...callback,
            unexpected: true,
          }).success,
        ).toBe(false)
      }
      for (const invalid of [
        { ...base, status: "pending" },
        { ...base, status: "failed" },
        { ...base, status: "running", artifactsDelta: ["transcript"] },
        {
          ...base,
          status: "completed",
          artifactsDelta: [{ kind: "downloadable" }],
        },
        { ...base, status: "completed", artifactsDelta: ["x".repeat(129)] },
        {
          ...base,
          status: "completed",
          artifactsDelta: Array(101).fill("transcript"),
        },
        {
          ...base,
          status: "completed",
          languageResults: [{ lang: "fr", status: "running" }],
        },
        { ...base, status: "completed", sequence: -1 },
      ])
        expect(ManagerEnrichmentCallbackSchema.safeParse(invalid).success).toBe(
          false,
        )
    },
  )
})

it("sends structured transcript progress through a dummy transport", async () => {
  const fetchImpl = vi.fn<typeof fetch>(
    async () => new Response("{}", { status: 200 }),
  )
  await expect(
    postManagerEnrichmentCallback(
      { ...validCallback, step: "structured_transcript" },
      {
        callbackUrl: "https://manager.test/callback",
        bearer: "dummy-key",
        fetchImpl,
      },
    ),
  ).resolves.toEqual({ ok: true, status: 200 })
  expect(fetchImpl).toHaveBeenCalledOnce()
  expect(
    JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string),
  ).toMatchObject({ step: "structured_transcript" })
})
