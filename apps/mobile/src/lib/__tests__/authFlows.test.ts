import { classifySignInFailure } from "../authFlows"

describe("classifySignInFailure", () => {
  it("treats unknown failures as retryable", () => {
    expect(classifySignInFailure(new Error("sheet exploded"))).toBe("retryable")
    expect(classifySignInFailure(undefined)).toBe("retryable")
  })

  it("treats a cancel-shaped provider code as retryable — hosted cancels settle session-less, they never throw", () => {
    expect(classifySignInFailure({ code: "ERR_REQUEST_CANCELED" })).toBe(
      "retryable",
    )
  })
})
