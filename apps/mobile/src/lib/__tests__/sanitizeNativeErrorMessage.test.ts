import { sanitizeNativeErrorMessage } from "../downloadErrors"

describe("sanitizeNativeErrorMessage (R25)", () => {
  it("passes a plain native message through untouched", () => {
    expect(sanitizeNativeErrorMessage("The network connection was lost.")).toBe(
      "The network connection was lost.",
    )
  })

  it("redacts a signed download URL so it can't leak into logs", () => {
    expect(
      sanitizeNativeErrorMessage(
        "failed for https://cdn.example/media.mp4?token=secret",
      ),
    ).toBe("failed for <url>")
  })

  it("redacts a bare filesystem path", () => {
    expect(
      sanitizeNativeErrorMessage("cannot write /var/mobile/offline/x.mp4"),
    ).toBe("cannot write <path>")
  })

  it("caps length at 200 chars with an ellipsis", () => {
    const long = "e".repeat(500)
    const out = sanitizeNativeErrorMessage(long)
    expect(out.endsWith("…")).toBe(true)
    expect(out.length).toBe(201)
  })

  it("tolerates an empty/undefined message", () => {
    expect(sanitizeNativeErrorMessage("")).toBe("")
    expect(sanitizeNativeErrorMessage(undefined as unknown as string)).toBe("")
  })
})
