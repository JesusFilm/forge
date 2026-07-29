import {
  createPendingSession,
  DEVICE_VERIFICATION_URL,
  formatUserCode,
  isSessionExpired,
  SESSION_TTL_MS,
  verificationUrlWithCode,
} from "./deviceAuthFlow"

describe("formatUserCode", () => {
  it("groups an 8-char code as XXXX-XXXX", () => {
    expect(formatUserCode("BXKDQWNM")).toBe("BXKD-QWNM")
  })

  it("is idempotent on already-hyphenated input", () => {
    expect(formatUserCode("BXKD-QWNM")).toBe("BXKD-QWNM")
  })

  it("leaves short fragments unhyphenated", () => {
    expect(formatUserCode("BXK")).toBe("BXK")
  })
})

describe("verificationUrlWithCode", () => {
  it("appends the code as user_code", () => {
    expect(
      verificationUrlWithCode("https://auth.example/device", "AB-CD"),
    ).toBe("https://auth.example/device?user_code=AB-CD")
  })

  it("URL-encodes reserved characters", () => {
    expect(
      verificationUrlWithCode("https://auth.example/device", "A&B"),
    ).toContain("user_code=A%26B")
  })
})

describe("createPendingSession", () => {
  const fixed = (value: number) => () => value

  it("builds a hyphenated 8-char code from the unambiguous charset", () => {
    const session = createPendingSession({ nowMs: 1_000, random: fixed(0) })
    expect(session.userCode).toBe("BBBB-BBBB")
  })

  it("clamps a random source that returns 1 into the charset", () => {
    const session = createPendingSession({ nowMs: 1_000, random: fixed(1) })
    expect(session.userCode).toBe("ZZZZ-ZZZZ")
  })

  it("targets the verification URL with the code pre-filled", () => {
    const session = createPendingSession({ nowMs: 0, random: fixed(0) })
    expect(session.verificationUrl).toBe(
      `${DEVICE_VERIFICATION_URL}?user_code=BBBB-BBBB`,
    )
  })

  it("expires exactly one TTL after creation", () => {
    const session = createPendingSession({ nowMs: 5_000, random: fixed(0) })
    expect(session.expiresAtMs).toBe(5_000 + SESSION_TTL_MS)
    expect(isSessionExpired(session, 5_000 + SESSION_TTL_MS - 1)).toBe(false)
    expect(isSessionExpired(session, 5_000 + SESSION_TTL_MS)).toBe(true)
  })
})
