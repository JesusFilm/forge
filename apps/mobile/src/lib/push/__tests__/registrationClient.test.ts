/**
 * The mutation call: one deadline-bounded round trip, and a typed failure the
 * controller can branch on. Admin's codes arrive as GraphQL extensions, and its
 * per-install limiter answers HTTP 200 with `extensions.http.statusCode: 429`,
 * so the mapping is pinned against both shapes.
 */

jest.mock("../../recommendations/transport", () => ({
  mutateWithDeadline: jest.fn(),
}))

import { CombinedGraphQLErrors, ServerError } from "@apollo/client/errors"

import {
  PUSH_REGISTRATION_DEADLINE_MS,
  PUSH_VIEWER_HANDLE_REJECTED_CODE,
} from "../constants"
import { REGISTER_PUSH_DEVICE } from "../operations"
import { PushClientError, registerPushDevice } from "../registrationClient"
import { mutateWithDeadline } from "../../recommendations/transport"

const mutate = jest.mocked(mutateWithDeadline)

const PAYLOAD = {
  expoPushToken: "ExponentPushToken[abc]",
  installId: "3f2a9c10-5b6d-4e71-8a02-9c3d4e5f6071",
  platform: "IOS" as const,
  appBuild: "1.0.0+42",
  appLanguageSlug: "english",
  phoneLocale: "en-US",
  timeZone: "Pacific/Auckland",
  permission: "granted" as const,
}

function graphqlError(code: string, extra: Record<string, unknown> = {}) {
  return new CombinedGraphQLErrors({
    errors: [{ message: "boom", extensions: { code, ...extra } }],
  })
}

/** Admin's per-install limiter: HTTP 200, one error, no `code`. */
function rateLimited() {
  return new CombinedGraphQLErrors({
    errors: [
      { message: "Too many calls", extensions: { http: { statusCode: 429 } } },
    ],
  })
}

/** The rejection, proven to be a rejection: a resolved call must not read as
 *  one, or every mapping assertion below could pass on a receipt. */
async function failureFrom(
  promise: Promise<unknown>,
): Promise<PushClientError> {
  const outcome = await promise.then(
    () => null,
    (error: unknown) => error,
  )
  expect(outcome).toBeInstanceOf(PushClientError)
  return outcome as PushClientError
}

beforeEach(() => {
  mutate.mockReset()
})

describe("registerPushDevice", () => {
  it("sends the payload as the mutation input under the push deadline", async () => {
    mutate.mockResolvedValue({
      registerPushDevice: { testDeviceId: "abc12345", status: "ACTIVE" },
    } as never)

    const receipt = await registerPushDevice(PAYLOAD)

    expect(receipt).toEqual({ testDeviceId: "abc12345", status: "ACTIVE" })
    expect(mutate).toHaveBeenCalledWith(
      REGISTER_PUSH_DEVICE,
      { input: PAYLOAD },
      PUSH_REGISTRATION_DEADLINE_MS,
    )
  })

  it("sends the install id, which admin supersedes this phone's token by", async () => {
    // The whole payload maps across by name, and this field is the one a
    // mapping written field by field would be free to drop.
    mutate.mockResolvedValue({
      registerPushDevice: { testDeviceId: "abc12345", status: "ACTIVE" },
    } as never)

    await registerPushDevice(PAYLOAD)

    const variables = mutate.mock.calls[0][1] as {
      input: Record<string, unknown>
    }
    expect(variables.input.installId).toBe(PAYLOAD.installId)
  })

  it("rejects with a typed failure when the receipt has no test ID", async () => {
    // Admin declares the field non-null, so this is a contract break rather
    // than a state the app should keep.
    mutate.mockResolvedValue({
      registerPushDevice: { testDeviceId: "", status: "ACTIVE" },
    } as never)

    await expect(registerPushDevice(PAYLOAD)).rejects.toBeInstanceOf(
      PushClientError,
    )
  })

  it("keeps admin's push code, which is how a retired token is recognised", async () => {
    mutate.mockRejectedValue(
      graphqlError("BAD_USER_INPUT", { pushCode: "invalid_token_status" }),
    )

    const failure = await failureFrom(registerPushDevice(PAYLOAD))

    expect(failure.code).toBe("BAD_USER_INPUT")
    expect(failure.pushCode).toBe("invalid_token_status")
    expect(failure.definitive).toBe(true)
  })

  it("maps admin's HTTP 200 rate limit to RATE_LIMITED", async () => {
    mutate.mockRejectedValue(rateLimited())

    const failure = await failureFrom(registerPushDevice(PAYLOAD))

    expect(failure.code).toBe("RATE_LIMITED")
    expect(failure.definitive).toBe(false)
  })

  it("maps the per-operation ceiling to RATE_LIMITED too", async () => {
    // KTD7's global ceiling answers TOO_MANY_REQUESTS, which is the same
    // "come back later" as the per-install limiter. Read as a generic GraphQL
    // error it would log as a client fault instead.
    mutate.mockRejectedValue(
      graphqlError("TOO_MANY_REQUESTS", { pushCode: "ceiling_exceeded" }),
    )

    const failure = await failureFrom(registerPushDevice(PAYLOAD))

    expect(failure.code).toBe("RATE_LIMITED")
    expect(failure.pushCode).toBe("ceiling_exceeded")
  })

  it("maps an edge HTTP 429 to RATE_LIMITED", async () => {
    mutate.mockRejectedValue(
      new ServerError("429", {
        response: { status: 429, headers: { get: () => null } } as never,
        bodyText: "",
      }),
    )

    const failure = await failureFrom(registerPushDevice(PAYLOAD))

    expect(failure.code).toBe("RATE_LIMITED")
  })

  it("maps a missing bearer to UNAUTHENTICATED", async () => {
    mutate.mockRejectedValue(
      graphqlError("UNAUTHENTICATED", { pushCode: "admission_denied" }),
    )

    const failure = await failureFrom(registerPushDevice(PAYLOAD))

    expect(failure.code).toBe("UNAUTHENTICATED")
    expect(failure.definitive).toBe(true)
    expect(failure.pushCode).toBe("admission_denied")
  })

  it("lifts admin's refused-handle code off the wire", async () => {
    // The controller retries without the handle only on this exact pushCode,
    // so the real GraphQL shape must carry it through.
    mutate.mockRejectedValue(
      graphqlError("UNAUTHENTICATED", { pushCode: "viewer_handle_rejected" }),
    )

    const failure = await failureFrom(registerPushDevice(PAYLOAD))

    expect(failure.code).toBe("UNAUTHENTICATED")
    expect(failure.pushCode).toBe(PUSH_VIEWER_HANDLE_REJECTED_CODE)
  })

  it("maps a transport fault to a retryable failure", async () => {
    mutate.mockRejectedValue(new Error("network down"))

    const failure = await failureFrom(registerPushDevice(PAYLOAD))

    expect(failure.code).toBe("NETWORK_ERROR")
    expect(failure.definitive).toBe(false)
    expect(failure.pushCode).toBeNull()
  })

  it("carries no token and no handle in the failure message", async () => {
    mutate.mockRejectedValue(graphqlError("BAD_USER_INPUT"))

    const failure = await failureFrom(
      registerPushDevice({
        ...PAYLOAD,
        viewerToken: "viewer-1",
        sessionToken: "session-1",
      }),
    )

    expect(failure.message).not.toContain("Exponent")
    expect(failure.message).not.toContain("viewer-1")
  })
})
