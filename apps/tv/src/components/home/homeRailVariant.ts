// Which card shape a Home rail renders. React-free .ts so jest-expo can test it
// without a render (same shape as homeCardRouting/homeScrollState).

import type { HomeCardVariant } from "./HomeCard"
import type { WatchHomeSection } from "../../lib/watchHome/model"

// An explicit Admin orientation wins. Legacy sections stay portrait only for a
// poster rail — never from `orientation`, which also reads "vertical" for
// poster-less `collection`/config sections whose art is landscape.
export function resolveHomeRailVariant(
  section: Pick<WatchHomeSection, "cardOrientation" | "isPosterRail">,
): HomeCardVariant {
  if (section.cardOrientation === "vertical") return "portrait"
  if (section.cardOrientation === "horizontal") return "landscape"
  return section.isPosterRail ? "portrait" : "landscape"
}
