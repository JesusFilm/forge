// Shared FlatList wiring for the virtualized dub lists (LanguagePanel + the
// in-player menu). One implementation of renderRow / keyExtractor /
// getItemLayout / scroll-to-active so the two surfaces can't drift, plus the
// two focus behaviors the virtualization made necessary:
//
//   ONE-SHOT PREFERRED FOCUS — react-native-tvos re-fires requestFocusSelf
//   whenever a view with hasTVPreferredFocus is (re)created, so a virtualized
//   active row that unmounts and remounts while the user browses would yank
//   focus back to itself mid-scroll. `focusArmed` state arms the prop for the
//   initial claim on each open and disarms on the first row-focus event (the
//   same one-shot pattern DetailsActionRow uses for focus restore).
//
//   SCROLL-ON-OPEN — initialScrollIndex is consumed exactly once at FlatList
//   mount, and LanguagePanel's Modal keeps its subtree mounted across opens,
//   so reopening would otherwise show the previous scroll position. The
//   `visible` effect re-arms focus and scrolls back to the active row on
//   every open (getItemLayout makes scrollToIndex a synchronous offset jump).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FlatList } from "react-native"

import type { AnnotatedVariantRow } from "./panelState"
import { WatchOptionRow } from "./WatchOptionRow"
import { WATCH_OPTION_ROW_HEIGHT } from "./watchMenuLayout"

export function useVariantList({
  rows,
  onSelect,
  onClose,
  headerHeight = 0,
  visible = true,
}: {
  /** Annotated, display-ordered dub rows (annotateVariantRows output). */
  rows: AnnotatedVariantRow[]
  /** Select a dub by its ORIGINAL variant index (writes activeVariantIndex). */
  onSelect: (index: number) => void
  /** Dismiss the menu after a selection. */
  onClose: () => void
  /** Height of any heading rendered INSIDE the FlatList (ListHeaderComponent);
   *  0 when the heading sits outside the list. Feeds getItemLayout offsets. */
  headerHeight?: number
  /** The menu's open state. Menus that unmount on close can omit it. */
  visible?: boolean
}) {
  const listRef = useRef<FlatList<AnnotatedVariantRow>>(null)

  const activeDisplayIndex = useMemo(
    () => rows.findIndex((row) => row.active),
    [rows],
  )

  // Armed on each open so the active row claims focus once; the first focus
  // event from ANY row disarms it, so later remounts can't re-claim.
  const [focusArmed, setFocusArmed] = useState(true)
  const disarmFocus = useCallback(() => {
    setFocusArmed((armed) => (armed ? false : armed))
  }, [])

  useEffect(() => {
    if (!visible) return
    setFocusArmed(true)
    if (activeDisplayIndex > 0) {
      listRef.current?.scrollToIndex({
        index: activeDisplayIndex,
        animated: false,
      })
    } else {
      listRef.current?.scrollToOffset({ offset: 0, animated: false })
    }
    // Intentionally keyed on `visible` only (not activeDisplayIndex):
    // selection closes the menu, and re-scrolling a still-open menu under
    // the user would jank.
  }, [visible])

  const renderRow = useCallback(
    ({ item: row }: { item: AnnotatedVariantRow }) => {
      const name =
        row.variant.languageName ?? row.variant.languageSlug ?? row.variant.slug
      return (
        <WatchOptionRow
          icon="globe-outline"
          label={name}
          note={row.variant.languageNameNative}
          selected={row.active}
          disabled={row.disabled}
          hasTVPreferredFocus={row.active && focusArmed}
          onFocus={disarmFocus}
          onPress={() => {
            onSelect(row.index)
            onClose()
          }}
          accessibilityLabel={name}
        />
      )
    },
    [onSelect, onClose, focusArmed, disarmFocus],
  )

  const keyExtractor = useCallback(
    (row: AnnotatedVariantRow) =>
      `variant-${row.variant.documentId ?? ""}-${row.index}`,
    [],
  )

  // Fixed-height rows → exact offsets without measuring. headerHeight shifts
  // every offset when a heading renders inside the list's scroll content.
  const getItemLayout = useCallback(
    (
      _data: ArrayLike<AnnotatedVariantRow> | null | undefined,
      index: number,
    ) => ({
      length: WATCH_OPTION_ROW_HEIGHT,
      offset: headerHeight + index * WATCH_OPTION_ROW_HEIGHT,
      index,
    }),
    [headerHeight],
  )

  return {
    listRef,
    renderRow,
    keyExtractor,
    getItemLayout,
    initialScrollIndex: activeDisplayIndex > 0 ? activeDisplayIndex : undefined,
  }
}
