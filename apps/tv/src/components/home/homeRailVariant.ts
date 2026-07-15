// Which card shape a Home rail renders. React-free .ts so jest-expo can test it
// without a render (same shape as homeCardRouting/homeScrollState).

import type { HomeCardVariant } from "./HomeCard"
import type { WatchHomeSection } from "../../lib/watchHome/model"

/**
 * Portrait ONLY for a curated poster rail — never `orientation`. `orientation`
 * also reads "vertical" for poster-less `collection` blocks and for two
 * config-declared sections whose art is the video's landscape cinematic; framing
 * those 2:3 crops them to a ~31% sliver. isPosterRail is set from the same
 * resolved poster the cards render, so frame and art cannot disagree.
 */
export function resolveHomeRailVariant(
  section: Pick<WatchHomeSection, "isPosterRail">,
): HomeCardVariant {
  return section.isPosterRail ? "portrait" : "landscape"
}
