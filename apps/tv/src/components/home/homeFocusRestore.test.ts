import {
  createHomeFocusRestore,
  isHomeRestoreCancellationInput,
} from "./homeFocusRestore"

const curated = {
  id: "happy",
  cards: ["one", "two", "three", "four"].map((id) => ({ id })),
}
const selected = { sectionId: "happy", cardId: "four" }
describe("Home logical return focus", () => {
  it("leaves first mount to Search", () => {
    const memory = createHomeFocusRestore()
    expect(memory.enter()).toBe(false)
    expect(memory.resolve([curated])).toBeNull()
  })
  it("keeps the FOURTH card while async shelves insert before its section", () => {
    const memory = createHomeFocusRestore()
    memory.capture(selected)
    memory.blur()
    expect(memory.capture({ sectionId: "happy", cardId: "one" })).toBe(false)
    expect(memory.enter()).toBe(true)
    expect(memory.capture({ sectionId: "happy", cardId: "one" })).toBe(false)
    expect(memory.resolve([curated])).toEqual({ ...selected, rowIndex: 1 })
    expect(
      memory.resolve([{ id: "continue", cards: [{ id: "four" }] }, curated]),
    ).toEqual({ ...selected, rowIndex: 2 })
    expect(memory.isPending()).toBe(true)
    expect(memory.capture(selected)).toBe(false)
    memory.settle()
    expect(memory.capture(selected)).toBe(true)
    expect(memory.isPending()).toBe(false)
  })
  it("resolves unchanged sections without changing the selected card", () => {
    const memory = createHomeFocusRestore()
    memory.capture(selected)
    memory.blur()
    memory.enter()
    expect(memory.resolve([curated])).toEqual({ ...selected, rowIndex: 1 })
  })
  it("does not substitute the first card when the target disappears", () => {
    const memory = createHomeFocusRestore()
    memory.capture(selected)
    memory.blur()
    memory.enter()
    expect(memory.resolve([{ ...curated, cards: [{ id: "one" }] }])).toBeNull()
    expect(memory.resolve([])).toBeNull()
  })
  it.each(["Search", "Hero"])(
    "clears logical rail memory when %s captures non-card focus",
    () => {
      const memory = createHomeFocusRestore()
      memory.capture(selected)
      expect(memory.capture(null)).toBe(true)
      memory.blur()
      expect(memory.enter()).toBe(false)
      expect(memory.resolve([curated])).toBeNull()
      expect(memory.isRestoring(selected)).toBe(false)
    },
  )
  it("cancels pending work on blur and preserves the last real target", () => {
    const memory = createHomeFocusRestore()
    memory.capture(selected)
    memory.blur()
    memory.enter()
    memory.blur()
    expect(memory.resolve([curated])).toBeNull()
    expect(memory.capture(null)).toBe(false)
    memory.enter()
    expect(memory.resolve([curated])).toEqual({ ...selected, rowIndex: 1 })
  })
  it("allows explicit user navigation to cancel a delayed restore", () => {
    const memory = createHomeFocusRestore()
    memory.capture(selected)
    memory.blur()
    memory.enter()
    memory.cancel()
    expect(memory.capture({ sectionId: "happy", cardId: "one" })).toBe(true)
    expect(memory.resolve([curated])).toBeNull()
  })
})

describe("Home restoration remote input", () => {
  const returningMemory = () => {
    const memory = createHomeFocusRestore()
    memory.capture(selected)
    memory.blur()
    memory.enter()
    return memory
  }
  const receive = (
    memory: ReturnType<typeof createHomeFocusRestore>,
    platform: string,
    event: { eventType: string; eventKeyAction: number },
  ) => {
    if (isHomeRestoreCancellationInput(platform, event)) memory.cancel()
  }
  it.each(["back", "menu"])(
    "keeps Fourth pending through Android returning %s release and orphan D-pad releases",
    (eventType) => {
      const memory = returningMemory()
      receive(memory, "android", { eventType, eventKeyAction: 1 })
      expect(memory.resolve([curated])).toEqual({ ...selected, rowIndex: 1 })
      receive(memory, "android", { eventType: "right", eventKeyAction: 1 })
      expect(memory.isRestoring(selected)).toBe(true)
      receive(memory, "android", { eventType: "right", eventKeyAction: 0 })
      expect(memory.isPending()).toBe(false)
      expect(memory.resolve([curated])).toBeNull()
    },
  )
  it.each(["menu", "select"])(
    "honors genuine tvOS %s input with action1",
    (eventType) => {
      const memory = returningMemory()
      receive(memory, "ios", { eventType, eventKeyAction: 1 })
      expect(memory.isPending()).toBe(false)
    },
  )
  it("ignores non-navigation events and missing events", () => {
    expect(
      isHomeRestoreCancellationInput("android", {
        eventType: "focus",
        eventKeyAction: 0,
      }),
    ).toBe(false)
    expect(isHomeRestoreCancellationInput("ios", null)).toBe(false)
  })
})
