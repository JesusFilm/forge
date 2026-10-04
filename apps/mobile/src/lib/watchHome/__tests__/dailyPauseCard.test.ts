import { withDailyPauseCard } from "../dailyPauseCard"
import type { HomeFeedItem } from "../homeFeed"
import type { WatchHomeSection } from "../model"

function section(id: string): HomeFeedItem {
  return {
    kind: "section",
    section: { id } as WatchHomeSection,
  }
}

function kinds(items: HomeFeedItem[]): string[] {
  return items.map((item) =>
    item.kind === "section" ? `section:${item.section.id}` : item.kind,
  )
}

const SELECTOR: HomeFeedItem = { kind: "selector" }
const SHELF: HomeFeedItem = { kind: "recommendations" }
const MISSION: HomeFeedItem = { kind: "mission" }

describe("withDailyPauseCard", () => {
  it("sits right below the recommendations shelf", () => {
    const feed = [SELECTOR, section("s0"), SHELF, section("s1"), MISSION]
    expect(kinds(withDailyPauseCard(feed, 1))).toEqual([
      "selector",
      "section:s0",
      "recommendations",
      "dailyPause",
      "section:s1",
      "mission",
    ])
  })

  it("takes the shelf's authored place when the shelf's gate is closed", () => {
    const feed = [SELECTOR, section("s0"), section("s1"), MISSION]
    expect(kinds(withDailyPauseCard(feed, 1))).toEqual([
      "selector",
      "section:s0",
      "dailyPause",
      "section:s1",
      "mission",
    ])
  })

  it("leads the body when no recommendations block is published", () => {
    const feed = [SELECTOR, section("s0"), section("s1"), MISSION]
    expect(kinds(withDailyPauseCard(feed, null))).toEqual([
      "selector",
      "dailyPause",
      "section:s0",
      "section:s1",
      "mission",
    ])
  })

  it("stays above the mission when the place runs past the last section", () => {
    const feed = [section("s0"), MISSION]
    expect(kinds(withDailyPauseCard(feed, 9))).toEqual([
      "section:s0",
      "dailyPause",
      "mission",
    ])
  })

  it("adds nothing before Home has a feed", () => {
    expect(withDailyPauseCard([], 0)).toEqual([])
  })

  it("adds exactly one card", () => {
    const feed = [SELECTOR, SHELF, section("s0"), MISSION]
    const cards = withDailyPauseCard(feed, 0).filter(
      (item) => item.kind === "dailyPause",
    )
    expect(cards).toHaveLength(1)
  })
})
