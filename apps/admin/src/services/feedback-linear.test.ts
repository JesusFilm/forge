import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { MobileFeedbackSubmission } from "@/services/feedback-linear"

vi.mock("@/config/env", () => ({
  env: {} as Record<string, string | undefined>,
}))

const { env } = await import("@/config/env")
const {
  buildFeedbackIssueDescription,
  buildFeedbackIssueTitle,
  createLinearFeedbackIssue,
} = await import("@/services/feedback-linear")

const envMutable = env as unknown as Record<string, string | undefined>

/** Format class, \p{Cf}. */
const ZERO_WIDTH_JOINER = "\u200d"

const SUBMISSION_ID = "0b1c2d3e-4f56-4789-8abc-def012345678"
const ESCAPED_SUBMISSION_ID = SUBMISSION_ID.replaceAll("-", "\\-")

const fullSubmission: MobileFeedbackSubmission = {
  submissionId: SUBMISSION_ID,
  kind: "BROKEN",
  message: "The player stalls at 2 minutes\nevery time I open it",
  name: "Ada Lovelace",
  email: "ada@example.com",
  platform: "IOS",
  video: {
    title: "JESUS",
    positionSeconds: 4324,
    slug: "jesus",
    languageSlug: "english",
  },
  deviceDetails: {
    appVersion: "1.0.0",
    appBuild: "7",
    osVersion: "18.2",
    deviceModel: "iPhone15,2",
  },
}

const minimalSubmission: MobileFeedbackSubmission = {
  submissionId: SUBMISSION_ID,
  kind: "OTHER",
  message: "Everything works great",
  platform: "ANDROID",
}

function successResponse(issueId = "issue-1"): Response {
  return new Response(
    JSON.stringify({
      data: { issueCreate: { success: true, issue: { id: issueId } } },
    }),
    { status: 200 },
  )
}

beforeEach(() => {
  envMutable.ADMIN_FEEDBACK_LINEAR_API_KEY = "lin_api_test"
  envMutable.ADMIN_FEEDBACK_LINEAR_TEAM_ID = "team-1"
  envMutable.ADMIN_FEEDBACK_LINEAR_PROJECT_ID = "project-1"
  envMutable.ADMIN_FEEDBACK_LINEAR_LABEL_ID = "label-1"
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  envMutable.ADMIN_FEEDBACK_LINEAR_API_KEY = undefined
  envMutable.ADMIN_FEEDBACK_LINEAR_TEAM_ID = undefined
  envMutable.ADMIN_FEEDBACK_LINEAR_PROJECT_ID = undefined
  envMutable.ADMIN_FEEDBACK_LINEAR_LABEL_ID = undefined
  vi.restoreAllMocks()
})

describe("buildFeedbackIssueTitle", () => {
  it("names the kind and the first line of the message", () => {
    expect(buildFeedbackIssueTitle(fullSubmission)).toBe(
      "[Mobile feedback] Problem: The player stalls at 2 minutes",
    )
  })

  it("uses the Idea short name for an idea (AE9)", () => {
    expect(
      buildFeedbackIssueTitle({
        ...minimalSubmission,
        kind: "IDEA",
        message: "Let me download audio only\nfor long drives",
      }),
    ).toBe("[Mobile feedback] Idea: Let me download audio only")
  })

  it("falls back to Feedback when the first line carries nothing visible", () => {
    expect(
      buildFeedbackIssueTitle({
        ...minimalSubmission,
        message: `  ${ZERO_WIDTH_JOINER}  `,
      }),
    ).toBe("[Mobile feedback] Other: Feedback")
  })

  it("truncates to 120 characters without splitting a surrogate pair", () => {
    // The prefix is 27 units and the message adds 92, so unit 120 lands
    // inside the surrogate pair.
    const title = buildFeedbackIssueTitle({
      ...minimalSubmission,
      kind: "BROKEN",
      message: `${"a".repeat(92)}\u{1f600}tail`,
    })
    expect(title).toBe(`[Mobile feedback] Problem: ${"a".repeat(92)}`)
    expect(title.length).toBe(119)
  })

  it("removes structural characters from the title", () => {
    expect(
      buildFeedbackIssueTitle({
        ...minimalSubmission,
        message: "[link](x) @team <b>broken</b>",
      }),
    ).toBe("[Mobile feedback] Other: link (x) team b broken /b")
  })
})

describe("buildFeedbackIssueDescription", () => {
  it("lists every context line in order for a full submission", () => {
    expect(buildFeedbackIssueDescription(fullSubmission)).toBe(
      [
        "## Feedback",
        "",
        "The player stalls at 2 minutes\nevery time I open it",
        "",
        "## Context",
        "",
        "- **Kind:** Something's broken",
        "- **Name:** Ada Lovelace",
        "- **Email:** ada\\@example\\.com",
        "- **Video:** JESUS",
        "- **Position:** 1:12:04",
        "- **Video slug:** jesus",
        "- **Dub language:** english",
        "- **Platform:** iOS",
        "- **App version:** 1\\.0\\.0",
        "- **App build:** 7",
        "- **OS version:** 18\\.2",
        "- **Device model:** iPhone15,2",
        `- **Submission id:** ${ESCAPED_SUBMISSION_ID}`,
        "",
        "---",
        "Submitted from the Jesus Film mobile app.",
      ].join("\n"),
    )
  })

  it("quotes both lines of the message verbatim (AE9)", () => {
    expect(
      buildFeedbackIssueDescription({
        ...minimalSubmission,
        kind: "IDEA",
        message: "Let me download audio only\nfor long drives",
      }),
    ).toContain("Let me download audio only\nfor long drives")
  })

  it("omits the video, contact, and device lines when the submission carries none (AE2, AE3)", () => {
    const description = buildFeedbackIssueDescription(minimalSubmission)
    expect(description).toBe(
      [
        "## Feedback",
        "",
        "Everything works great",
        "",
        "## Context",
        "",
        "- **Kind:** Something else",
        "- **Platform:** Android",
        `- **Submission id:** ${ESCAPED_SUBMISSION_ID}`,
        "",
        "---",
        "Submitted from the Jesus Film mobile app.",
      ].join("\n"),
    )
    for (const absent of [
      "Name",
      "Email",
      "Video",
      "Position",
      "Dub language",
      "App version",
      "OS version",
      "Device model",
    ]) {
      expect(description).not.toContain(`**${absent}:**`)
    }
  })

  it("omits the position line when the player could not report one", () => {
    const description = buildFeedbackIssueDescription({
      ...fullSubmission,
      video: { title: "JESUS", slug: "jesus", languageSlug: "english" },
    })
    expect(description).toContain("- **Video:** JESUS")
    expect(description).not.toContain("**Position:**")
  })

  it("strips invisible characters and escapes markdown in the name and the video title", () => {
    const description = buildFeedbackIssueDescription({
      ...fullSubmission,
      name: `Ada${ZERO_WIDTH_JOINER}Lovelace`,
      video: {
        title: "**JESUS** [film](x)",
        positionSeconds: 4324,
        slug: "jesus",
        languageSlug: "english",
      },
    })
    expect(description).toContain("- **Name:** AdaLovelace")
    expect(description).toContain(
      "- **Video:** \\*\\*JESUS\\*\\* \\[film\\]\\(x\\)",
    )
    expect(description).not.toContain(ZERO_WIDTH_JOINER)
  })
})

describe("createLinearFeedbackIssue", () => {
  it("refuses without a network call when the API key is missing (AE8)", async () => {
    envMutable.ADMIN_FEEDBACK_LINEAR_API_KEY = undefined
    const fetchMock = vi.fn<typeof fetch>()

    await expect(
      createLinearFeedbackIssue(fullSubmission, fetchMock),
    ).resolves.toEqual({
      status: "failed",
      reason: "config_missing",
      retryable: false,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses without a network call when the team id is missing (AE8)", async () => {
    envMutable.ADMIN_FEEDBACK_LINEAR_TEAM_ID = undefined
    const fetchMock = vi.fn<typeof fetch>()

    await expect(
      createLinearFeedbackIssue(fullSubmission, fetchMock),
    ).resolves.toEqual({
      status: "failed",
      reason: "config_missing",
      retryable: false,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("creates the issue with the project, the label, and no priority or assignee", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse())

    await expect(
      createLinearFeedbackIssue(fullSubmission, fetchMock),
    ).resolves.toEqual({ status: "created", issueId: "issue-1" })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("https://api.linear.app/graphql")
    expect(init?.method).toBe("POST")
    expect(init?.redirect).toBe("error")
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect((init?.headers as Record<string, string>).authorization).toBe(
      "lin_api_test",
    )

    const body = JSON.parse(String(init?.body)) as {
      query: string
      variables: { input: Record<string, unknown> }
    }
    expect(body.query).toContain("issueCreate")
    expect(body.variables.input).toEqual({
      teamId: "team-1",
      projectId: "project-1",
      labelIds: ["label-1"],
      title: buildFeedbackIssueTitle(fullSubmission),
      description: buildFeedbackIssueDescription(fullSubmission),
    })
    expect(body.variables.input).not.toHaveProperty("priority")
    expect(body.variables.input).not.toHaveProperty("assigneeId")
  })

  it("omits the project and the label when neither is configured", async () => {
    envMutable.ADMIN_FEEDBACK_LINEAR_PROJECT_ID = undefined
    envMutable.ADMIN_FEEDBACK_LINEAR_LABEL_ID = undefined
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse())

    await createLinearFeedbackIssue(fullSubmission, fetchMock)

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as {
      variables: { input: Record<string, unknown> }
    }
    expect(body.variables.input).not.toHaveProperty("projectId")
    expect(body.variables.input).not.toHaveProperty("labelIds")
  })

  it("maps a 429 to rate_limited and cancels the error body", async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("slow down"))
      },
      cancel() {
        cancelled = true
      },
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(stream, { status: 429 }))

    await expect(
      createLinearFeedbackIssue(fullSubmission, fetchMock),
    ).resolves.toEqual({
      status: "failed",
      reason: "rate_limited",
      retryable: true,
    })
    expect(cancelled).toBe(true)
  })

  it("maps a 500 to rejected and keeps it retryable", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("boom", { status: 500 }))

    await expect(
      createLinearFeedbackIssue(fullSubmission, fetchMock),
    ).resolves.toEqual({
      status: "failed",
      reason: "rejected",
      retryable: true,
    })
  })

  it("maps a 400 to rejected and marks it not retryable", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("nope", { status: 400 }))

    await expect(
      createLinearFeedbackIssue(fullSubmission, fetchMock),
    ).resolves.toEqual({
      status: "failed",
      reason: "rejected",
      retryable: false,
    })
  })

  it("aborts the reader and answers invalid_response over the 64 KB cap", async () => {
    let cancelled = false
    // Three chunks, then close: the cap trips on the second while a third is
    // still queued, so a cap that failed to fire would drain and close the
    // stream instead of hanging — the assertion below then discriminates.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(40 * 1024))
        controller.enqueue(new Uint8Array(40 * 1024))
        controller.enqueue(new Uint8Array(40 * 1024))
        controller.close()
      },
      cancel() {
        cancelled = true
      },
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(stream, { status: 200 }))

    await expect(
      createLinearFeedbackIssue(fullSubmission, fetchMock),
    ).resolves.toEqual({
      status: "failed",
      reason: "invalid_response",
      retryable: false,
    })
    expect(cancelled).toBe(true)
  })

  it.each([
    {
      label: "no issue id",
      body: JSON.stringify({
        data: { issueCreate: { success: true, issue: null } },
      }),
    },
    {
      label: "errors",
      body: JSON.stringify({ errors: [{ message: "denied" }] }),
    },
    { label: "unparsable", body: "not json" },
  ])("answers invalid_response for a $label response", async ({ body }) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { status: 200 }))

    await expect(
      createLinearFeedbackIssue(fullSubmission, fetchMock),
    ).resolves.toEqual({
      status: "failed",
      reason: "invalid_response",
      retryable: false,
    })
  })

  it("answers network_error when the request never reaches Linear", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"))

    await expect(
      createLinearFeedbackIssue(fullSubmission, fetchMock),
    ).resolves.toEqual({
      status: "failed",
      reason: "network_error",
      retryable: true,
    })
  })

  it("answers timeout inside the 6 second budget when the socket hangs", async () => {
    // Real timers: fake ones cannot intercept `AbortSignal.timeout`, so this
    // is the one test that proves the signal reaches fetch and fires.
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          signal?.addEventListener("abort", () => {
            reject(signal.reason)
          })
        }),
    )
    const startedAt = Date.now()

    await expect(
      createLinearFeedbackIssue(fullSubmission, fetchMock),
    ).resolves.toEqual({
      status: "failed",
      reason: "timeout",
      retryable: true,
    })
    const elapsed = Date.now() - startedAt
    expect(elapsed).toBeGreaterThanOrEqual(5_000)
    expect(elapsed).toBeLessThan(9_000)
  }, 20_000)
})

describe("createLinearFeedbackIssue logging", () => {
  it("logs one plain-string line per outcome and never the free text", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse())

    await createLinearFeedbackIssue(fullSubmission, fetchMock)

    expect(console.log).toHaveBeenCalledTimes(1)
    const line = vi.mocked(console.log).mock.calls[0]![0] as string
    expect(line).toMatch(
      new RegExp(
        `^\\[feedback\\] event=linear_created submission_id=${SUBMISSION_ID} kind=BROKEN platform=IOS status=200 duration_ms=\\d+$`,
      ),
    )
    expect(line).not.toContain("Ada")
    expect(line).not.toContain("ada@example.com")
    expect(line).not.toContain("player stalls")
  })

  it("logs the refusal reason on a failure", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("slow down", { status: 429 }))

    await createLinearFeedbackIssue(fullSubmission, fetchMock)

    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(console.warn).mock.calls[0]![0]).toMatch(
      /^\[feedback\] event=linear_failed submission_id=\S+ kind=BROKEN platform=IOS reason=rate_limited status=429 duration_ms=\d+$/,
    )
  })

  it("logs config_missing with no status", async () => {
    envMutable.ADMIN_FEEDBACK_LINEAR_API_KEY = undefined

    await createLinearFeedbackIssue(fullSubmission, vi.fn<typeof fetch>())

    expect(vi.mocked(console.warn).mock.calls[0]![0]).toMatch(
      /reason=config_missing status=none duration_ms=\d+$/,
    )
  })

  it("keeps a forged submission id from writing its own log line", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse())

    await createLinearFeedbackIssue(
      { ...minimalSubmission, submissionId: "abc\n[feedback] event=forged" },
      fetchMock,
    )

    const line = vi.mocked(console.log).mock.calls[0]![0] as string
    expect(line).not.toContain("\n")
    expect(line).toMatch(/submission_id=abc[A-Za-z0-9._-]* kind=OTHER/)
  })
})

/**
 * The boundary claim is "never throws": the resolver maps a typed outcome and
 * has no catch of its own. The builders index FEEDBACK_KIND_COPY, so they are
 * the one place a malformed submission can raise. U2's zod check should make
 * this unreachable, so the fixture is SYNTHETIC — the boundary has to hold
 * without depending on that validation.
 */
describe("createLinearFeedbackIssue never throws", () => {
  it("answers a typed failure instead of throwing on an unknown kind", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse())

    const outcome = await createLinearFeedbackIssue(
      {
        ...minimalSubmission,
        kind: "NOT_A_KIND" as MobileFeedbackSubmission["kind"],
      },
      fetchMock,
    )

    expect(outcome).toMatchObject({ status: "failed" })
    // The file-level beforeEach configures the service, so a non-config_missing
    // failure is what proves the builders ran and their throw was contained.
    expect(outcome).not.toMatchObject({ reason: "config_missing" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
