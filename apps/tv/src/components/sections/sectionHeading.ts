import type { TextStyle } from "react-native"

import { scale } from "../../lib/scale"

// Shared section-heading ("Up Next") style for every watch-detail section title.
// Lives in `sections/` (not watchDetailTheme) so generic SDUI renderers
// (Related Questions, Bible Quotes) needn't depend on a watch-only token file.
export const SECTION_HEADING: TextStyle = {
  fontFamily: "System",
  fontSize: Math.round(scale(34)),
  fontWeight: "700",
  letterSpacing: -scale(0.4),
  color: "#ffffff",
}
