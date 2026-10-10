import { WATCH_HOME_PLAYLIST_SEQUENCE, getWatchHomeCoreIds } from "./config"

// Mirror of apps/mobile/src/lib/watchHome/heroConfig.ts WATCH_HOME_PLAYLIST_SEQUENCE.
// If mobile re-curates the hero, update TV's config AND this literal (feat-160 will
// later retire the copy). Drift here means TV's hero diverges from web/mobile.
const MOBILE_PLAYLIST_SEQUENCE: readonly (readonly string[])[] = [
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

describe("WATCH_HOME_PLAYLIST_SEQUENCE", () => {
  it("mirrors mobile's 12-group hero playlist sequence", () => {
    expect(WATCH_HOME_PLAYLIST_SEQUENCE.map((group) => [...group])).toEqual(
      MOBILE_PLAYLIST_SEQUENCE.map((group) => [...group]),
    )
  })
})

describe("getWatchHomeCoreIds", () => {
  it("includes every playlist-sequence group id", () => {
    const ids = new Set(getWatchHomeCoreIds())
    for (const group of WATCH_HOME_PLAYLIST_SEQUENCE) {
      for (const id of group) {
        expect(ids.has(id)).toBe(true)
      }
    }
  })

  it("returns a deduped set — an id in both the sequence and a section appears once", () => {
    const ids = getWatchHomeCoreIds()
    // 1_jf-0-0 is a hero source id, a playlist-sequence group, and a section source.
    expect(ids.filter((id) => id === "1_jf-0-0")).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
