/**
 * LIVE hero curation — the hero is client-owned, so mirror web hero changes here
 * (hero sources, playlist sequence, mux inserts, blacklist) until feat-160 moves
 * curation into admin. Body shelves live in the Experience, not here.
 */

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
    label: "Faith & Scripture",
    title: "Today's Video Picks",
    collectionTitle: "Daily Inspirations",
    description:
      "Faith-centered video content from our library to inspire, challenge, and spark reflection.",
    action: null,
    logo: true,
    posterOverride: null,
    trigger: { type: "sequence-start" },
    conditionalOverlays: [
      {
        priority: 10,
        conditions: [{ type: "time-range", range: { start: 5, end: 9 } }],
        overlay: {
          label: "Morning Inspiration",
          title: "Good Morning! Today's Bible Moments Await.",
          collectionTitle: "Morning Moments",
          description:
            "Begin your day with encouraging Bible moments designed to inspire and uplift your spirit.",
        },
      },
      {
        priority: 10,
        conditions: [{ type: "time-range", range: { start: 12, end: 17 } }],
        overlay: {
          label: "Afternoon Inspiration",
          title: "Good Afternoon! Bible Moments for Your Day.",
          collectionTitle: "Afternoon Moments",
          description:
            "Encouraging Bible content perfect for your afternoon break or continued inspiration.",
        },
      },
      {
        priority: 10,
        conditions: [{ type: "time-range", range: { start: 17, end: 21 } }],
        overlay: {
          label: "Evening Inspiration",
          title: "Good Evening! Wind Down with Bible Moments.",
          collectionTitle: "Evening Moments",
          description:
            "Peaceful Bible moments to help you reflect and find comfort as your day comes to a close.",
        },
      },
    ],
  },
  {
    id: "join-us",
    enabled: true,
    playbackIds: ["VN4b95KOO3JtLg3x019dH2mzMHPL4le65vRmXFONyzZ8"],
    durationSeconds: null,
    label: "Join Us",
    title: "Billions are searching",
    collectionTitle: "Highlights",
    description:
      "The harvest is here. Join us as we share the gospel with the world using digital media.",
    action: {
      label: "Join Us",
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
    label: "Let's go together",
    title: "Telling the Story of Jesus, Together",
    collectionTitle: "Highlights",
    description:
      "So they can hear and see the love of Jesus in their own language right where they are.",
    action: {
      label: "Share in Our Mission",
      url: "https://www.jesusfilm.org/partners/",
    },
    logo: false,
    posterOverride: null,
    trigger: { type: "after-count", count: 3 },
  },
] as const
