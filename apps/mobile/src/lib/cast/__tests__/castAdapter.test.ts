/**
 * Rate facade (U5, KTD6): a speed pick reaches the receiver through
 * setCastPlaybackRate; the logged wrapper keeps rejections out of the sheet
 * (one cast.command_failed warn, nothing thrown — the runCommand convention).
 */

jest.mock("../../datadog", () => ({
  capErrorMessage: (message: string) => message,
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

let mockGetCurrentCastSession: jest.Mock

jest.mock("react-native-google-cast", () => ({
  MediaStreamType: { BUFFERED: "buffered" },
  CastContext: {
    getSessionManager: () => ({
      getCurrentCastSession: () => mockGetCurrentCastSession(),
    }),
  },
}))

import { setCastPlaybackRate, setCastPlaybackRateLogged } from "../castAdapter"

const { datadogLog: mockDatadogLog } = jest.requireMock("../../datadog") as {
  datadogLog: { info: jest.Mock; warn: jest.Mock; error: jest.Mock }
}

type MockClient = { setPlaybackRate: jest.Mock }

function sessionWithClient(client: MockClient) {
  mockGetCurrentCastSession = jest.fn(() => Promise.resolve({ client }))
  return client
}

function makeClient(
  impl: () => Promise<void> = () => Promise.resolve(),
): MockClient {
  return { setPlaybackRate: jest.fn(impl) }
}

/** Settles the fire-and-forget chain the logged wrapper detaches. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  mockGetCurrentCastSession = jest.fn(() => Promise.resolve(null))
  mockDatadogLog.warn.mockClear()
})

describe("setCastPlaybackRate", () => {
  it("sends the picked rate to the current session's client (AE4)", async () => {
    const client = sessionWithClient(makeClient())
    await setCastPlaybackRate(1.5)
    expect(client.setPlaybackRate).toHaveBeenCalledTimes(1)
    expect(client.setPlaybackRate).toHaveBeenCalledWith(1.5)
  })

  it("resolves without a client call when no session is current", async () => {
    mockGetCurrentCastSession = jest.fn(() => Promise.resolve(null))
    await expect(setCastPlaybackRate(1.5)).resolves.toBeUndefined()
  })

  it("clamps out-of-range rates to the SDK's 0.5-2.0 band (belt)", async () => {
    const client = sessionWithClient(makeClient())
    await setCastPlaybackRate(2.5)
    expect(client.setPlaybackRate).toHaveBeenLastCalledWith(2)
    await setCastPlaybackRate(0.25)
    expect(client.setPlaybackRate).toHaveBeenLastCalledWith(0.5)
  })

  it("never sends a non-finite rate", async () => {
    const client = sessionWithClient(makeClient())
    await setCastPlaybackRate(Number.NaN)
    await setCastPlaybackRate(Number.POSITIVE_INFINITY)
    expect(client.setPlaybackRate).not.toHaveBeenCalled()
  })
})

describe("setCastPlaybackRateLogged", () => {
  it("logs one cast.command_failed on a client rejection, throws nothing", async () => {
    sessionWithClient(makeClient(() => Promise.reject(new Error("boom"))))
    expect(() => setCastPlaybackRateLogged(1.5)).not.toThrow()
    await flushMicrotasks()
    expect(mockDatadogLog.warn).toHaveBeenCalledTimes(1)
    expect(mockDatadogLog.warn).toHaveBeenCalledWith("cast.command_failed", {
      cast_command: "set_playback_rate",
      error_message: "Error: boom",
    })
  })

  it("logs a session-lookup rejection too, throws nothing", async () => {
    mockGetCurrentCastSession = jest.fn(() =>
      Promise.reject(new Error("no manager")),
    )
    expect(() => setCastPlaybackRateLogged(1.5)).not.toThrow()
    await flushMicrotasks()
    expect(mockDatadogLog.warn).toHaveBeenCalledTimes(1)
    expect(mockDatadogLog.warn).toHaveBeenCalledWith("cast.command_failed", {
      cast_command: "set_playback_rate",
      error_message: "Error: no manager",
    })
  })

  it("logs nothing on success", async () => {
    const client = sessionWithClient(makeClient())
    setCastPlaybackRateLogged(1.25)
    await flushMicrotasks()
    expect(client.setPlaybackRate).toHaveBeenCalledWith(1.25)
    expect(mockDatadogLog.warn).not.toHaveBeenCalled()
  })
})
