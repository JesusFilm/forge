// Which card shape a Home rail renders. React-free .ts so jest-expo can test it
// without a render (same shape as homeCardRouting/homeScrollState).

import type { HomeCardVariant } from "./HomeCard"
import type { WatchHomeSection } from "../../lib/watchHome/model"

// Portrait ONLY for a poster rail — never `orientation`, which also reads
// "vertical" for poster-less `collection`/config sections whose art is landscape
// (framing those 2:3 crops them to a sliver — the bug this exists to prevent).
export function resolveHomeRailVariant(
  section: Pick<WatchHomeSection, "isPosterRail">,
): HomeCardVariant {
  return section.isPosterRail ? "portrait" : "landscape"
}
