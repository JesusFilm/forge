/**
 * The native splash's hold and release (U5).
 *
 * Both calls run on paths where a throw would mask the surface they exist to
 * reveal — the two boot-error panels — so "never throws" is the contract, and
 * "reports when it fails" is what stops a stuck flat field being invisible.
 */

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: jest.fn(() => Promise.resolve(true)),
}))
jest.mock("../../datadog", () => ({
  datadogLog: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

import * as SplashScreen from "expo-splash-screen"

import { datadogLog } from "../../datadog"
import {
  NATIVE_SPLASH_BACKSTOP_MS,
  hideNativeSplashOnce,
  preventNativeSplashAutoHide,
  resetNativeSplashState,
} from "../nativeSplash"
// The bound below is the sum of the three budgets, so it has to be BUILT from
// them. Copying their values freezes the assertion while the real invariant
// moves, and the backstop would then cut a healthy launch short with the test
// still green.
import { SPLASH_EXIT_FADE_MS } from "../../../components/splash/SplashHost"
import {
  SPLASH_CEILING_MS,
  SPLASH_SKIP_DECISION_BUDGET_MS,
} from "../splashSession"

const prevent = SplashScreen.preventAutoHideAsync as jest.Mock
const hide = SplashScreen.hideAsync as jest.Mock
const warn = datadogLog.warn as jest.Mock

/** Datadog silently DROPS an attribute using one of its own reserved names. */
const RESERVED = ["source", "host", "service", "status", "message", "trace_id"]

beforeEach(() => {
  jest.clearAllMocks()
  resetNativeSplashState()
  prevent.mockImplementation(() => Promise.resolve(true))
  hide.mockImplementation(() => Promise.resolve(true))
})

describe("the native splash hold", () => {
  it("holds the splash", () => {
    preventNativeSplashAutoHide()
    expect(prevent).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it("reports a rejected hold without throwing", async () => {
    prevent.mockImplementation(() => Promise.reject(new Error("no module")))
    expect(() => preventNativeSplashAutoHide()).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(warn).toHaveBeenCalledWith(
      "splash_native_call_failed",
      expect.objectContaining({ splash_call: "prevent" }),
    )
  })

  it("reports a synchronous throw without throwing", () => {
    prevent.mockImplementation(() => {
      throw new Error("bridge down")
    })
    expect(() => preventNativeSplashAutoHide()).not.toThrow()
    expect(warn).toHaveBeenCalledWith(
      "splash_native_call_failed",
      expect.objectContaining({ splash_call: "prevent" }),
    )
  })
})

describe("the native splash release", () => {
  it("releases once, however many times it is asked", () => {
    hideNativeSplashOnce()
    hideNativeSplashOnce()
    hideNativeSplashOnce()
    // Both error panels and the host can all reach this call on one launch.
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it("reports a rejected release without throwing", async () => {
    hide.mockImplementation(() => Promise.reject(new Error("not held")))
    expect(() => hideNativeSplashOnce()).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    // A release that fails leaves a flat field over a working app, with
    // nothing on screen to say so. This log is the only signal.
    expect(warn).toHaveBeenCalledWith(
      "splash_native_call_failed",
      expect.objectContaining({
        splash_call: "hide",
        error_message: "not held",
      }),
    )
  })

  it("reports a synchronous throw without throwing", () => {
    hide.mockImplementation(() => {
      throw new Error("bridge down")
    })
    expect(() => hideNativeSplashOnce()).not.toThrow()
    expect(warn).toHaveBeenCalledWith(
      "splash_native_call_failed",
      expect.objectContaining({ splash_call: "hide" }),
    )
  })

  it("stays silent when telemetry itself throws", () => {
    hide.mockImplementation(() => {
      throw new Error("bridge down")
    })
    warn.mockImplementation(() => {
      throw new Error("datadog down")
    })
    expect(() => hideNativeSplashOnce()).not.toThrow()
  })
})

describe("the unconditional backstop", () => {
  // Taking the hold removes the OS's own auto-hide, so every route to the
  // release now runs in JavaScript. A person left under a flat field with no
  // route taken has no way forward at all.
  it("releases the splash when nothing else ever does", () => {
    jest.useFakeTimers()
    try {
      preventNativeSplashAutoHide()
      expect(hide).not.toHaveBeenCalled()

      jest.advanceTimersByTime(NATIVE_SPLASH_BACKSTOP_MS)
      expect(hide).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        "splash_native_backstop_fired",
        expect.any(Object),
      )
    } finally {
      jest.useRealTimers()
    }
  })

  it("does not fire after the ordinary release", () => {
    jest.useFakeTimers()
    try {
      preventNativeSplashAutoHide()
      hideNativeSplashOnce()
      expect(hide).toHaveBeenCalledTimes(1)

      jest.advanceTimersByTime(NATIVE_SPLASH_BACKSTOP_MS * 2)
      expect(hide).toHaveBeenCalledTimes(1)
      expect(warn).not.toHaveBeenCalledWith(
        "splash_native_backstop_fired",
        expect.any(Object),
      )
    } finally {
      jest.useRealTimers()
    }
  })

  it("outlasts the longest legitimate path to the release", () => {
    // Skip budget, then the ceiling, then the exit fade. Shorter than this and
    // the backstop would cut a healthy launch short.
    expect(NATIVE_SPLASH_BACKSTOP_MS).toBeGreaterThan(
      SPLASH_SKIP_DECISION_BUDGET_MS + SPLASH_CEILING_MS + SPLASH_EXIT_FADE_MS,
    )
  })
})

describe("the failure log's attribute names", () => {
  it("avoids every name Datadog reserves", async () => {
    hide.mockImplementation(() => Promise.reject(new Error("not held")))
    hideNativeSplashOnce()
    await Promise.resolve()
    await Promise.resolve()

    const attributes = warn.mock.calls[0]?.[1] ?? {}
    expect(Object.keys(attributes).length).toBeGreaterThan(0)
    // A reserved name is dropped on ingest with no error, so the log looks
    // healthy and the facet is simply never there.
    for (const key of Object.keys(attributes)) {
      expect(RESERVED).not.toContain(key)
    }
  })
})
