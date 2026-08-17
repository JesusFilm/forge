/**
 * The router wrapper reads an `unstable_`-prefixed API, so this suite pins both
 * halves of KTD4's contract: what it reports when the stream is there, and that
 * it stays quiet and non-throwing when it is not.
 *
 * expo-router is mocked as a MUTABLE module object — the wrapper requires it
 * lazily on every call, so a case can remove the stream between calls without
 * `jest.resetModules()`. The repo forbids importing expo-router unmocked.
 */

type ActionCallback = (event: { actionType?: string }) => void

const mockExpoRouter: {
  unstable_navigationEvents?: {
    addListener: (type: string, callback: ActionCallback) => () => void
  }
} = {}

jest.mock("expo-router", () => mockExpoRouter)

import {
  isNavigationBackStreamAvailable,
  subscribeToNavigationBack,
} from "../navigationEvents"

/** Stands in for expo-router's own registry: one set of callbacks per type. */
function installStream() {
  const callbacks = new Map<string, Set<ActionCallback>>()
  mockExpoRouter.unstable_navigationEvents = {
    addListener: (type, callback) => {
      let set = callbacks.get(type)
      if (set == null) {
        set = new Set()
        callbacks.set(type, set)
      }
      set.add(callback)
      return () => set.delete(callback)
    },
  }
  return {
    emit(actionType: string) {
      for (const callback of [...(callbacks.get("actionDispatched") ?? [])])
        callback({ actionType })
    },
    listenerCount: () => callbacks.get("actionDispatched")?.size ?? 0,
  }
}

beforeEach(() => {
  delete mockExpoRouter.unstable_navigationEvents
})

describe("subscribeToNavigationBack", () => {
  it.each(["GO_BACK", "POP", "POP_TO_TOP"])(
    "reports the %s action",
    (actionType) => {
      const stream = installStream()
      const listener = jest.fn()

      subscribeToNavigationBack(listener)
      stream.emit(actionType)

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith({ actionType })
    },
  )

  it("ignores actions that do not pop the screen", () => {
    const stream = installStream()
    const listener = jest.fn()

    subscribeToNavigationBack(listener)
    for (const actionType of ["NAVIGATE", "PUSH", "REPLACE", "PRELOAD"]) {
      stream.emit(actionType)
    }

    expect(listener).not.toHaveBeenCalled()
  })

  it("stops reporting once unsubscribed", () => {
    const stream = installStream()
    const listener = jest.fn()

    const unsubscribe = subscribeToNavigationBack(listener)
    unsubscribe()
    stream.emit("GO_BACK")

    expect(listener).not.toHaveBeenCalled()
    expect(stream.listenerCount()).toBe(0)
  })

  it("reports nothing and stays safe when the router drops the stream", () => {
    const listener = jest.fn()

    expect(isNavigationBackStreamAvailable()).toBe(false)
    const unsubscribe = subscribeToNavigationBack(listener)

    expect(listener).not.toHaveBeenCalled()
    expect(() => unsubscribe()).not.toThrow()
  })

  it("reports nothing when the stream is present but rejects the subscription", () => {
    // An upgrade that keeps the export and changes the event names: the throw
    // must degrade to silence, never reach a render.
    mockExpoRouter.unstable_navigationEvents = {
      addListener: () => {
        throw new Error("Unsupported event type: actionDispatched")
      },
    }
    const listener = jest.fn()

    expect(isNavigationBackStreamAvailable()).toBe(true)
    const unsubscribe = subscribeToNavigationBack(listener)

    expect(listener).not.toHaveBeenCalled()
    expect(() => unsubscribe()).not.toThrow()
  })

  it("reports availability again once the stream returns", () => {
    // Anti-vacuous: the unavailable cases above must fail for the missing
    // stream, not because the detector always answers false.
    expect(isNavigationBackStreamAvailable()).toBe(false)
    installStream()
    expect(isNavigationBackStreamAvailable()).toBe(true)
  })
})
