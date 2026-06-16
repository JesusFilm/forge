// TV-local mission copy for the Home feed's closing band — adapted from
// apps/mobile/src/components/home/missionContent.ts (itself ported from
// apps/web/src/components/home/WatchHomePromo.tsx). Mirror copy changes there.
//
// TV note: no external-link actions — the beta CTA is a couch-scannable QR
// (QrPanel), so the invitation card's body points at the code instead of a tap
// target (R15). The cards carry a gradient `wash` + faint `icon` so the band
// reads in the same colourful language as the mobile rail and web promo.

import type { ComponentProps } from "react"
import type Ionicons from "@expo/vector-icons/Ionicons"

// Shared mission "wash" palette — the exact hexes the mobile rail
// (missionContent.ts MISSION_WASH) and web promo (WatchHomePromo.tsx section
// gradient) use: linear-gradient(135deg, burgundy → purple → ember). Keeping
// the same palette here makes the three platforms read as one design.
export const MISSION_WASH = {
  burgundy: "#450a1d",
  purple: "#581c87",
  ember: "#ea580c",
} as const

export type MissionCard = {
  key: string
  title: string
  body: string
  /** Large, faint watermark glyph behind the card (mirrors mobile/web). */
  icon: ComponentProps<typeof Ionicons>["name"]
  /** Diagonal gradient wash pair drawn behind the card content. */
  wash: readonly [string, string]
}

export const MISSION_EYEBROW = "Built for global missions"

export const MISSION_HEADLINE =
  "The message doesn't change. The way people watch does."

export const MISSION_CARDS: readonly MissionCard[] = [
  {
    key: "reach",
    title: "The most translated film library in the world",
    body: "Decades of translation work, carried by trusted ministry partners, have built a library with thousands of language tracks so people can encounter the story of Jesus in the language that reaches them deepest.",
    icon: "globe-outline",
    wash: [MISSION_WASH.burgundy, MISSION_WASH.purple],
  },
  {
    key: "formats",
    title: "Carrying trusted voices into new formats",
    body: "We are rebuilding how gospel stories are told visually, pairing trusted translations with modern formats so the message can move freely across platforms, cultures, and screens.",
    icon: "film-outline",
    wash: [MISSION_WASH.purple, MISSION_WASH.ember],
  },
  {
    key: "invite",
    title: "Help build the next generation of mission tools",
    body: "We're inviting practitioners, creators, and partners into early access — test new tools first, give feedback, and help shape products designed for real mission work.",
    icon: "people-outline",
    wash: [MISSION_WASH.ember, MISSION_WASH.burgundy],
  },
] as const

/**
 * The beta signup target the QR encodes — the exact URL web
 * (WatchHomePromo.tsx) and mobile (missionContent.ts BETA_SIGNUP_URL) use.
 * A JFP-owned redirect is deferred follow-up work (plan scope boundary).
 */
export const BETA_SIGNUP_URL = "https://mailchi.mp/jesusfilm/beta"

/**
 * Couch-readable short form printed beneath the QR. Must stay on
 * BETA_SIGNUP_URL's host — missionContent.test.ts pins the pair together.
 */
export const BETA_SIGNUP_DISPLAY_URL = "mailchi.mp/jesusfilm/beta"

export const BETA_CTA_LABEL = "Become a beta tester"

export const QR_SCAN_HINT = "Scan with your phone to join the beta"
