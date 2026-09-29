/**
 * LIVE hero curation — the hero is client-owned, so mirror web hero changes here
 * (hero sources, playlist sequence, mux inserts, blacklist) until feat-160 moves
 * curation into admin. Body shelves live in the Experience, not here.
 */

import { getT, type UiMessageKey } from "../../i18n/useT"

// Insert copy is a getter: each read takes the catalog in use, so a slide
// built or shown after a language change is in the new language (U10).
function heroCopy(key: UiMessageKey<"HomeHero">): string {
  return getT("HomeHero")(key)
}

export type WatchHomePlaylistGroup = readonly string[]

export type WatchHomeMuxInsertConfig = {
  id: string
  enabled: boolean
  playbackIds: readonly string[]
  durationSeconds: number | null
  label: string
  title: string
  collectionTitle: string | null
  description: string | null
  action: { label: string; url: string } | null
  logo: boolean
  posterOverride: string | null
  trigger: { type: "sequence-start" } | { type: "after-count"; count: number }
  conditionalOverlays?: readonly WatchHomeConditionalOverlay[]
}

export type WatchHomeConditionalOverlay = {
  priority: number
  conditions: readonly {
    type: "time-range"
    range: { start: number; end: number }
  }[]
  overlay: {
    label: string
    title: string
    collectionTitle: string | null
    description: string | null
    action?: { label: string; url: string } | null
  }
}

export const WATCH_HOME_HERO_SOURCE_IDS = [
  "1_jf-0-0",
  "2_GOJ-0-0",
  "GOMattCollection",
  "LUMOCollection",
] as const

// Ported from JesusFilm/core apps/watch/config/video-playlist.json.
// These are Core/Arclight ids, stored in admin as Video.coreId.
export const WATCH_HOME_PLAYLIST_SEQUENCE: readonly WatchHomePlaylistGroup[] = [
  ["1_jf-0-0"],
  ["JFP-Featured"],
  ["8_NBC"],
  [
    "GOJohnCollection",
    "GOLukeCollection",
    "GOMarkCollection",
    "GOMattCollection",
  ],
  ["7_Origins", "Nua", "2_ElCamWaySJEN"],
  ["MAG1"],
  ["11_Sermon", "11_Shema", "11_ReadBible", "11_Advent"],
  ["2_GOJ-0-0"],
  ["CS1"],
  ["9_CreationtoChrist"],
  ["2_FileZero-0-0"],
  ["10_DarkroomFaith"],
] as const

export const WATCH_HOME_COLLECTION_BLACKLIST = new Set(["7_Origins4Connect"])

// Ported from JesusFilm/core apps/watch/config/video-inserts.mux.json.
// Keep this as Forge fallback data until admin owns insert editorial metadata.
export const WATCH_HOME_MUX_INSERTS: readonly WatchHomeMuxInsertConfig[] = [
  {
    id: "welcome-start",
    enabled: true,
    playbackIds: ["34eG2PxlcRu3L4wU5XlKVna2vN3BAI02Tjrq28dazn3Y"],
    durationSeconds: 9,
    get label() {
      return heroCopy("welcomeLabel")
    },
    get title() {
      return heroCopy("welcomeTitle")
    },
    // No screen draws a collection title, so it stays English web data.
    collectionTitle: "Daily Inspirations",
    get description() {
      return heroCopy("welcomeDescription")
    },
    action: null,
    logo: true,
    posterOverride: null,
    trigger: { type: "sequence-start" },
    conditionalOverlays: [
      {
        priority: 10,
        conditions: [{ type: "time-range", range: { start: 5, end: 9 } }],
        overlay: {
          get label() {
            return heroCopy("morningLabel")
          },
          get title() {
            return heroCopy("morningTitle")
          },
          collectionTitle: "Morning Moments",
          get description() {
            return heroCopy("morningDescription")
          },
        },
      },
      {
        priority: 10,
        conditions: [{ type: "time-range", range: { start: 12, end: 17 } }],
        overlay: {
          get label() {
            return heroCopy("afternoonLabel")
          },
          get title() {
            return heroCopy("afternoonTitle")
          },
          collectionTitle: "Afternoon Moments",
          get description() {
            return heroCopy("afternoonDescription")
          },
        },
      },
      {
        priority: 10,
        conditions: [{ type: "time-range", range: { start: 17, end: 21 } }],
        overlay: {
          get label() {
            return heroCopy("eveningLabel")
          },
          get title() {
            return heroCopy("eveningTitle")
          },
          collectionTitle: "Evening Moments",
          get description() {
            return heroCopy("eveningDescription")
          },
        },
      },
    ],
  },
  {
    id: "join-us",
    enabled: true,
    playbackIds: ["VN4b95KOO3JtLg3x019dH2mzMHPL4le65vRmXFONyzZ8"],
    durationSeconds: null,
    get label() {
      return heroCopy("joinUsLabel")
    },
    get title() {
      return heroCopy("joinUsTitle")
    },
    collectionTitle: "Highlights",
    get description() {
      return heroCopy("joinUsDescription")
    },
    action: {
      get label() {
        return heroCopy("joinUsAction")
      },
      url: "https://your.nextstep.is/joinus",
    },
    logo: false,
    posterOverride: null,
    trigger: { type: "after-count", count: 1 },
  },
  {
    id: "telling-the-story-of-jesus",
    enabled: true,
    playbackIds: ["W00xXnOS4kU8VVMgx4M6AdzZE63OnKk300HdEDeUYZqlQ"],
    durationSeconds: null,
    get label() {
      return heroCopy("togetherLabel")
    },
    get title() {
      return heroCopy("togetherTitle")
    },
    collectionTitle: "Highlights",
    get description() {
      return heroCopy("togetherDescription")
    },
    action: {
      get label() {
        return heroCopy("togetherAction")
      },
      url: "https://www.jesusfilm.org/partners/",
    },
    logo: false,
    posterOverride: null,
    trigger: { type: "after-count", count: 3 },
  },
] as const
