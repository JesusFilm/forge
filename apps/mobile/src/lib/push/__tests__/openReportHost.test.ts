/**
 * The tap path's open report (R23, KTD7). A failure is deferred and never
 * retried, with one exception: a viewer handle Admin refuses records no open,
 * so the host re-checks the handle and reports once more without it.
 */

jest.mock("../../datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock("../openReportClient", () => ({ reportPushOpen: jest.fn() }))
jest.mock("../viewerHandle", () => ({
  readPushViewerHandle: jest.fn(),
  recheckPushViewerHandle: jest.fn(async () => undefined),
}))

import { datadogLog } from "../../datadog"
import { reportPushOpen } from "../openReportClient"
import { reportPushOpenInBackground } from "../openReportHost"
import { readPushViewerHandle, recheckPushViewerHandle } from "../viewerHandle"

const report = jest.mocked(reportPushOpen)
const readHandle = jest.mocked(readPushViewerHandle)
const recheck = jest.mocked(recheckPushViewerHandle)
const info = jest.mocked(datadogLog.info)

const NONCE = "aBcD1234_-efGHijkLMNopQRstuVWXyz0123456789A"
const HANDLE = { viewerToken: "v".repeat(43), sessionToken: "s".repeat(43) }

/** The shape `readPushFailure` reads off a rejected mutation. */
function refusal(code: string, pushCode: string | null) {
  return Object.assign(new Error(`push_${code.toLowerCase()}`), {
    code,
    definitive: true,
    pushCode,
  })
}

/** The host returns at once, so a case waits for its detached report. */
async function settle(): Promise<void> {
  for (let round = 0; round < 12; round += 1) await Promise.resolve()
}

beforeEach(() => {
  // A reset, not a clear: a queued answer one case did not use must not leak
  // into the next case.
  jest.resetAllMocks()
  readHandle.mockResolvedValue(HANDLE)
  recheck.mockResolvedValue(undefined)
})

it("re-checks a refused handle and reports the open once more without it", async () => {
  report
    .mockRejectedValueOnce(refusal("UNAUTHENTICATED", "viewer_handle_rejected"))
    .mockResolvedValueOnce("STORED")

  reportPushOpenInBackground(NONCE)
  await settle()

  expect(report).toHaveBeenCalledTimes(2)
  expect(report).toHaveBeenNthCalledWith(1, { nonce: NONCE, viewer: HANDLE })
  expect(report).toHaveBeenNthCalledWith(2, { nonce: NONCE, viewer: null })
  expect(recheck).toHaveBeenCalledTimes(1)
  expect(recheck).toHaveBeenCalledWith(HANDLE.viewerToken)
  expect(info).toHaveBeenCalledWith("push.open_report", {
    outcome: "STORED",
    has_viewer: false,
  })
})

it("keeps every other failure deferred, with no second report", async () => {
  report.mockRejectedValueOnce(refusal("UNAUTHENTICATED", "admission_denied"))

  reportPushOpenInBackground(NONCE)
  await settle()

  expect(report).toHaveBeenCalledTimes(1)
  expect(recheck).not.toHaveBeenCalled()
  expect(info).toHaveBeenCalledWith("push.open_report_failed", {
    code: "UNAUTHENTICATED",
    push_code: "admission_denied",
    deferred: true,
  })
})

it("does not report again when the refused report carried no handle", async () => {
  readHandle.mockResolvedValue(null)
  report.mockRejectedValueOnce(
    refusal("UNAUTHENTICATED", "viewer_handle_rejected"),
  )

  reportPushOpenInBackground(NONCE)
  await settle()

  expect(report).toHaveBeenCalledTimes(1)
  expect(recheck).not.toHaveBeenCalled()
})

it("defers a second failure without throwing into the tap handler", async () => {
  report
    .mockRejectedValueOnce(refusal("UNAUTHENTICATED", "viewer_handle_rejected"))
    .mockRejectedValueOnce(refusal("TIMEOUT", null))

  expect(() => reportPushOpenInBackground(NONCE)).not.toThrow()
  await settle()

  expect(report).toHaveBeenCalledTimes(2)
  expect(info).toHaveBeenCalledWith("push.open_report_failed", {
    code: "TIMEOUT",
    push_code: null,
    deferred: true,
  })
})
