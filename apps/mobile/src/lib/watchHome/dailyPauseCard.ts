import type { HomeFeedItem } from "./homeFeed"

/** Places the Daily Bible Pause card in a built Home feed: right after the
 *  recommendations shelf, else where that block is authored, else first. */
export function withDailyPauseCard(
  feed: HomeFeedItem[],
  recommendationsIndex: number | null,
): HomeFeedItem[] {
  if (feed.length === 0) return feed
  const card: HomeFeedItem = { kind: "dailyPause" }
  const shelf = feed.findIndex((item) => item.kind === "recommendations")
  if (shelf >= 0)
    return [...feed.slice(0, shelf + 1), card, ...feed.slice(shelf + 1)]

  const sections = feed.flatMap((item, at) =>
    item.kind === "section" ? [at] : [],
  )
  const wanted = Math.min(
    Math.max(recommendationsIndex ?? 0, 0),
    sections.length,
  )
  const mission = feed.findIndex((item) => item.kind === "mission")
  const at =
    wanted < sections.length
      ? sections[wanted]!
      : mission >= 0
        ? mission
        : feed.length
  return [...feed.slice(0, at), card, ...feed.slice(at)]
}
