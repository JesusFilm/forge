import { describe, expect, it } from "vitest"
import {
  isAutoplayBlockedError,
  isPlaybackAbortError,
} from "@/lib/autoplay-refusal"

describe("isAutoplayBlockedError", () => {
  it("treats a DOMException named NotAllowedError as a refusal", () => {
    expect(
      isAutoplayBlockedError(new DOMException("denied", "NotAllowedError")),
    ).toBe(true)
  })

  it("treats an object named AutoplayNotAllowed as a refusal", () => {
    expect(isAutoplayBlockedError({ name: "AutoplayNotAllowed" })).toBe(true)
  })

  it("does not read the message: a one-argument DOMException is named Error", () => {
    // `new DOMException("NotAllowedError")` sets the MESSAGE; its name is
    // "Error". Fixtures built that way exercise the generic path, not this one.
    expect(isAutoplayBlockedError(new DOMException("NotAllowedError"))).toBe(
      false,
    )
  })

  it("does not treat an abort as a refusal", () => {
    expect(
      isAutoplayBlockedError(new DOMException("interrupted", "AbortError")),
    ).toBe(false)
  })

  it.each([new Error("boom"), null, undefined, "NotAllowedError", 0])(
    "rejects %s",
    (value) => {
      expect(isAutoplayBlockedError(value)).toBe(false)
    },
  )
})

describe("isPlaybackAbortError", () => {
  it("treats a DOMException named AbortError as an abort", () => {
    expect(
      isPlaybackAbortError(new DOMException("interrupted", "AbortError")),
    ).toBe(true)
  })

  it("does not treat a refusal as an abort", () => {
    expect(
      isPlaybackAbortError(new DOMException("denied", "NotAllowedError")),
    ).toBe(false)
  })

  it.each([new Error("AbortError"), null, undefined, "AbortError"])(
    "rejects %s",
    (value) => {
      expect(isPlaybackAbortError(value)).toBe(false)
    },
  )
})
