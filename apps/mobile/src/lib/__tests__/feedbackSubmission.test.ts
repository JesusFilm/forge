// The real apolloClient module evaluates here on purpose: KTD9's discriminating
// half asserts against the REAL reportGraphqlOperationError, so env and the
// native Datadog SDK are mocked the way apolloClient.test.ts mocks them, and
// only getApolloClient is replaced.
jest.mock("../../env", () => ({
  env: {
    EXPO_PUBLIC_ADMIN_GRAPHQL_URL: "https://admin.jesusfilm.org/api/graphql",
    EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN: "test-token",
    EXPO_PUBLIC_DATADOG_CLIENT_TOKEN: "ct",
    EXPO_PUBLIC_DATADOG_APPLICATION_ID: "app",
    EXPO_PUBLIC_DATADOG_SITE: undefined,
    EXPO_PUBLIC_DATADOG_ENV: undefined,
    EXPO_PUBLIC_DATADOG_VERSION: undefined,
    EXPO_PUBLIC_DATADOG_SESSION_SAMPLE_RATE: undefined,
    EXPO_PUBLIC_DATADOG_REPLAY_SAMPLE_RATE: undefined,
  },
}))

jest.mock("@datadog/mobile-react-native", () => ({
  DdLogs: {
    info: jest.fn().mockResolvedValue(undefined),
    warn: jest.fn().mockResolvedValue(undefined),
    error: jest.fn().mockResolvedValue(undefined),
  },
  DdRum: {
    addError: jest.fn().mockResolvedValue(undefined),
    startView: jest.fn().mockResolvedValue(undefined),
    addTiming: jest.fn().mockResolvedValue(undefined),
  },
  ErrorSource: { SOURCE: "SOURCE" },
  PropagatorType: { TRACECONTEXT: "tracecontext" },
  RumActionType: { CUSTOM: "custom" },
  DATADOG_GRAPH_QL_OPERATION_NAME_HEADER: "x-dd-graph-ql-operation-name",
  DATADOG_GRAPH_QL_OPERATION_TYPE_HEADER: "x-dd-graph-ql-operation-type",
}))

jest.mock("../apolloClient", () => ({
  ...jest.requireActual("../apolloClient"),
  getApolloClient: jest.fn(),
}))

import { DdRum } from "@datadog/mobile-react-native"
import { CombinedGraphQLErrors } from "@apollo/client/errors"

import {
  ClientAbortError,
  getApolloClient,
  reportGraphqlOperationError,
} from "../apolloClient"
import { FEEDBACK_FAILURE_MESSAGE } from "../feedbackCopy"
import {
  SUBMIT_FEEDBACK,
  SUBMIT_FEEDBACK_OPERATION_NAME,
  type FeedbackRefusal,
} from "../feedbackQueries"
import {
  FEEDBACK_DEVICE_FIELD_MAX_LENGTH,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_MESSAGE_MIN_LENGTH,
  FEEDBACK_NAME_MAX_LENGTH,
  FEEDBACK_VIDEO_TITLE_MAX_LENGTH,
  buildFeedbackSubmissionInput,
  classifyFeedbackResult,
  createFeedbackSubmission,
  sendFeedback,
  validateFeedbackDraft,
} from "../feedbackSubmission"

const mockAddError = DdRum.addError as jest.Mock
const mockGetApolloClient = getApolloClient as jest.Mock

// `satisfies` pins the list to the generated union: a renamed or removed admin
// refusal fails this file at compile time rather than silently under-covering.
const ALL_REFUSALS = [
  "INVALID_INPUT",
  "RATE_LIMITED",
  "DAILY_CAP",
  "UNAVAILABLE",
  "NOT_CONFIGURED",
] as const satisfies readonly FeedbackRefusal[]

const VALID_MESSAGE = "The audio drops out about halfway through."

function draft(
  overrides: Partial<Parameters<typeof validateFeedbackDraft>[0]> = {},
) {
  return {
    kind: "BROKEN" as const,
    message: VALID_MESSAGE,
    name: "",
    email: "",
    ...overrides,
  }
}

function mockMutate(impl: jest.Mock) {
  mockGetApolloClient.mockReturnValue({ mutate: impl })
  return impl
}

function resolvesWith(accepted: boolean, refusal: FeedbackRefusal | null) {
  return mockMutate(
    jest
      .fn()
      .mockResolvedValue({ data: { submitFeedback: { accepted, refusal } } }),
  )
}

beforeEach(() => {
  jest.clearAllMocks()
})

// This is the ONLY test that pins the wording. Every other copy assertion in
// the app compares against the constant, so without this one a reword passes
// the whole suite (KD10/R13).
describe("FEEDBACK_FAILURE_MESSAGE", () => {
  it("is the settled sentence", () => {
    expect(FEEDBACK_FAILURE_MESSAGE).toBe(
      "Couldn't send that. Try again in a few minutes.",
    )
  })

  // A curly apostrophe reads identically in a diff and mismatches the app's
  // existing failure copy (SheetError.tsx uses U+0027).
  it("uses a straight ASCII apostrophe", () => {
    expect(FEEDBACK_FAILURE_MESSAGE.codePointAt(6)).toBe(0x27)
    expect(FEEDBACK_FAILURE_MESSAGE).not.toMatch(/[‘’]/u)
  })
})

// KTD7/R18: the same bounds run on both sides, so the phone refuses first and
// admin never has to answer INVALID_INPUT for something the person could fix.
describe("validateFeedbackDraft", () => {
  it("accepts a message at the minimum length", () => {
    const message = "a".repeat(FEEDBACK_MESSAGE_MIN_LENGTH)
    expect(validateFeedbackDraft(draft({ message }))).toEqual({})
  })

  it("rejects a message one character short", () => {
    const message = "a".repeat(FEEDBACK_MESSAGE_MIN_LENGTH - 1)
    expect(validateFeedbackDraft(draft({ message }))).toEqual({
      message: "too_short",
    })
  })

  // AE14.
  it("rejects a 1001-character message", () => {
    const message = "a".repeat(FEEDBACK_MESSAGE_MAX_LENGTH + 1)
    expect(validateFeedbackDraft(draft({ message }))).toEqual({
      message: "too_long",
    })
  })

  it("accepts a message at exactly the maximum length", () => {
    const message = "a".repeat(FEEDBACK_MESSAGE_MAX_LENGTH)
    expect(validateFeedbackDraft(draft({ message }))).toEqual({})
  })

  // Admin trims before measuring, so the phone must measure the trimmed value
  // or the two disagree about the same text.
  it("measures the message after trimming", () => {
    const message = `   ${"a".repeat(FEEDBACK_MESSAGE_MIN_LENGTH - 1)}   `
    expect(validateFeedbackDraft(draft({ message }))).toEqual({
      message: "too_short",
    })
  })

  // R7/KD4: contact is optional. An absent name and email are the default.
  it("accepts an empty name and email", () => {
    expect(validateFeedbackDraft(draft({ name: "", email: "" }))).toEqual({})
    expect(validateFeedbackDraft(draft({ name: "   ", email: "  " }))).toEqual(
      {},
    )
  })

  it("accepts a name at the bound and rejects one past it", () => {
    expect(
      validateFeedbackDraft(
        draft({ name: "n".repeat(FEEDBACK_NAME_MAX_LENGTH) }),
      ),
    ).toEqual({})
    expect(
      validateFeedbackDraft(
        draft({ name: "n".repeat(FEEDBACK_NAME_MAX_LENGTH + 1) }),
      ),
    ).toEqual({ name: "too_long" })
  })

  it("rejects a malformed email and accepts a real one", () => {
    expect(validateFeedbackDraft(draft({ email: "not-an-email" }))).toEqual({
      email: "invalid_email",
    })
    expect(validateFeedbackDraft(draft({ email: "a@b" }))).toEqual({
      email: "invalid_email",
    })
    expect(
      validateFeedbackDraft(draft({ email: "viewer@example.com" })),
    ).toEqual({})
  })

  it("reports a problem on each bad field at once", () => {
    expect(
      validateFeedbackDraft(
        draft({ message: "short", email: "nope", name: "n".repeat(200) }),
      ),
    ).toEqual({
      message: "too_short",
      name: "too_long",
      email: "invalid_email",
    })
  })
})

describe("buildFeedbackSubmissionInput", () => {
  const base = {
    submissionId: "2b9d3f4e-1c5a-4e7b-9f0d-6a1b2c3d4e5f",
    platform: "IOS" as const,
    draft: draft(),
  }

  it("sends the trimmed message and omits the empty optionals", () => {
    const input = buildFeedbackSubmissionInput({
      ...base,
      draft: draft({ message: `  ${VALID_MESSAGE}  `, name: " ", email: "" }),
    })

    expect(input).toEqual({
      submissionId: base.submissionId,
      kind: "BROKEN",
      platform: "IOS",
      message: VALID_MESSAGE,
    })
    // Admin bounds name at min(1), so an empty string is a REFUSAL, not an
    // absent field. The omission is what makes "contact is optional" work.
    expect("name" in input).toBe(false)
    expect("email" in input).toBe(false)
  })

  it("sends a typed name and email trimmed", () => {
    const input = buildFeedbackSubmissionInput({
      ...base,
      draft: draft({ name: "  Sam  ", email: "  sam@example.com " }),
    })
    expect(input.name).toBe("Sam")
    expect(input.email).toBe("sam@example.com")
  })

  it("carries the video tag the person left on", () => {
    const input = buildFeedbackSubmissionInput({
      ...base,
      video: {
        title: "JESUS",
        positionSeconds: 4324,
        slug: "jesus",
        languageSlug: "english",
      },
    })
    expect(input.video).toEqual({
      title: "JESUS",
      positionSeconds: 4324,
      slug: "jesus",
      languageSlug: "english",
    })
  })

  it("drops the whole video tag when it has no usable title", () => {
    const input = buildFeedbackSubmissionInput({
      ...base,
      video: { title: "   " },
    })
    expect(input.video).toBeUndefined()
  })

  // "Truncate what is read, drop what is followed": the title is displayed, so
  // it survives clipped; a slug LOCATES the video, so a malformed one is
  // dropped rather than sent broken. Neither may cost the person their message.
  it("truncates an over-long title and drops an unusable slug", () => {
    const input = buildFeedbackSubmissionInput({
      ...base,
      video: {
        title: "T".repeat(FEEDBACK_VIDEO_TITLE_MAX_LENGTH + 50),
        slug: "not a slug!",
        languageSlug: "english",
      },
    })
    expect(input.video?.title).toHaveLength(FEEDBACK_VIDEO_TITLE_MAX_LENGTH)
    expect(input.video?.slug).toBeUndefined()
    expect(input.video?.languageSlug).toBe("english")
  })

  it("drops a position admin would refuse and keeps a real one", () => {
    const negative = buildFeedbackSubmissionInput({
      ...base,
      video: { title: "JESUS", positionSeconds: -1 },
    })
    expect(negative.video?.positionSeconds).toBeUndefined()

    const infinite = buildFeedbackSubmissionInput({
      ...base,
      video: { title: "JESUS", positionSeconds: Number.POSITIVE_INFINITY },
    })
    expect(infinite.video?.positionSeconds).toBeUndefined()

    const real = buildFeedbackSubmissionInput({
      ...base,
      video: { title: "JESUS", positionSeconds: 43 },
    })
    expect(real.video?.positionSeconds).toBe(43)
  })

  // R8/R9: device details travel only when the person left the switch on, and
  // all four fields travel together.
  it("omits device details unless they are given", () => {
    expect(buildFeedbackSubmissionInput(base).deviceDetails).toBeUndefined()

    const withDetails = buildFeedbackSubmissionInput({
      ...base,
      deviceDetails: {
        appVersion: "1.0.0",
        appBuild: "7",
        osVersion: "26.0",
        deviceModel: "iPhone 17 Pro Max",
      },
    })
    expect(withDetails.deviceDetails).toEqual({
      appVersion: "1.0.0",
      appBuild: "7",
      osVersion: "26.0",
      deviceModel: "iPhone 17 Pro Max",
    })
  })

  it("clamps a device field to admin's bound", () => {
    const input = buildFeedbackSubmissionInput({
      ...base,
      deviceDetails: {
        appVersion: "1.0.0",
        appBuild: "7",
        osVersion: "26.0",
        deviceModel: "M".repeat(FEEDBACK_DEVICE_FIELD_MAX_LENGTH + 10),
      },
    })
    expect(input.deviceDetails?.deviceModel).toHaveLength(
      FEEDBACK_DEVICE_FIELD_MAX_LENGTH,
    )
  })

  // R8: nothing is read from the account, so no account identifier can reach
  // the wire. The key set IS the whole personal-data posture.
  it("sends no field the person did not type or turn on", () => {
    const input = buildFeedbackSubmissionInput({
      ...base,
      draft: draft({ name: "Sam", email: "sam@example.com" }),
      video: { title: "JESUS" },
      deviceDetails: {
        appVersion: "1.0.0",
        appBuild: "7",
        osVersion: "26.0",
        deviceModel: "iPhone",
      },
    })
    expect(Object.keys(input).sort()).toEqual([
      "deviceDetails",
      "email",
      "kind",
      "message",
      "name",
      "platform",
      "submissionId",
      "video",
    ])
  })
})

// KTD8/AE11: one id per draft, reused by every retry, so a duplicate ticket is
// visible instead of silent (KD9). No server-side dedupe backs this up.
describe("createFeedbackSubmission", () => {
  const UUID_V4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

  it("mints a v4 UUID", () => {
    expect(createFeedbackSubmission().submissionId).toMatch(UUID_V4)
  })

  it("mints a new id per model instance", () => {
    expect(createFeedbackSubmission().submissionId).not.toBe(
      createFeedbackSubmission().submissionId,
    )
  })

  // AE11: a Send that failed, then Retry, then Retry again, carries the SAME id.
  it("reuses the id across two send-and-retry cycles", async () => {
    const mutate = resolvesWith(false, "UNAVAILABLE")
    const model = createFeedbackSubmission()
    const args = { draft: draft(), platform: "IOS" as const }

    await model.send(args)
    await model.send(args)

    const sentIds = mutate.mock.calls.map(
      (call) => call[0].variables.input.submissionId,
    )
    expect(sentIds).toEqual([model.submissionId, model.submissionId])
  })
})

describe("classifyFeedbackResult", () => {
  it("reads accepted as the one success", () => {
    expect(classifyFeedbackResult({ accepted: true, refusal: null })).toEqual({
      status: "accepted",
    })
  })

  // KD10: every refusal renders the same message, the fleet-wide daily cap
  // included. The value rides along for a future reader and selects no text.
  it.each(ALL_REFUSALS)("renders one message for %s", (refusal) => {
    expect(classifyFeedbackResult({ accepted: false, refusal })).toEqual({
      status: "failed",
      refusal,
      message: FEEDBACK_FAILURE_MESSAGE,
    })
  })

  it("treats an absent body as the same failure", () => {
    for (const answer of [null, undefined]) {
      expect(classifyFeedbackResult(answer)).toEqual({
        status: "failed",
        refusal: null,
        message: FEEDBACK_FAILURE_MESSAGE,
      })
    }
  })

  // A refusal with no value would be an admin bug; it must not read as success.
  it("treats accepted:false with no refusal as a failure", () => {
    expect(classifyFeedbackResult({ accepted: false, refusal: null })).toEqual({
      status: "failed",
      refusal: null,
      message: FEEDBACK_FAILURE_MESSAGE,
    })
  })
})

describe("sendFeedback", () => {
  const input = buildFeedbackSubmissionInput({
    submissionId: "2b9d3f4e-1c5a-4e7b-9f0d-6a1b2c3d4e5f",
    platform: "IOS",
    draft: draft(),
  })

  it("posts the typed mutation and keeps the answer out of the cache", async () => {
    const mutate = resolvesWith(true, null)
    await expect(sendFeedback(input)).resolves.toEqual({ status: "accepted" })
    expect(mutate).toHaveBeenCalledWith({
      mutation: SUBMIT_FEEDBACK,
      variables: { input },
      fetchPolicy: "no-cache",
    })
  })

  // R13: nothing is retried in the background and nothing is queued, so every
  // thrown error has to settle as the one failure the person can act on.
  const throwers: [string, unknown][] = [
    ["offline", new TypeError("Network request failed")],
    ["the client's own 15s abort", new ClientAbortError()],
    [
      "a GraphQL fault",
      new CombinedGraphQLErrors({ errors: [{ message: "boom" }] }),
    ],
  ]

  it.each(throwers)(
    "classifies %s as the one failure",
    async (_label, error) => {
      mockMutate(jest.fn().mockRejectedValue(error))
      await expect(sendFeedback(input)).resolves.toEqual({
        status: "failed",
        refusal: null,
        message: FEEDBACK_FAILURE_MESSAGE,
      })
    },
  )

  // A sync throw from the client getter must settle the same way: U4 has one
  // failure path and a rejection here would escape it.
  it("never rejects, even when the client throws synchronously", async () => {
    mockGetApolloClient.mockImplementation(() => {
      throw new Error("no client")
    })
    await expect(sendFeedback(input)).resolves.toEqual({
      status: "failed",
      refusal: null,
      message: FEEDBACK_FAILURE_MESSAGE,
    })
  })

  it.each(ALL_REFUSALS)(
    "classifies the %s refusal as that failure",
    async (refusal) => {
      resolvesWith(false, refusal)
      await expect(sendFeedback(input)).resolves.toEqual({
        status: "failed",
        refusal,
        message: FEEDBACK_FAILURE_MESSAGE,
      })
    },
  )
})

// KTD9. A refusal is DATA on an HTTP 200, so it never reaches apolloClient's
// ErrorLink and cannot feed the Datadog triage sweep.
describe("refusals never reach RUM", () => {
  // Load-bearing: nothing in the classifier path could call the reporter, so
  // this proves it IS live for this op — the silence above is the refusal's
  // doing, not a blanket exemption like RecordWatchSearchEvent's.
  it("still reports a thrown GraphQL error for the same operation", () => {
    reportGraphqlOperationError(
      new CombinedGraphQLErrors({ errors: [{ message: "boom" }] }),
      SUBMIT_FEEDBACK_OPERATION_NAME,
    )
    expect(mockAddError).toHaveBeenCalledWith(
      expect.any(String),
      "SOURCE",
      expect.any(String),
      {
        origin: "graphql_error",
        operation: SUBMIT_FEEDBACK_OPERATION_NAME,
        code: "unknown",
      },
    )
  })

  it("files no RUM error for any refusal", async () => {
    const input = buildFeedbackSubmissionInput({
      submissionId: "2b9d3f4e-1c5a-4e7b-9f0d-6a1b2c3d4e5f",
      platform: "ANDROID",
      draft: draft(),
    })
    for (const refusal of ALL_REFUSALS) {
      resolvesWith(false, refusal)
      await sendFeedback(input)
    }
    expect(mockAddError).not.toHaveBeenCalled()
  })
})
