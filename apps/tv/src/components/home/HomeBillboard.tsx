// Home hero region: layout slot for the pinned action row (artwork/copy moved to
// HeroPager). Row stays in ScrollView flow so buttons stay focusable and paint over
// the pager (tvOS skips absolute focusables). Owns hero HEIGHT so the first rail peeks at scroll 0; geometry matches heroLayout.ts.

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
