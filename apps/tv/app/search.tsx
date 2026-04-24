import { useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { QueryDisplay } from "../src/components/search/QueryDisplay"
import { SearchKeyboard } from "../src/components/search/SearchKeyboard"
import { TVFocusGuideView } from "../src/components/TVFocusGuideView"
import { COLORS } from "../src/lib/colors"
import { scale } from "../src/lib/scale"

/**
 * /search route — TV search surface.
 *
 * Two-pane layout:
 *   Left pane: QueryDisplay above SearchKeyboard.
 *   Right pane: stubbed in U4 — U6 fills with SearchResultsGrid when
 *   the query is non-empty, U7 fills with SearchBrowse (Recent +
 *   Categories + Popular) when the query is empty.
 *
 * Owns `query` state. Sanitization (U5) and submit (U5) will land in
 * later units; this unit just wires the state flow so the keyboard
 * updates the display live.
 *
 * See docs/plans/2026-04-24-001-feat-tv-search-ui-plan.md U4.
 */
export default function SearchScreen() {
  const [query, setQuery] = useState("")

  return (
    <View style={styles.screen}>
      <View style={styles.leftPane}>
        <QueryDisplay value={query} />
        <SearchKeyboard
          value={query}
          onChange={setQuery}
          onSubmit={() => {
            // U5 wires real semantic-search submission here. For now,
            // submit is a no-op so the keyboard's ⏎ key has somewhere
            // to dispatch to without crashing.
          }}
        />
      </View>
      <TVFocusGuideView style={styles.rightPane} trapFocusLeft>
        {/* Right pane is populated by U6 (results grid) and U7
            (browse surface) in later units. The placeholder copy
            here is intentional — seeing it on the simulator is the
            U4-complete signal. */}
        <Text style={styles.rightStub}>
          {query.length === 0
            ? "Browse surface (Recent + Categories + Popular) — populated by U7."
            : `Results grid for "${query}" — populated by U6.`}
        </Text>
      </TVFocusGuideView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    paddingHorizontal: scale(48),
    paddingVertical: scale(48),
    gap: scale(32),
  },
  leftPane: {
    flexDirection: "column",
  },
  rightPane: {
    flex: 1,
    backgroundColor: COLORS.surfaceContainer,
    borderRadius: scale(16),
    padding: scale(32),
    justifyContent: "center",
  },
  rightStub: {
    fontFamily: "System",
    fontSize: scale(18),
    color: COLORS.muted,
    textAlign: "center",
  },
})
