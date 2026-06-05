export const DEFAULT_WATCH_HOME_LANGUAGE_SLUG = "english"

export const WATCH_HOME_MAX_VIDEO_SLIDES = 16

export type WatchHomePlaylistGroup = readonly string[]

// Ported from JesusFilm/core apps/watch/config/video-playlist.json.
// These are Core/Arclight ids, not public slugs. Admin stores them as
// Video.coreId for synced collection rows.
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
]

export const WATCH_HOME_COLLECTION_BLACKLIST = new Set(["7_Origins4Connect"])

export type WatchHomeMuxInsertConfig = {
  id: string
  playbackId: string
  durationSeconds: number | null
  label: string
  title: string
  collectionTitle: string | null
  description: string | null
  action: { label: string; url: string } | null
  logo: boolean
  trigger: { type: "sequence-start" } | { type: "after-count"; count: number }
}

// Ported from JesusFilm/core apps/watch/config/video-inserts.mux.json.
export const WATCH_HOME_MUX_INSERTS: readonly WatchHomeMuxInsertConfig[] = [
  {
    id: "welcome-start",
    playbackId: "34eG2PxlcRu3L4wU5XlKVna2vN3BAI02Tjrq28dazn3Y",
    durationSeconds: 9,
    label: "Faith & Scripture",
    title: "Today's Video Picks",
    collectionTitle: "Daily Inspirations",
    description:
      "Faith-centered video content from our library to inspire, challenge, and spark reflection.",
    action: null,
    logo: true,
    trigger: { type: "sequence-start" },
  },
  {
    id: "join-us",
    playbackId: "VN4b95KOO3JtLg3x019dH2mzMHPL4le65vRmXFONyzZ8",
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
    trigger: { type: "after-count", count: 1 },
  },
  {
    id: "telling-the-story-of-jesus",
    playbackId: "W00xXnOS4kU8VVMgx4M6AdzZE63OnKk300HdEDeUYZqlQ",
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
    trigger: { type: "after-count", count: 3 },
  },
]
