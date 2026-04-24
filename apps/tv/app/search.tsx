import { StyleSheet, Text, View } from "react-native"

import { COLORS } from "../src/lib/colors"
import { scale } from "../src/lib/scale"

/**
 * /search route — TV search surface.
 *
 * U1 scaffolding: the route is registered and renders a placeholder.
 * Subsequent units flesh it out:
 *   U3 — SearchKeyboard
 *   U4 — two-pane layout + QueryDisplay + query state owner
 *   U5 — semantic search wiring
 *   U6 — SearchResultsGrid
 *   U7 — SearchBrowse (Recent + Categories + Popular)
 *   U8 — recent-search persistence
 *
 * See docs/plans/2026-04-24-001-feat-tv-search-ui-plan.md.
 */
export default function SearchScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.placeholder}>Search</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: scale(80),
  },
  placeholder: {
    fontFamily: "System",
    fontSize: scale(28),
    color: COLORS.text,
  },
})
