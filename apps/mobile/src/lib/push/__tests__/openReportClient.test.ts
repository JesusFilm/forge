/**
 * The open report (R23, KTD7). One deadline-bounded round trip that carries the
 * nonce unchanged, sends the viewer handle whole or not at all, and answers a
 * typed failure the caller drops rather than retries.
 *
 * All three outcomes are normal receipts: a duplicate and an unknown nonce are
 * not errors.
 */

jest.mock("../../recommendations/transport", () => ({
  mutateWithDeadline: jest.fn(),
}))

import { CombinedGraphQLErrors } from "@apollo/client/errors"

import { PUSH_OPEN_REPORT_DEADLINE_MS } from "../constants"
import { REPORT_PUSH_OPEN } from "../operations"
import { PushClientError } from "../registrationClient"
import { reportPushOpen } from "../openReportClient"
import { mutateWithDeadline } from "../../recommendations/transport"

const mutate = jest.mocked(mutateWithDeadline)

const NONCE = "aBcD1234_-efGHijkLMNopQRstuVWXyz0123456789A"

const HANDLE = {
  viewerToken: "viewer-token",
  sessionToken: "session-token",
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

describe("reportPushOpen", () => {
  it("sends the nonce under the open-report deadline", async () => {
    mutate.mockResolvedValue({
      reportPushOpen: { outcome: "STORED" },
    } as never)

    const outcome = await reportPushOpen({ nonce: NONCE, viewer: null })

    expect(outcome).toBe("STORED")
    expect(mutate).toHaveBeenCalledWith(
      REPORT_PUSH_OPEN,
      { input: { nonce: NONCE } },
      PUSH_OPEN_REPORT_DEADLINE_MS,
    )
  })

  it("carries the nonce byte for byte, never re-encoded", async () => {
    mutate.mockResolvedValue({
      reportPushOpen: { outcome: "STORED" },
    } as never)

    await reportPushOpen({ nonce: NONCE, viewer: null })

    const input = mutate.mock.calls[0]?.[1] as { input: { nonce: string } }
    expect(input.input.nonce).toBe(NONCE)
  })

  it("sends BOTH halves of the viewer handle or neither (KTD7)", async () => {
    mutate.mockResolvedValue({
      reportPushOpen: { outcome: "STORED" },
    } as never)

    await reportPushOpen({ nonce: NONCE, viewer: HANDLE })

    expect(mutate).toHaveBeenCalledWith(
      REPORT_PUSH_OPEN,
      { input: { nonce: NONCE, ...HANDLE } },
      PUSH_OPEN_REPORT_DEADLINE_MS,
    )
  })

  it.each(["STORED", "DUPLICATE", "UNKNOWN"] as const)(
    "reads %s as a normal receipt, never an error",
    async (outcome) => {
      mutate.mockResolvedValue({ reportPushOpen: { outcome } } as never)

      await expect(
        reportPushOpen({ nonce: NONCE, viewer: null }),
      ).resolves.toBe(outcome)
    },
  )

  it("rejects an outcome admin declares non-null but did not send", async () => {
    mutate.mockResolvedValue({ reportPushOpen: null } as never)

    const failure = await failureFrom(
      reportPushOpen({ nonce: NONCE, viewer: null }),
    )

    expect(failure.code).toBe("GRAPHQL_ERROR")
    expect(failure.definitive).toBe(true)
  })

  it("maps the global ceiling's TOO_MANY_REQUESTS to a rate limit (KTD7)", async () => {
    mutate.mockRejectedValue(graphqlError("TOO_MANY_REQUESTS"))

    const failure = await failureFrom(
      reportPushOpen({ nonce: NONCE, viewer: null }),
    )

    expect(failure.code).toBe("RATE_LIMITED")
    expect(failure.definitive).toBe(false)
  })

  it("maps the per-install limiter's HTTP 200 answer to a rate limit", async () => {
    mutate.mockRejectedValue(rateLimited())

    const failure = await failureFrom(
      reportPushOpen({ nonce: NONCE, viewer: null }),
    )

    expect(failure.code).toBe("RATE_LIMITED")
  })

  it("carries admin's finer push reason when it sends one", async () => {
    mutate.mockRejectedValue(
      graphqlError("BAD_USER_INPUT", { pushCode: "unknown_nonce_shape" }),
    )

    const failure = await failureFrom(
      reportPushOpen({ nonce: NONCE, viewer: null }),
    )

    expect(failure.code).toBe("BAD_USER_INPUT")
    expect(failure.pushCode).toBe("unknown_nonce_shape")
  })

  it("names the code alone, so no nonce or handle reaches a log", async () => {
    mutate.mockRejectedValue(graphqlError("UNAUTHENTICATED"))

    const failure = await failureFrom(
      reportPushOpen({ nonce: NONCE, viewer: HANDLE }),
    )

    expect(failure.message).toBe("push_unauthenticated")
    expect(failure.message).not.toContain(NONCE)
    expect(failure.message).not.toContain(HANDLE.viewerToken)
  })
})
