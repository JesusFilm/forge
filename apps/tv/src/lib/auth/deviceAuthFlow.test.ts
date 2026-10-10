import {
  DEVICE_VERIFICATION_URL,
  displayVerificationUrl,
  formatUserCode,
  isSessionExpired,
  verificationUrlWithCode,
  type DeviceAuthSession,
} from "./deviceAuthFlow"

const session = (expiresAtMs: number): DeviceAuthSession => ({
  userCode: "019-450-7302",
  verificationUrl: `${DEVICE_VERIFICATION_URL}?user_code=019-450-7302`,
  expiresAtMs,
})

describe("formatUserCode", () => {
  it("groups the server's ten-digit code as XXX-XXX-XXXX", () => {
    expect(formatUserCode("0194507302")).toBe("019-450-7302")
  })

  it("is idempotent on already-hyphenated input", () => {
    expect(formatUserCode("019-450-7302")).toBe("019-450-7302")
  })

  it("leaves short fragments unhyphenated", () => {
    expect(formatUserCode("019")).toBe("019")
  })

  it("keeps any remainder past the declared groups rather than truncating", () => {
    // A server that lengthens the code must degrade to an ugly display, never
    // to a code the phone will reject.
    expect(formatUserCode("019450730212")).toBe("019-450-7302-12")
  })

  it("never drops a character", () => {
    const raw = "0194507302"
    expect(formatUserCode(raw).replace(/-/g, "")).toBe(raw)
  })
})

describe("verificationUrlWithCode", () => {
  it("appends the code as user_code", () => {
    expect(
      verificationUrlWithCode("https://auth.example/device", "019-450-7302"),
    ).toBe("https://auth.example/device?user_code=019-450-7302")
  })

  it("URL-encodes reserved characters", () => {
    expect(
      verificationUrlWithCode("https://auth.example/device", "A&B"),
    ).toContain("user_code=A%26B")
  })
})

describe("displayVerificationUrl", () => {
  it("strips the scheme for the on-screen caption", () => {
    expect(displayVerificationUrl("https://auth.jesusfilm.org/device")).toBe(
      "auth.jesusfilm.org/device",
    )
  })

  it("never prints the user code carried by verification_uri_complete", () => {
    const caption = displayVerificationUrl(
      "https://auth.jesusfilm.org/device?user_code=0194507302",
    )
    expect(caption).toBe("auth.jesusfilm.org/device")
    expect(caption).not.toContain("0194507302")
    expect(caption).not.toContain("user_code")
  })

  it("drops a fragment-carried code too", () => {
    expect(
      displayVerificationUrl(
        "https://auth.jesusfilm.org/device#user_code=0194507302",
      ),
    ).toBe("auth.jesusfilm.org/device")
  })

  it("handles a scheme-less URL unchanged", () => {
    expect(displayVerificationUrl("auth.jesusfilm.org/device")).toBe(
      "auth.jesusfilm.org/device",
    )
  })
})

describe("isSessionExpired", () => {
  it("flips exactly at the deadline", () => {
    const s = session(5_000)
    expect(isSessionExpired(s, 4_999)).toBe(false)
    expect(isSessionExpired(s, 5_000)).toBe(true)
    expect(isSessionExpired(s, 5_001)).toBe(true)
  })
})
