import {
  createPendingSession,
  DEFAULT_USER_CODE_FORMAT,
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

describe("user code formats", () => {
  const seq = (values: number[]) => {
    let i = 0
    return () => values[i++ % values.length]!
  }

  it("mints an 8-char consonant code grouped 4-4", () => {
    const s = createPendingSession({
      nowMs: 0,
      random: seq([0]),
      format: "letters",
    })
    expect(s.userCode).toBe("BBBB-BBBB")
    expect(s.format).toBe("letters")
    expect(s.userCode.replace(/-/g, "")).toHaveLength(8)
  })

  it("mints a 10-digit code grouped 3-3-4", () => {
    const s = createPendingSession({
      nowMs: 0,
      random: seq([0]),
      format: "numbers",
    })
    expect(s.userCode).toBe("000-000-0000")
    expect(s.format).toBe("numbers")
    expect(s.userCode.replace(/-/g, "")).toHaveLength(10)
  })

  it("defaults to letters when no format is given", () => {
    const s = createPendingSession({ nowMs: 0, random: seq([0]) })
    expect(s.format).toBe(DEFAULT_USER_CODE_FORMAT)
    expect(s.format).toBe("letters")
  })

  it("never emits a vowel or a lookalike in a letter code", () => {
    const s = createPendingSession({
      nowMs: 0,
      random: seq([0, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.99]),
      format: "letters",
    })
    expect(s.userCode).not.toMatch(/[AEIOU01]/)
  })

  it("emits only digits in a numeric code", () => {
    const s = createPendingSession({
      nowMs: 0,
      random: seq([0, 0.2, 0.4, 0.6, 0.8, 0.95]),
      format: "numbers",
    })
    expect(s.userCode.replace(/-/g, "")).toMatch(/^\d+$/)
  })

  it("groups by format and is idempotent on hyphenated input", () => {
    expect(formatUserCode("BXKDQWNM", "letters")).toBe("BXKD-QWNM")
    expect(formatUserCode("BXKD-QWNM", "letters")).toBe("BXKD-QWNM")
    expect(formatUserCode("0194507302", "numbers")).toBe("019-450-7302")
    expect(formatUserCode("019-450-7302", "numbers")).toBe("019-450-7302")
  })

  it("keeps any remainder past the declared groups", () => {
    expect(formatUserCode("BXKDQWNMZZ", "letters")).toBe("BXKD-QWNM-ZZ")
  })

  it("carries the code into the QR url", () => {
    const s = createPendingSession({
      nowMs: 0,
      random: seq([0]),
      format: "numbers",
    })
    expect(s.verificationUrl).toContain(encodeURIComponent(s.userCode))
  })
})
