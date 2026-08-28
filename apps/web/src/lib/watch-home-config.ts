export type WatchHomeSourceConfig = {
  id: string
  limitChildren?: number
}

export type WatchHomePlaylistGroup = readonly string[]

export type WatchHomeSectionConfig = {
  id: string
  eyebrow: string
  title: string
  description?: string
  layout: "rail" | "grid"
  orientation?: "horizontal" | "vertical"
  showSequenceNumbers?: boolean
  sources?: readonly WatchHomeSourceConfig[]
  primaryCollectionId?: string
  childLimit?: number
}

export const WATCH_HOME_CACHE_VERSION = "v6-real-images-with-dominant-colors"

export const collectionShowcaseSources = [
  { id: "1_jf-0-0", limitChildren: 0 },
  { id: "2_GOJ-0-0", limitChildren: 0 },
  { id: "GOMattCollection", limitChildren: 0 },
  { id: "GOMarkCollection", limitChildren: 0 },
  { id: "GOLukeCollection", limitChildren: 0 },
  { id: "GOJohnCollection", limitChildren: 0 },
] as const satisfies readonly WatchHomeSourceConfig[]

export const collectionLumo = [
  { id: "LUMOCollection", limitChildren: 1 },
  { id: "GOMarkCollection", limitChildren: 1 },
  { id: "GOLukeCollection", limitChildren: 1 },
  { id: "GOJohnCollection", limitChildren: 1 },
] as const satisfies readonly WatchHomeSourceConfig[]

export const christmasAdventShowcaseSources = [
  { id: "2_0-ConsideringChristmas" },
  { id: "2_0-SupremeChristmas" },
  { id: "2_0-Noelevator" },
  { id: "2_0-TimeForChange" },
  { id: "2_0-Stunned" },
  { id: "1_wl604412-0-0" },
  { id: "9_0-TheSavior5505" },
  { id: "1_cl1301-0-0" },
  { id: "3_0-40DWJ_02-0-0", limitChildren: 1 },
  { id: "1_jf6102-0-0", limitChildren: 1 },
  { id: "1_riv_11-0-0" },
  { id: "1_wl604410-0-0" },
  { id: "6_GOLuke2601" },
  { id: "6_GOLuke2602" },
  { id: "6_GOMatt2501" },
] as const satisfies readonly WatchHomeSourceConfig[]

export const newBelieverCourse = [
  { id: "8_NBC", limitChildren: 10 },
] as const satisfies readonly WatchHomeSourceConfig[]

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

const WATCH_HOME_SECTION_DEFINITIONS = [
  {
    id: "home-video-gospels",
    layout: "rail",
    eyebrow: "Video Bible Collection",
    title: "Discover the full story",
    description:
      "Explore our collection of videos and resources that bring the Bible to life through engaging stories and teachings.",
    sources: collectionShowcaseSources,
  },
  {
    id: "home-collection-showcase-grid",
    layout: "grid",
    eyebrow: "Video Bible Collection",
    title: "Scripture Told Through Film",
    description:
      "Explore our collection of videos and resources that bring the Bible to life through engaging stories and teachings.",
    sources: collectionShowcaseSources,
    showSequenceNumbers: true,
  },
  {
    id: "home-collection-showcase-grid-christmas-advent",
    layout: "grid",
    eyebrow: "Christmas Advent",
    title: "Christmas Advent Countdown",
    description:
      "Join our Advent journey with a daily video that builds anticipation for Christmas, exploring the hope, joy, and promise of Jesus' arrival.",
    sources: christmasAdventShowcaseSources,
    showSequenceNumbers: true,
  },
  {
    id: "home-collection-bibleproject-advent",
    layout: "grid",
    eyebrow: "Bible Project",
    title: "BibleProject Advent",
    primaryCollectionId: "11_Advent",
    orientation: "vertical",
    childLimit: 12,
  },
  {
    id: "home-collection-nua",
    layout: "grid",
    eyebrow: "NUA Series",
    title: "NUA",
    primaryCollectionId: "7_0-ncs",
    childLimit: 12,
  },
  {
    id: "home-collection-nua-origins-worth",
    layout: "grid",
    eyebrow: "Worth Series",
    title: "NUA Worth",
    primaryCollectionId: "7_Origins2Worth",
    childLimit: 12,
  },
  {
    id: "home-collection-new-believer-course",
    layout: "grid",
    eyebrow: "Video Course",
    title: "Journey with Jesus",
    sources: newBelieverCourse,
  },
  {
    id: "home-collection-showcase-grid-vertical",
    layout: "grid",
    eyebrow: "Every Gospel, Told on Video",
    title: "Scripture, Spoken Exactly as Written",
    description:
      "Explore our collection of videos and resources that bring the Bible to life through engaging stories and teachings.",
    sources: collectionLumo,
    orientation: "vertical",
  },
] as const satisfies readonly WatchHomeSectionConfig[]

export type WatchHomeSectionId =
  (typeof WATCH_HOME_SECTION_DEFINITIONS)[number]["id"]

export const WATCH_HOME_SECTIONS: readonly WatchHomeSectionConfig[] =
  WATCH_HOME_SECTION_DEFINITIONS

export function getWatchHomeCoreIds(): string[] {
  const ids = [
    ...WATCH_HOME_HERO_SOURCE_IDS,
    ...WATCH_HOME_SECTIONS.flatMap((section) => [
      section.primaryCollectionId,
      ...(section.sources ?? []).map((source) => source.id),
    ]),
  ].filter(
    (id): id is string =>
      typeof id === "string" && !WATCH_HOME_COLLECTION_BLACKLIST.has(id),
  )

  return [...new Set(ids)]
}
