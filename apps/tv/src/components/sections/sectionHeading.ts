import type { TextStyle } from "react-native"

import { scale } from "../../lib/scale"

// Shared section-heading style — the prominent "Up Next" treatment — applied to
// every section title on the watch-detail page (Up Next, About, Related
// Questions, Bible Quotes) so they render identically. Lives here (not in
// watchDetailTheme) because the Related Questions / Bible Quotes renderers are
// generic SDUI sections dispatched by SectionDispatcher; a section style is a
// `sections/` concern, and a generic renderer must not depend on a watch-only
// token file.
export const SECTION_HEADING: TextStyle = {
  fontFamily: "System",
  fontSize: Math.round(scale(34)),
  fontWeight: "700",
  letterSpacing: -scale(0.4),
  color: "#ffffff",
}
