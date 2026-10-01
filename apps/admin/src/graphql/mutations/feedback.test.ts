// `submitFeedback` (U2). Every case runs through real GraphQL execution
// against the built schema, not a direct `resolve` call: input coercion and
// the `public: true` scope are half of what this unit promises, and a direct
// call sees neither.

import { beforeEach, describe, expect, it, vi } from "vitest"

import { createRequire } from "node:module"

import type { GraphQLEnumType } from "graphql"

// Vitest hands this file graphql's ESM build while Pothos built the schema
// with the CJS one, and graphql's `instanceOf` rejects a schema from another
// realm. Load the executor out of the schema's own realm.
const { graphql: executeGraphql } = createRequire(__filename)(
  "graphql",
) as typeof import("graphql")

const { createLinearFeedbackIssueMock, checkFeedbackLimitsMock } = vi.hoisted(
  () => ({
    createLinearFeedbackIssueMock: vi.fn(),
    checkFeedbackLimitsMock: vi.fn(),
  }),
)

vi.mock("@/services/feedback-linear", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/feedback-linear")>()),
  createLinearFeedbackIssue: createLinearFeedbackIssueMock,
}))

vi.mock("@/services/feedback-limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/feedback-limits")>()),
  checkFeedbackLimits: checkFeedbackLimitsMock,
}))

import { resetLocalRateLimitState } from "@/auth/rate-limit"
import type { ContextShape } from "@/graphql/builder"
import { schema } from "@/graphql/schema"
import { FEEDBACK_INSTALL_LIMIT } from "@/services/feedback-limits"

// The unmocked counters, for the one case that proves the resolver is wired to
// them. Importing the name above would re-enter the mock.
const realLimits = await vi.importActual<
  typeof import("@/services/feedback-limits")
>("@/services/feedback-limits")

const MUTATION = /* GraphQL */ `
  mutation Submit($input: FeedbackSubmissionInput!) {
    submitFeedback(input: $input) {
      accepted
      refusal
    }
  }
`

const MESSAGE = "The Spanish dub plays English audio from two minutes in."
const VALID_INPUT = {
  submissionId: "3f9d2c1a-5b6e-4f7a-8c9d-0e1f2a3b4c5d",
  kind: "BROKEN",
  message: MESSAGE,
  platform: "IOS",
}

/** A fleet install: the shape mobile actually sends. */
function fleetContext(
  viewerId = "install-a",
  headers: Record<string, string> = {},
): ContextShape {
  const request = new Request("https://admin.test/api/graphql", {
    headers: {
      "x-viewer-id": viewerId,
      "cf-connecting-ip": "203.0.113.9",
      ...headers,
    },
  })
  return {
    user: {
      id: null,
      role: "CONSUMER_BEARER",
      rateLimitBucketKey: "fk",
      fleet: true,
    },
    request,
  } as unknown as ContextShape
}

function anonymousContext(): ContextShape {
  return {
    user: null,
    request: new Request("https://admin.test/api/graphql", {
      headers: { "cf-connecting-ip": "203.0.113.9" },
    }),
  } as unknown as ContextShape
}

async function submit(
  input: Record<string, unknown>,
  ctx: ContextShape = anonymousContext(),
) {
  return executeGraphql({
    schema,
    source: MUTATION,
    contextValue: ctx,
    variableValues: { input },
  })
}

async function answer(
  input: Record<string, unknown>,
  ctx?: ContextShape,
): Promise<{ accepted: boolean; refusal: string | null }> {
  const result = await submit(input, ctx)
  expect(result.errors).toBeUndefined()
  return (result.data as { submitFeedback: never }).submitFeedback
}

let logged: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  resetLocalRateLimitState()
  logged = []
  for (const method of ["log", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "))
    })
  }
  createLinearFeedbackIssueMock.mockResolvedValue({
    status: "created",
    issueId: "issue_1",
  })
  checkFeedbackLimitsMock.mockResolvedValue({ allowed: true })
})

describe("schema surface", () => {
  it("exposes the mutation and its three enums with the wire spellings", () => {
    expect(schema.getMutationType()!.getFields().submitFeedback).toBeDefined()
    // Sorted: Pothos orders enum values itself, and the SPELLING is what the
    // phone has to match — uppercase on both sides.
    const names = (type: string) =>
      (schema.getType(type) as GraphQLEnumType)
        .getValues()
        .map((value) => value.name)
        .sort()
    expect(names("FeedbackKind")).toEqual(["BROKEN", "IDEA", "OTHER"])
    expect(names("FeedbackPlatform")).toEqual(["ANDROID", "IOS"])
    // DAILY_CAP is a SEPARATE value from RATE_LIMITED on purpose (KD10): the
    // phone renders one message for both, so collapsing them here would leave
    // an operator no way to see the kill switch working.
    expect(names("FeedbackRefusal")).toEqual([
      "DAILY_CAP",
      "INVALID_INPUT",
      "NOT_CONFIGURED",
      "RATE_LIMITED",
      "UNAVAILABLE",
    ])
  })
})

describe("accepting a submission", () => {
  it("answers accepted for an anonymous caller and files the issue (R3, AE5)", async () => {
    expect(await answer(VALID_INPUT)).toEqual({
      accepted: true,
      refusal: null,
    })
    // toEqual fails on an EXTRA key, which is the assertion that matters: no
    // account id and no email reach the ticket unless the person typed one.
    expect(createLinearFeedbackIssueMock).toHaveBeenCalledWith({
      submissionId: VALID_INPUT.submissionId,
      kind: "BROKEN",
      message: MESSAGE,
      platform: "IOS",
    })
  })

  it("behaves identically for a signed-in caller (R3)", async () => {
    const ctx = {
      user: { id: "user_1", role: "ADMIN" },
      request: new Request("https://admin.test/api/graphql"),
    } as unknown as ContextShape

    expect(await answer(VALID_INPUT, ctx)).toEqual({
      accepted: true,
      refusal: null,
    })
    expect(createLinearFeedbackIssueMock).toHaveBeenCalledWith({
      submissionId: VALID_INPUT.submissionId,
      kind: "BROKEN",
      message: MESSAGE,
      platform: "IOS",
    })
  })

  it("carries the optional context through and trims it", async () => {
    await answer({
      ...VALID_INPUT,
      name: "  Ana  ",
      email: "ana@example.com",
      video: {
        title: " Jesus ",
        positionSeconds: 125.5,
        slug: "jesus",
        languageSlug: "spanish-latin-american",
      },
      deviceDetails: {
        appVersion: "1.0.0",
        appBuild: "7",
        osVersion: "iOS 26.0",
        deviceModel: "iPhone17,2",
      },
    })

    expect(createLinearFeedbackIssueMock).toHaveBeenCalledWith({
      submissionId: VALID_INPUT.submissionId,
      kind: "BROKEN",
      message: MESSAGE,
      platform: "IOS",
      name: "Ana",
      email: "ana@example.com",
      video: {
        title: "Jesus",
        positionSeconds: 125.5,
        slug: "jesus",
        languageSlug: "spanish-latin-american",
      },
      deviceDetails: {
        appVersion: "1.0.0",
        appBuild: "7",
        osVersion: "iOS 26.0",
        deviceModel: "iPhone17,2",
      },
    })
  })
})

describe("input bounds (KTD7, AE14)", () => {
  it.each([
    ["a 1001-character message", { message: "a".repeat(1001) }],
    ["a 9-character message", { message: "too short" }],
    ["a blank message", { message: "           " }],
    ["a 101-character name", { name: "n".repeat(101) }],
    ["a malformed email", { email: "ana@@example" }],
    ["a 255-character email", { email: `${"a".repeat(246)}@mail.com` }],
    ["a malformed submission id", { submissionId: "not-a-uuid" }],
    ["a negative position", { video: { title: "Jesus", positionSeconds: -1 } }],
    ["a 201-character video title", { video: { title: "t".repeat(201) } }],
    [
      "a slug outside the bounded charset",
      { video: { title: "Jesus", slug: "jesus/../etc" } },
    ],
    [
      "a 101-character device field",
      {
        deviceDetails: {
          appVersion: "v".repeat(101),
          appBuild: "7",
          osVersion: "iOS 26.0",
          deviceModel: "iPhone17,2",
        },
      },
    ],
  ])("refuses %s and never reaches Linear", async (_label, override) => {
    expect(await answer({ ...VALID_INPUT, ...override })).toEqual({
      accepted: false,
      refusal: "INVALID_INPUT",
    })
    expect(createLinearFeedbackIssueMock).not.toHaveBeenCalled()
  })

  it("refuses before it spends a limit", async () => {
    await answer({ ...VALID_INPUT, message: "short" })
    expect(checkFeedbackLimitsMock).not.toHaveBeenCalled()
  })
})

describe("mapping the Linear outcome (KTD1)", () => {
  it.each([
    ["config_missing", "NOT_CONFIGURED"],
    ["rate_limited", "RATE_LIMITED"],
    ["timeout", "UNAVAILABLE"],
    ["network_error", "UNAVAILABLE"],
    ["rejected", "UNAVAILABLE"],
    ["invalid_response", "UNAVAILABLE"],
  ])("answers %s as refusal %s", async (reason, refusal) => {
    createLinearFeedbackIssueMock.mockResolvedValue({
      status: "failed",
      reason,
      retryable: false,
    })
    expect(await answer(VALID_INPUT)).toEqual({ accepted: false, refusal })
  })

  it("still THROWS an unexpected error rather than calling it a refusal", async () => {
    createLinearFeedbackIssueMock.mockRejectedValue(new Error("boom"))

    const result = await submit(VALID_INPUT)

    // A non-nullable field that throws nulls the whole `data`. What matters is
    // that the caller sees an error, never `accepted: false`.
    expect(result.errors?.[0]?.message).toBe("boom")
    expect(result.data).toBeNull()
  })
})

describe("limits (KTD3)", () => {
  it("reads the install bucket and the TRUSTED address, never x-forwarded-for", async () => {
    await answer(
      VALID_INPUT,
      fleetContext("install-a", { "x-forwarded-for": "192.0.2.1" }),
    )

    expect(checkFeedbackLimitsMock).toHaveBeenCalledWith({
      installIdentity: "consumer:fk:v:install-a",
      clientIp: "203.0.113.9",
    })
  })

  it("refuses the sixth call from one install and accepts another one behind the same address (AE7, AE15)", async () => {
    checkFeedbackLimitsMock.mockImplementation(realLimits.checkFeedbackLimits)

    for (let i = 0; i < FEEDBACK_INSTALL_LIMIT; i++) {
      expect(await answer(VALID_INPUT, fleetContext("install-a"))).toEqual({
        accepted: true,
        refusal: null,
      })
    }
    createLinearFeedbackIssueMock.mockClear()

    expect(await answer(VALID_INPUT, fleetContext("install-a"))).toEqual({
      accepted: false,
      refusal: "RATE_LIMITED",
    })
    expect(createLinearFeedbackIssueMock).not.toHaveBeenCalled()

    expect(await answer(VALID_INPUT, fleetContext("install-b"))).toEqual({
      accepted: true,
      refusal: null,
    })
  })

  it("answers DAILY_CAP before Linear is called (AE16)", async () => {
    checkFeedbackLimitsMock.mockResolvedValue({
      allowed: false,
      scope: "daily",
      refusal: "DAILY_CAP",
    })

    expect(await answer(VALID_INPUT)).toEqual({
      accepted: false,
      refusal: "DAILY_CAP",
    })
    expect(createLinearFeedbackIssueMock).not.toHaveBeenCalled()
  })
})

describe("refusal logging", () => {
  it("names each refusal value on its own line", async () => {
    checkFeedbackLimitsMock.mockResolvedValue({
      allowed: false,
      scope: "install",
      refusal: "RATE_LIMITED",
    })
    await answer(VALID_INPUT)
    expect(logged).toContain(
      "[feedback] event=refused refusal=RATE_LIMITED scope=install",
    )

    logged = []
    checkFeedbackLimitsMock.mockResolvedValue({
      allowed: false,
      scope: "daily",
      refusal: "DAILY_CAP",
    })
    await answer(VALID_INPUT)
    expect(logged).toContain(
      "[feedback] event=refused refusal=DAILY_CAP scope=daily",
    )

    logged = []
    checkFeedbackLimitsMock.mockResolvedValue({ allowed: true })
    createLinearFeedbackIssueMock.mockResolvedValue({
      status: "failed",
      reason: "config_missing",
      retryable: false,
    })
    await answer(VALID_INPUT)
    expect(logged).toContain(
      "[feedback] event=refused refusal=NOT_CONFIGURED reason=config_missing",
    )
  })

  it("names the failing FIELD on a bounds refusal, never the value", async () => {
    await answer({ ...VALID_INPUT, message: "short", email: "nope" })
    const line = logged.find((entry) => entry.includes("INVALID_INPUT"))
    expect(line).toContain("fields=")
    expect(line).toContain("message")
    expect(line).toContain("email")
    expect(line).not.toContain("short")
    expect(line).not.toContain("nope")
  })

  it("never logs the message, the name, or the email", async () => {
    const secrets = ["Ana Example", "ana@example.com", MESSAGE]
    checkFeedbackLimitsMock.mockResolvedValue({
      allowed: false,
      scope: "address",
      refusal: "RATE_LIMITED",
    })
    await answer({ ...VALID_INPUT, name: secrets[0], email: secrets[1] })

    checkFeedbackLimitsMock.mockResolvedValue({ allowed: true })
    await answer({ ...VALID_INPUT, name: secrets[0], email: secrets[1] })

    expect(logged.length).toBeGreaterThan(0)
    for (const line of logged) {
      for (const secret of secrets) expect(line).not.toContain(secret)
    }
  })
})
