import { createSessionEndRegistry } from "../endRegistry"

describe("createSessionEndRegistry", () => {
  it("delivers the reason to the registered listener", () => {
    const registry = createSessionEndRegistry()
    const listener = jest.fn()
    registry.register(listener)

    registry.end("dismissed")

    expect(listener).toHaveBeenCalledWith("dismissed")
  })

  it("does nothing when no player has registered", () => {
    const registry = createSessionEndRegistry()

    expect(() => registry.end("signout")).not.toThrow()
  })

  it("stops delivering after the release runs", () => {
    const registry = createSessionEndRegistry()
    const listener = jest.fn()
    const release = registry.register(listener)

    release()
    registry.end("ended")

    expect(listener).not.toHaveBeenCalled()
  })

  it("keeps the successor when a departing session releases late", () => {
    // React can run a departing subtree's cleanup after its replacement has
    // already mounted. An unconditional `active = null` would silence the live
    // player, and the next dismiss would report as an abandonment.
    const registry = createSessionEndRegistry()
    const departing = jest.fn()
    const releaseDeparting = registry.register(departing)
    const successor = jest.fn()
    registry.register(successor)

    releaseDeparting()
    registry.end("dismissed")

    expect(successor).toHaveBeenCalledWith("dismissed")
    expect(departing).not.toHaveBeenCalled()
  })

  it("swallows a throwing listener so the session still ends", () => {
    const registry = createSessionEndRegistry()
    registry.register(() => {
      throw new Error("flush failed")
    })

    expect(() => registry.end("failed")).not.toThrow()
  })
})
