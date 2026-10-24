import { createUpNextChainLatch } from "./upNextChain"

describe("createUpNextChainLatch", () => {
  it("starts unmarked — a plain player close is a viewer exit", () => {
    const latch = createUpNextChainLatch()
    expect(latch.consume()).toBe(false)
  })

  it("consume returns true exactly once per mark", () => {
    const latch = createUpNextChainLatch()
    latch.mark()
    expect(latch.consume()).toBe(true)
    // A second close without a new mark is a genuine exit again.
    expect(latch.consume()).toBe(false)
  })

  it("re-marking after consumption arms the latch again (hop 3+)", () => {
    const latch = createUpNextChainLatch()
    latch.mark()
    expect(latch.consume()).toBe(true)
    latch.mark()
    expect(latch.consume()).toBe(true)
  })

  // Unmount-before-effect ordering: the next playback landed without the
  // pass-through screen ever consuming the mark.
  it("clear() drops an unconsumed mark", () => {
    const latch = createUpNextChainLatch()
    latch.mark()
    latch.clear()
    expect(latch.consume()).toBe(false)
  })
})
