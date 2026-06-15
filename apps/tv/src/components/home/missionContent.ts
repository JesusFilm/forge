// TV-local mission copy for the Home feed's closing band — adapted from
// apps/mobile/src/components/home/missionContent.ts (itself ported from
// apps/web/src/components/home/WatchHomePromo.tsx). Mirror copy changes there.
//
// TV cuts: no icons (the cards are text-only), and no external-link actions —
// the beta CTA is a couch-scannable QR (QrPanel), so the invitation card's
// body points at the code instead of a tap target (R15).

export type MissionCard = {
  key: string
  title: string
  body: string
}

export const MISSION_EYEBROW = "Built for global missions"

export const MISSION_HEADLINE =
  "The message doesn't change. The way people watch does."

export const MISSION_CARDS: readonly MissionCard[] = [
  {
    key: "reach",
    title: "The most translated film library in the world",
    body: "Decades of translation work, carried by trusted ministry partners, have built a library with thousands of language tracks so people can encounter the story of Jesus in the language that reaches them deepest.",
  },
  {
    key: "formats",
    title: "Carrying trusted voices into new formats",
    body: "We are rebuilding how gospel stories are told visually, pairing trusted translations with modern formats so the message can move freely across platforms, cultures, and screens.",
  },
  {
    key: "invite",
    title: "Help build the next generation of mission tools",
    body: "We're inviting practitioners, creators, and partners into early access — test new tools first, give feedback, and help shape products designed for real mission work.",
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
