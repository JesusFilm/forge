import {
  feedbackSimulatorEnabled,
  simulatorFeedbackUrl,
} from "./feedbackSimulator"
import { feedbackUrl } from "./feedbackUrl"

describe("simulator feedback gate", () => {
  it.each([undefined, "", "false", "1", "TRUE", "true"])(
    "requires explicit true plus every independent device/build guard (%p)",
    (flag) => {
      for (const development of [false, true])
        for (const tv of [false, true])
          for (const nativeSimulator of [false, true])
            expect(
              feedbackSimulatorEnabled({
                flag,
                development,
                tv,
                nativeSimulator,
              }),
            ).toBe(flag === "true" && development && tv && nativeSimulator)
    },
  )
})

describe("local feedback destination", () => {
  it.each(["10.20.30.40", "172.16.0.8", "172.31.255.10", "192.168.1.8"])(
    "allows a private receiver with sanitized phone context (%s)",
    (host) => {
      const base = `http://${host}:3210/tv/local`
      const url = simulatorFeedbackUrl(base, {
        platform: "apple-tv",
        screen: "player",
        filmTitle: "JESUS & friends",
        timestamp: "1:02:03",
      })
      expect(url).toBe(
        `${base}?platform=apple-tv&screen=player&filmTitle=JESUS%20%26%20friends&timestamp=1%3A02%3A03`,
      )
      expect(new URL(url!).hash).toBe("")
      expect(feedbackUrl(base, { platform: "apple-tv" })).toBeNull()
    },
  )

  it("rejects HTTPS local receivers without changing the normal HTTPS URL policy", () => {
    expect(
      simulatorFeedbackUrl("https://10.1.2.3:3210/tv/local", {
        platform: "android-tv",
      }),
    ).toBeNull()
    expect(
      feedbackUrl("https://feedback.example/tv", { platform: "android-tv" }),
    ).toBe("https://feedback.example/tv?platform=android-tv")
  })

  it.each([
    undefined,
    "http://localhost:3210/tv/local",
    "http://127.0.0.1:3210/tv/local",
    "http://[::1]:3210/tv/local",
    "http://feedback.example:3210/tv/local",
    "https://admin.jesusfilm.org/tv/local",
    "https://10.1.2.3/tv/local",
    "http://8.8.8.8:3210/tv/local",
    "http://172.32.0.1:3210/tv/local",
    "http://192.169.0.1:3210/tv/local",
    "http://10.256.0.1:3210/tv/local",
    "http://010.1.2.3:3210/tv/local",
    "http://0x0a010203:3210/tv/local",
    "http://167838211:3210/tv/local",
    "http://10.1:3210/tv/local",
    "http://name:password@10.1.2.3:3210/tv/local",
    "http://10.1.2.3:0/tv/local",
    "http://10.1.2.3:65536/tv/local",
    "http://10.1.2.3:3210/tv",
    "http://10.1.2.3:3210/other/../tv/local",
    "http://10.1.2.3:3210/tv/local?extra=1",
    "http://10.1.2.3:3210/tv/local#grant=test",
    "http://10.1.2.3:3210/tv/local\n",
    " http://10.1.2.3:3210/tv/local",
    "ftp://10.1.2.3:3210/tv/local",
  ])("rejects an ambiguous, public or nonlocal destination: %p", (base) => {
    expect(simulatorFeedbackUrl(base, { platform: "apple-tv" })).toBeNull()
  })

  it("drops invalid context fields using the same production sanitizer", () => {
    expect(
      simulatorFeedbackUrl("http://10.1.2.3:3210/tv/local", {
        platform: "android-tv",
        screen: "<script>",
        filmTitle: "invalid\nfilm",
        timestamp: "javascript:bad",
      }),
    ).toBe("http://10.1.2.3:3210/tv/local?platform=android-tv")
  })
})

describe("signed staging feedback destination", () => {
  const receiver = "https://web-staging-920a.up.railway.app/tv/simulator"
  const token = `eyJhbGciOiJFZERTQSJ9.eyJzY29wZSI6InRlc3QifQ.${"a".repeat(86)}`
  it("preserves the bearer fragment and sanitizes context without claiming verification", () => {
    const result = simulatorFeedbackUrl(`${receiver}#token=${token}`, {
      platform: "android-tv",
      screen: "settings",
      filmTitle: "JESUS & friends",
    })
    expect(result).toBe(
      `${receiver}?platform=android-tv&screen=settings&filmTitle=JESUS%20%26%20friends#token=${token}`,
    )
    expect(
      feedbackUrl(`${receiver}#token=${token}`, { platform: "android-tv" }),
    ).toBeNull()
  })
  it.each([
    `http://web-staging-920a.up.railway.app/tv/simulator#token=${token}`,
    `https://different.example/tv/simulator#token=${token}`,
    `${receiver}?token=${token}`,
    `${receiver}#grant=${token}`,
    `${receiver}#token=${token}&extra=1`,
    `${receiver}#token=malformed`,
    `${receiver}#token=${"a".repeat(2050)}.payload.${"b".repeat(86)}`,
    `${receiver}#token=${token}\n`,
  ])("rejects an invalid signed transport (%s)", (url) => {
    expect(simulatorFeedbackUrl(url, { platform: "apple-tv" })).toBeNull()
  })
})
