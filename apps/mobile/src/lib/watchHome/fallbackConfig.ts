/**
 * FROZEN emergency body fallback — NOT mirrored from web. The live body is the
 * admin `watch-home` Experience (experienceAdapter.ts); this renders only on
 * Experience null / error / zero shelves (R6/R7) and is expected to drift. feat-160 retires it.
 */

import { getT, type UiMessageKey } from "../../i18n/useT"

// A shelf title is a getter, so the model built after a language change takes
// the new catalog. Only titles render; eyebrows and descriptions are not drawn.
function shelfTitle(key: UiMessageKey<"HomeShelves">): string {
  return getT("HomeShelves")(key)
}

export type WatchHomeSourceConfig = {
  id: string
  limitChildren?: number
}

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

export const WATCH_HOME_SECTIONS: readonly WatchHomeSectionConfig[] = [
  {
    id: "home-video-gospels",
    layout: "rail",
    eyebrow: "Video Bible Collection",
    get title() {
      return shelfTitle("fullStoryTitle")
    },
    description:
      "Explore our collection of videos and resources that bring the Bible to life through engaging stories and teachings.",
    sources: collectionShowcaseSources,
  },
  {
    id: "home-collection-showcase-grid",
    layout: "grid",
    eyebrow: "Video Bible Collection",
    get title() {
      return shelfTitle("scriptureThroughFilmTitle")
    },
    description:
      "Explore our collection of videos and resources that bring the Bible to life through engaging stories and teachings.",
    sources: collectionShowcaseSources,
    showSequenceNumbers: true,
  },
  {
    id: "home-collection-showcase-grid-christmas-advent",
    layout: "grid",
    eyebrow: "Christmas Advent",
    get title() {
      return shelfTitle("adventCountdownTitle")
    },
    description:
      "Join our Advent journey with a daily video that builds anticipation for Christmas, exploring the hope, joy, and promise of Jesus' arrival.",
    sources: christmasAdventShowcaseSources,
    showSequenceNumbers: true,
  },
  {
    id: "home-collection-bibleproject-advent",
    layout: "grid",
    eyebrow: "Bible Project",
    get title() {
      return shelfTitle("bibleProjectAdventTitle")
    },
    primaryCollectionId: "11_Advent",
    orientation: "vertical",
    childLimit: 12,
  },
  {
    id: "home-collection-nua",
    layout: "grid",
    eyebrow: "NUA Series",
    // A series name, the same in every language, so it stays out of the catalog.
    title: "NUA",
    primaryCollectionId: "7_0-ncs",
    childLimit: 12,
  },
  {
    id: "home-collection-nua-origins-worth",
    layout: "grid",
    eyebrow: "Worth Series",
    // A series name, the same in every language, so it stays out of the catalog.
    title: "NUA Worth",
    primaryCollectionId: "7_Origins2Worth",
    childLimit: 12,
  },
  {
    id: "home-collection-new-believer-course",
    layout: "grid",
    eyebrow: "Video Course",
    get title() {
      return shelfTitle("journeyWithJesusTitle")
    },
    sources: newBelieverCourse,
  },
  {
    id: "home-collection-showcase-grid-vertical",
    layout: "grid",
    eyebrow: "Every Gospel, Told on Video",
    get title() {
      return shelfTitle("scriptureAsWrittenTitle")
    },
    description:
      "Explore our collection of videos and resources that bring the Bible to life through engaging stories and teachings.",
    sources: collectionLumo,
    orientation: "vertical",
  },
] as const
