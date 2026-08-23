/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest"

const testEnv = vi.hoisted(() => ({
  WEB_FEEDBACK_LINEAR_API_KEY: "linear-secret",
  WEB_FEEDBACK_LINEAR_TEAM_ID: "team-1",
  WEB_FEEDBACK_LINEAR_PROJECT_ID: "project-1",
  WEB_FEEDBACK_LINEAR_LABEL_ID: "label-1",
}))

vi.mock("@/env", () => ({ env: testEnv }))

import { createLinearFeedbackIssue } from "./feedback-linear"

const submission = {
  category: "problem" as const,
  message: "Playback failed when I pressed the Watch button.",
  name: "Alex @team",
  email: "alex@example.com",
  page: {
    title: "The Life of Jesus",
    url: "https://www.jesusfilm.org/watch/jesus.html",
    locale: "en",
  },
  languageIssue: {
    area: "subtitles" as const,
    language: "Spanish",
  },
  content: {
    scope: "other" as const,
    title: "Jesus Film Collection",
    id: "collection-1",
    slug: "jesus-film-collection",
    label: "COLLECTION",
  },
  selectedElement: {
    label: "Watch now",
    role: "button",
    path: "main:nth-of-type(1) > button:nth-of-type(1)",
  },
  diagnostics: {
    browser: "Chrome 140",
    operatingSystem: "macOS",
    device: "Desktop",
    viewport: "1440 × 1024 @ 2x",
    timeZone: "America/Halifax",
    appVersion: "release-1",
  },
}

describe("createLinearFeedbackIssue", () => {
  beforeEach(() => {
    testEnv.WEB_FEEDBACK_LINEAR_API_KEY = "linear-secret"
    testEnv.WEB_FEEDBACK_LINEAR_TEAM_ID = "team-1"
    testEnv.WEB_FEEDBACK_LINEAR_PROJECT_ID = "project-1"
    testEnv.WEB_FEEDBACK_LINEAR_LABEL_ID = "label-1"
  })

  it("creates a sanitized issue without allowing public Linear priority", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { issueCreate: { success: true, issue: { id: "issue-1" } } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    await expect(
      createLinearFeedbackIssue(submission, fetchMock),
    ).resolves.toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.linear.app/graphql")
    expect(init?.headers).toMatchObject({ authorization: "linear-secret" })
    const body = JSON.parse(String(init?.body)) as {
      variables: { input: Record<string, unknown> }
    }
    expect(body.variables.input).toMatchObject({
      teamId: "team-1",
      projectId: "project-1",
      labelIds: ["label-1"],
    })
    expect(body.variables.input).not.toHaveProperty("priority")
    expect(body.variables.input.title).toContain("[Watch feedback] Problem")
    expect(body.variables.input.description).toContain("Watch now")
    expect(body.variables.input.description).toContain("Chrome 140")
    expect(body.variables.input.description).toContain("Spanish")
    expect(body.variables.input.description).toContain("Jesus Film Collection")
    expect(body.variables.input.description).toContain("collection\\-1")
    expect(body.variables.input.description).toContain("COLLECTION")
    expect(body.variables.input.description).toContain("@​team")
  })

  it("fails closed when the server-only integration is not configured", async () => {
    testEnv.WEB_FEEDBACK_LINEAR_API_KEY = ""
    const fetchMock = vi.fn<typeof fetch>()

    await expect(
      createLinearFeedbackIssue(submission, fetchMock),
    ).resolves.toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("classifies an over-sized or malformed Linear response without leaking it", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not-json", { status: 200 }))

    await expect(
      createLinearFeedbackIssue(submission, fetchMock),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid_response",
      retryable: false,
    })
  })

  it.each([
    [new DOMException("timed out", "TimeoutError"), "timeout"],
    [new DOMException("aborted", "AbortError"), "timeout"],
    [new TypeError("network unavailable"), "network_error"],
  ])("classifies transport failures", async (error, reason) => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(error)

    await expect(
      createLinearFeedbackIssue(submission, fetchMock),
    ).resolves.toEqual({ ok: false, reason, retryable: true })
  })

  it.each([
    [429, "rate_limited", true],
    [400, "rejected", false],
    [503, "rejected", true],
  ])("classifies an HTTP %s response", async (status, reason, retryable) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("rejected", { status }))

    await expect(
      createLinearFeedbackIssue(submission, fetchMock),
    ).resolves.toEqual({ ok: false, reason, retryable })
  })

  it.each([
    { errors: [{ message: "denied" }] },
    {
      data: { issueCreate: { success: false, issue: null } },
    },
  ])("rejects unsuccessful GraphQL responses", async (body) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))

    await expect(
      createLinearFeedbackIssue(submission, fetchMock),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid_response",
      retryable: false,
    })
  })

  it("classifies a response stream failure without rejecting", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new Error("stream failed"))
      },
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(stream, { status: 200 }))

    await expect(
      createLinearFeedbackIssue(submission, fetchMock),
    ).resolves.toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
    })
  })
})
