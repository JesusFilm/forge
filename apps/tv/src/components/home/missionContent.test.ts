import { validateActionUrl } from "../../lib/validateUrl"
import {
  BETA_SIGNUP_DISPLAY_URL,
  BETA_SIGNUP_URL,
  MISSION_CARDS,
} from "./missionContent"

describe("BETA_SIGNUP_URL", () => {
  it("passes validateActionUrl (absolute, no dangerous scheme)", () => {
    expect(validateActionUrl(BETA_SIGNUP_URL)).toBe(true)
  })

  // validateActionUrl tolerates http: under __DEV__ (true in jest), so pin
  // https explicitly — the QR must never ship a downgraded scheme.
  it("is https", () => {
    expect(new URL(BETA_SIGNUP_URL).protocol).toBe("https:")
  })

  it("matches the URL web and mobile use", () => {
    expect(BETA_SIGNUP_URL).toBe("https://mailchi.mp/jesusfilm/beta")
  })
})

describe("BETA_SIGNUP_DISPLAY_URL", () => {
  it("starts with the QR target's host, so the printed URL can't drift", () => {
    expect(
      BETA_SIGNUP_DISPLAY_URL.startsWith(new URL(BETA_SIGNUP_URL).host),
    ).toBe(true)
  })

  it("carries no scheme — it's display copy, not a link", () => {
    expect(BETA_SIGNUP_DISPLAY_URL.includes("://")).toBe(false)
  })
})

describe("MISSION_CARDS", () => {
  it("every card has a non-empty title and body", () => {
    for (const card of MISSION_CARDS) {
      expect(card.title.trim().length).toBeGreaterThan(0)
      expect(card.body.trim().length).toBeGreaterThan(0)
    }
  })

  // Guards the colourful-restyle fields: icon feeds Ionicons (a typo renders
  // nothing) and wash feeds the gradient — a dropped/empty value would only
  // surface visually, so pin the shape here.
  it("every card has an icon glyph and a two-stop hex wash", () => {
    for (const card of MISSION_CARDS) {
      expect(card.icon.trim().length).toBeGreaterThan(0)
      expect(card.wash).toHaveLength(2)
      for (const stop of card.wash) {
        expect(stop).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })

  it("keys are unique (they become React keys)", () => {
    const keys = MISSION_CARDS.map((card) => card.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
