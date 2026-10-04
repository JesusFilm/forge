// The native intent (U14, KTD14, R1). The widget's tap URL becomes a request
// to the REAL curtain store, and every other URL reaches expo-router unchanged.
import {
  endPause,
  getPausePhase,
  setPauseRunOnTop,
} from "../../src/lib/pauseCurtain"
import { redirectSystemPath } from "../+native-intent"

/** The URL in every widget timeline entry. */
const WIDGET_URL = "forgemobile://daily-pause"

beforeEach(() => {
  endPause()
  setPauseRunOnTop(false)
})

afterAll(() => {
  endPause()
  setPauseRunOnTop(false)
})

describe("redirectSystemPath", () => {
  it("draws the curtain over Home for a widget tap that launches the app", () => {
    expect(redirectSystemPath({ path: WIDGET_URL, initial: true })).toBe("/")
    expect(getPausePhase()).toBe("closing")
  })

  it("draws the curtain and keeps the current screen for a widget tap on a running app", () => {
    expect(redirectSystemPath({ path: WIDGET_URL, initial: false })).toBeNull()
    expect(getPausePhase()).toBe("closing")
  })

  it("leaves a run on top where it is (KTD5)", () => {
    setPauseRunOnTop(true)

    expect(redirectSystemPath({ path: WIDGET_URL, initial: false })).toBeNull()
    expect(getPausePhase()).toBe("idle")
  })

  it.each([
    "forgemobile://expo-development-client/?url=http%3A%2F%2F192.168.1.20%3A8081",
    "forgemobile:///",
    "forgemobile://watch/jesus",
    "forgemobile://watch/jesus/english",
    "forgemobile://series/the-chosen",
    "forgemobile://experience/easter",
    "https://www.jesusfilm.org/watch/jesus.html/english.html",
  ])("passes %s through unchanged, cold and warm", (url) => {
    expect(redirectSystemPath({ path: url, initial: true })).toBe(url)
    expect(redirectSystemPath({ path: url, initial: false })).toBe(url)
    expect(getPausePhase()).toBe("idle")
  })
})
