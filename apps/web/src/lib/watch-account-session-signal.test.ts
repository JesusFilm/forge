import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  publishWatchAccountSessionSignal,
  resetWatchAccountSessionSignalForTests,
  subscribeToWatchAccountSession,
} from "./watch-account-session-signal"

describe("watch account session signal", () => {
  beforeEach(resetWatchAccountSessionSignalForTests)

  it("replays the latest minimal state without exposing account details", () => {
    publishWatchAccountSessionSignal({ status: "authenticated" })
    const listener = vi.fn()

    subscribeToWatchAccountSession(listener)

    expect(listener).toHaveBeenCalledWith({ status: "authenticated" })
  })

  it("stops notifying an unsubscribed listener", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToWatchAccountSession(listener)
    unsubscribe()

    publishWatchAccountSessionSignal({ status: "unauthenticated" })

    expect(listener).not.toHaveBeenCalled()
  })
})
