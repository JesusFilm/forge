/**
 * Mission content shared by the Home rail and /mission detail page.
 * Ported from apps/web's WatchHomePromo.tsx — mirror copy changes there.
 */
import type { ComponentProps } from "react"
import type Ionicons from "@expo/vector-icons/Ionicons"

export const BETA_SIGNUP_URL = "https://mailchi.mp/jesusfilm/beta"

// Web's wash: linear-gradient(135deg, burgundy 0.6, purple 0.2, ember 0.1) —
// kept quieter on mobile so text stays legible over the tint.
export const MISSION_WASH = {
  burgundy: "#450a1d",
  purple: "#581c87",
  ember: "#ea580c",
} as const

export type MissionPoint = {
  icon: ComponentProps<typeof Ionicons>["name"]
  title: string
  description: string
}

export type MissionHighlight = {
  title: string
  description: string
}

export const MISSION_EYEBROW = "Built for global missions"

export const MISSION_HEADLINE =
  "The message doesn't change. The way people watch does."

export const MISSION_INTRO =
  "We are rebuilding our video library and tools from the ground up, committing decades of translation work to the platforms where people already gather, watch, and share."

export const MISSION_POINTS: readonly MissionPoint[] = [
  {
    icon: "globe-outline",
    title: "The most translated film library in the world",
    description:
      "Decades of translation work, carried by trusted ministry partners, have built a library with thousands of language tracks so people can encounter the story of Jesus in the language that reaches them deepest.",
  },
  {
    icon: "film-outline",
    title: "Carrying trusted voices into new formats",
    description:
      "We are rebuilding how gospel stories are told visually, pairing trusted translations with modern formats so the message can move freely across platforms, cultures, and screens.",
  },
  {
    icon: "people-outline",
    title: "More than a library. A mission-driven team.",
    description:
      "Jesus Film Project is a global team of translators, media specialists, editors, and creators turning decades of ministry experience into tools for disciple-makers everywhere.",
  },
] as const

export const HIGHLIGHTS_LABEL = "What we are building next"

export const HIGHLIGHTS: readonly MissionHighlight[] = [
  {
    title: "Next Steps Platform",
    description:
      "Connect viewers with tangible opportunities on their spiritual journey, helping them take a next step into community, Scripture, or mission.",
  },
  {
    title: "Evangelistic Media Library",
    description:
      "An extensive Christian media library with thousands of videos, films, and resources available in multiple languages for ministry and evangelism worldwide.",
  },
  {
    title: "Digital Tools for Ministries",
    description:
      "Video management, content distribution, audience engagement, and analytics designed to help ministries reach more people effectively.",
  },
] as const

export const INVITE_EYEBROW = "You're invited"

export const INVITE_HEADLINE_PREFIX = "Help build "
export const INVITE_HEADLINE_ACCENT = "the next generation"
export const INVITE_HEADLINE_SUFFIX = " of mission tools"

export const INVITE_BODY =
  "We're inviting practitioners, creators, and partners into early access. Test new tools first, give feedback, and help shape products designed for real mission work."

export const BETA_CTA_LABEL = "Become a beta tester"
