/**
 * The picture-in-picture latch (KTD12).
 *
 * Two branches carry the weight and neither had a test: the dedupe, which is
 * what stops a repeated view prop from re-rendering every subscriber, and the
 * unsubscribe, which is what stops an unmounted window from being notified.
 * The latch is module scope, so a leak here follows the app for its whole life.
 */

import {
  isPictureInPictureActive,
  resetPictureInPictureLatch,
  setPictureInPictureActive,
  subscribeToPictureInPicture,
} from "../pipLatch"

beforeEach(() => {
  resetPictureInPictureLatch()
})

afterEach(() => {
  resetPictureInPictureLatch()
})

describe("the picture-in-picture latch", () => {
  it("starts inactive", () => {
    expect(isPictureInPictureActive()).toBe(false)
  })

  it("reports the state the view last set", () => {
    setPictureInPictureActive(true)
    expect(isPictureInPictureActive()).toBe(true)

    setPictureInPictureActive(false)
    expect(isPictureInPictureActive()).toBe(false)
  })

  it("notifies every subscriber on a real change", () => {
    const first = jest.fn()
    const second = jest.fn()
    subscribeToPictureInPicture(first)
    subscribeToPictureInPicture(second)

    setPictureInPictureActive(true)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("does not notify when the value repeats", () => {
    // The view fires onPictureInPictureStart per mount, and useSyncExternalStore
    // re-renders on every notification — a missing dedupe re-renders the window
    // and the host for a state that did not move.
    const listener = jest.fn()
    setPictureInPictureActive(true)
    subscribeToPictureInPicture(listener)

    setPictureInPictureActive(true)

    expect(listener).not.toHaveBeenCalled()
  })

  it("stops notifying after unsubscribe", () => {
    // The latch outlives every render, so a subscription the window never
    // released would be called for the rest of the app's life.
    const listener = jest.fn()
    const unsubscribe = subscribeToPictureInPicture(listener)

    unsubscribe()
    setPictureInPictureActive(true)

    expect(listener).not.toHaveBeenCalled()
  })

  it("keeps notifying the subscribers that remain", () => {
    // The anti-vacuous companion: an unsubscribe that cleared the whole set
    // would satisfy the case above.
    const staying = jest.fn()
    const leaving = jest.fn()
    subscribeToPictureInPicture(staying)
    subscribeToPictureInPicture(leaving)()

    setPictureInPictureActive(true)

    expect(staying).toHaveBeenCalledTimes(1)
    expect(leaving).not.toHaveBeenCalled()
  })

  it("holds the pass to the subscribers present when it began", () => {
    // What the copy before the loop buys. Iterating the live Set visits a
    // listener added mid-pass, so a re-subscribing subscriber recurses. (A
    // self-releasing one does NOT discriminate — deleting mid-iteration is safe.)
    const seen: string[] = []
    subscribeToPictureInPicture(() => {
      seen.push("outer")
      subscribeToPictureInPicture(() => seen.push("added-mid-pass"))
    })

    setPictureInPictureActive(true)

    expect(seen).toEqual(["outer"])
  })

  it("resets both the state and the subscriptions", () => {
    const listener = jest.fn()
    subscribeToPictureInPicture(listener)
    setPictureInPictureActive(true)

    resetPictureInPictureLatch()

    expect(isPictureInPictureActive()).toBe(false)
    setPictureInPictureActive(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
