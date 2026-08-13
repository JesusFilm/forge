import {
  classifyNavigationAction,
  subscribeToBackIntent,
  type NavigationActionSource,
} from "../navigationEvents"

function fakeSource() {
  let emit: ((payload: unknown) => void) | null = null
  let removed = false
  const source: NavigationActionSource = {
    addListener: (_event, listener) => {
      emit = listener
      return () => {
        removed = true
      }
    },
  }
  return {
    source,
    fire: (payload: unknown) => emit?.(payload),
    wasRemoved: () => removed,
  }
}

describe("classifyNavigationAction", () => {
  it.each(["GO_BACK", "POP", "POP_TO_TOP"])("reads %s as back", (type) => {
    expect(classifyNavigationAction({ data: { action: { type } } })).toBe(
      "back",
    )
  })

  it("reads a forward push as other", () => {
    expect(
      classifyNavigationAction({ data: { action: { type: "NAVIGATE" } } }),
    ).toBe("other")
  })

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "GO_BACK"],
    ["an empty object", {}],
    ["a missing action", { data: {} }],
    ["a null action", { data: { action: null } }],
    ["a non-string type", { data: { action: { type: 7 } } }],
  ])("treats %s as other rather than throwing", (_label, payload) => {
    // This reads an explicitly unstable stream. Guessing "back" on a malformed
    // payload would shrink the player on a forward push.
    expect(() => classifyNavigationAction(payload)).not.toThrow()
    expect(classifyNavigationAction(payload)).toBe("other")
  })
})

describe("subscribeToBackIntent", () => {
  it("reports a back action", () => {
    const listener = jest.fn()
    const { source, fire } = fakeSource()
    subscribeToBackIntent(source, listener)

    fire({ data: { action: { type: "GO_BACK" } } })

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("does not report a forward push", () => {
    const listener = jest.fn()
    const { source, fire } = fakeSource()
    subscribeToBackIntent(source, listener)

    fire({ data: { action: { type: "NAVIGATE" } } })

    expect(listener).not.toHaveBeenCalled()
  })

  it("unsubscribes through the returned disposer", () => {
    const { source, wasRemoved } = fakeSource()
    subscribeToBackIntent(source, jest.fn())()
    expect(wasRemoved()).toBe(true)
  })

  it("accepts a subscription object with remove() instead of a function", () => {
    // React Navigation has returned both shapes across versions.
    let removed = false
    const source = {
      addListener: () => ({
        remove: () => {
          removed = true
        },
      }),
    } as unknown as NavigationActionSource

    subscribeToBackIntent(source, jest.fn())()

    expect(removed).toBe(true)
  })

  it("reports nothing when the stream is unavailable", () => {
    // The documented fallback: a router upgrade that renames the unstable
    // event must cost the pre-pop arming, not crash the app.
    const listener = jest.fn()
    expect(() => subscribeToBackIntent(null, listener)()).not.toThrow()
    expect(() => subscribeToBackIntent(undefined, listener)()).not.toThrow()
    expect(() =>
      subscribeToBackIntent({} as NavigationActionSource, listener)(),
    ).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
  })

  it("survives a listener API that throws on subscribe", () => {
    const source = {
      addListener: () => {
        throw new Error("unstable_action removed in this version")
      },
    } as unknown as NavigationActionSource

    expect(() => subscribeToBackIntent(source, jest.fn())()).not.toThrow()
  })

  it("survives a disposer that throws because the container already went", () => {
    const source = {
      addListener: () => () => {
        throw new Error("container unmounted")
      },
    } as unknown as NavigationActionSource

    expect(() => subscribeToBackIntent(source, jest.fn())()).not.toThrow()
  })
})
