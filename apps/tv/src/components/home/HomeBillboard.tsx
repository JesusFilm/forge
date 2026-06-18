// The Home billboard hero region — now just the bottom-anchored layout slot for
// the hero's pinned action row (the carousel's "See more" CTA + the white
// next-slide chevron). The slide ARTWORK and COPY moved to HeroPager, a
// screen-level layer that pages them with an Apple-TV slide; the action row
// stays here in the ScrollView flow so the buttons remain focusable and paint
// ON TOP of the sliding pager (tvOS skips absolute focusables anyway).
//
// This component still owns the hero region's HEIGHT so the first carousel rail
// peeks below it at scroll 0, and pins the action row at the bottom-left via
// flexbox (justifyContent flex-end) — the exact geometry HeroPager's copy
// reserves space for (see heroLayout.ts).

import { memo, type ReactNode } from "react"
import { StyleSheet, View } from "react-native"

import {
  HERO_ACTION_GAP,
  HERO_PADDING_BOTTOM,
  HERO_PADDING_LEFT,
  HERO_REGION_HEIGHT,
} from "./heroLayout"

type HomeBillboardProps = {
  /** The hero's focusable action row (See more + next-slide chevron). */
  action?: ReactNode
}

export const HomeBillboard = memo(function HomeBillboard({
  action,
}: HomeBillboardProps) {
  return (
    <View style={styles.hero}>
      {action != null ? <View style={styles.action}>{action}</View> : null}
    </View>
  )
})

const styles = StyleSheet.create({
  hero: {
    height: HERO_REGION_HEIGHT,
    justifyContent: "flex-end",
    paddingLeft: HERO_PADDING_LEFT,
    paddingBottom: HERO_PADDING_BOTTOM,
  },
  // The action row sits below where the pager's copy ends; content-width and
  // left-aligned so the focus ring + magnify never stretch the row.
  action: {
    marginTop: HERO_ACTION_GAP,
    alignItems: "flex-start",
  },
})
