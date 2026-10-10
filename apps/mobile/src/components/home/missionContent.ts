/**
 * Mission content shared by the Home rail and /mission detail page.
 * Ported from apps/web's WatchHomePromo.tsx. The text lives in the `Mission`
 * catalog namespace (U10): mirror web's copy changes in messages/en.json.
 */
import type { ComponentProps } from "react"
import type Ionicons from "@expo/vector-icons/Ionicons"

import type { UiMessageKey } from "../../i18n/useT"

export const BETA_SIGNUP_URL = "https://mailchi.mp/jesusfilm/beta"

// Web's wash: linear-gradient(135deg, burgundy 0.6, purple 0.2, ember 0.1) —
// kept quieter on mobile so text stays legible over the tint.
export const MISSION_WASH = {
  burgundy: "#450a1d",
  purple: "#581c87",
  ember: "#ea580c",
} as const

export type MissionKey = UiMessageKey<"Mission">

export type MissionPoint = {
  icon: ComponentProps<typeof Ionicons>["name"]
  titleKey: MissionKey
  descriptionKey: MissionKey
}

export type MissionHighlight = {
  titleKey: MissionKey
  descriptionKey: MissionKey
}

export const MISSION_POINTS: readonly MissionPoint[] = [
  {
    icon: "globe-outline",
    titleKey: "libraryPointTitle",
    descriptionKey: "libraryPointDescription",
  },
  {
    icon: "film-outline",
    titleKey: "formatsPointTitle",
    descriptionKey: "formatsPointDescription",
  },
  {
    icon: "people-outline",
    titleKey: "teamPointTitle",
    descriptionKey: "teamPointDescription",
  },
] as const

export const HIGHLIGHTS: readonly MissionHighlight[] = [
  { titleKey: "nextStepsTitle", descriptionKey: "nextStepsDescription" },
  { titleKey: "mediaLibraryTitle", descriptionKey: "mediaLibraryDescription" },
  {
    titleKey: "ministryToolsTitle",
    descriptionKey: "ministryToolsDescription",
  },
] as const
