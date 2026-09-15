import { describe, expect, it, vi } from "vitest"

import { createStableActionKey } from "./stable-action-key"

describe("createStableActionKey", () => {
  it("reuses one UUID after transport failure and rotates after confirmed success", () => {
    const generate = vi
      .fn<() => `${string}-${string}-${string}-${string}-${string}`>()
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002")
    const action = createStableActionKey(generate)

    const firstAttempt = action.current()
    // A lost response does not complete the logical action.
    const retry = action.current()

    expect(retry).toBe(firstAttempt)
    expect(generate).toHaveBeenCalledTimes(1)

    action.complete()
    expect(action.current()).toBe("00000000-0000-4000-8000-000000000002")
    expect(generate).toHaveBeenCalledTimes(2)
  })
})
