import { createFocusMemory } from "./focusMemory"

// Minimal stand-in for a react-native-tvos host node: only requestTVFocus matters.
const node = (id: string) => {
  const calls: string[] = []
  return {
    id,
    calls,
    requestTVFocus: () => calls.push(id),
  }
}

describe("createFocusMemory", () => {
  it("restore() is a no-op returning false before anything is captured", () => {
    const mem = createFocusMemory()
    expect(mem.restore()).toBe(false)
  })

  it("restore() focuses the captured node and returns true", () => {
    const mem = createFocusMemory()
    const a = node("a")
    mem.capture(a as never)
    expect(mem.restore()).toBe(true)
    expect(a.calls).toEqual(["a"])
  })

  it("keeps the most recently captured non-null node", () => {
    const mem = createFocusMemory()
    const a = node("a")
    const b = node("b")
    mem.capture(a as never)
    mem.capture(b as never)
    mem.restore()
    expect(a.calls).toEqual([])
    expect(b.calls).toEqual(["b"])
  })

  it("ignores null captures so a blur never wipes the last real target", () => {
    const mem = createFocusMemory()
    const a = node("a")
    mem.capture(a as never)
    mem.capture(null)
    expect(mem.restore()).toBe(true)
    expect(a.calls).toEqual(["a"])
  })

  it("restore() can be called repeatedly", () => {
    const mem = createFocusMemory()
    const a = node("a")
    mem.capture(a as never)
    mem.restore()
    mem.restore()
    expect(a.calls).toEqual(["a", "a"])
  })

  it("tolerates a node missing requestTVFocus (detached) and returns true", () => {
    const mem = createFocusMemory()
    mem.capture({} as never)
    expect(() => mem.restore()).not.toThrow()
    expect(mem.restore()).toBe(true)
  })
})
