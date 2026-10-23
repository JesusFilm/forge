import {
  Fragment,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import { FlashList } from "@shopify/flash-list"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../../hooks/useTypography"
import { useSheetListHeight } from "../../hooks/useSheetListHeight"
import { useUiTag } from "../../hooks/useUiTag"
import { useTextDirection } from "../../i18n/textDirection"
import { useLocaleEpoch, useT, type UiT } from "../../i18n/useT"
import { ACCENT, TEXT_PRIMARY, TEXT_SECONDARY } from "../../lib/color"
import { acceptSheetTap, assembleSheetList } from "../../lib/sheetListLogic"
import {
  STATUS_PART_SEPARATOR,
  type StatusPart,
  statusPartsLabel,
} from "../../lib/sheetStatus"
import { feedback, HORIZONTAL_PADDING } from "../../styles/shared"

/** The sheet's colors. The Bible reader passes its own theme (KTD12). */
export type SearchableListSheetColors = {
  text: string
  secondaryText: string
  /** The checkmark on the current row. */
  accent: string
  /** The search field and the current row. */
  surface: string
}

/** The app's dark look, which every caller without a color set keeps. */
export const DEFAULT_LIST_SHEET_COLORS: Readonly<SearchableListSheetColors> =
  Object.freeze({
    text: TEXT_PRIMARY,
    secondaryText: TEXT_SECONDARY,
    accent: ACCENT,
    surface: "rgba(255, 255, 255, 0.06)",
  })

export type SearchableListSheetProps<T> = {
  rows: T[]
  // Selection identity of the active row (slug/documentId, never bcp47). Its row is
  // hoisted into the "Current" section and dropped from the list. Null/"" ⇒ none.
  activeId: string | null
  getSelectionId: (item: T) => string
  getKey: (item: T) => string
  getPrimaryLabel: (item: T) => string
  // The language of the primary label (KTD13). Absent or null: not known.
  getPrimaryLang?: (item: T) => string | null | undefined
  getSecondaryLabel?: (item: T) => string | null | undefined
  // A short state line under the labels (e.g. "Downloaded"); read out with the
  // row's name so a screen reader learns it too.
  getStatusLabel?: (item: T) => string | null | undefined
  // Replaces getStatusLabel: the parts share the secondary label's line, split
  // by " • ". A screen reader reads them, joined by commas.
  getStatusParts?: (item: T) => readonly StatusPart[]
  // A longer line on the "Current" row only (e.g. a copyright credit), up to
  // two lines. Not read out.
  getActiveDetailLabel?: (item: T) => string | null | undefined
  getSearchValues: (item: T) => (string | null | undefined)[]
  // Availability guard (e.g. a dub without `hls`): a false row silently ignores
  // taps. Defaults to always-selectable.
  isSelectable?: (item: T) => boolean
  onSelect: (item: T) => void
  searchPlaceholder: string
  searchAccessibilityLabel: string
  emptySearchMessage: string
  // Extra header content above the search field (e.g. the subtitle on/off switch).
  headerTop?: ReactNode
  // Keep `rows` in the caller's order instead of sorting them by name.
  keepRowOrder?: boolean
  // A control at the end of the "Current" row (e.g. the Bible reader's
  // download button). It sits beside the row's label, so a screen reader
  // reaches it as its own element.
  renderActiveAccessory?: (item: T) => ReactNode
  colors?: SearchableListSheetColors
  // The RUM prefix for the row and clear-search taps. The row label carries
  // translated text, so Datadog must not name the tap from it (KTD15).
  actionName?: string
  // The sheet route's root testID (`screen-<id>`), from its adapter.
  testID?: string
}

function accessibleName(
  t: UiT<"ListSheet">,
  primary: string,
  status: string | null | undefined,
): string {
  return status
    ? t("rowWithStatusAriaLabel", { name: primary, status })
    : primary
}

// Generic searchable list sheet: FlashList + search + "Current" section + 500ms
// double-tap debounce + formSheet detent-height wiring. The language/subtitle
// sheets are thin adapters supplying row identity, labels, guard, and callback.
export function SearchableListSheet<T>({
  rows,
  activeId,
  getSelectionId,
  getKey,
  getPrimaryLabel,
  getPrimaryLang,
  getSecondaryLabel,
  getStatusLabel,
  getStatusParts,
  getActiveDetailLabel,
  getSearchValues,
  isSelectable,
  onSelect,
  searchPlaceholder,
  searchAccessibilityLabel,
  emptySearchMessage,
  headerTop,
  keepRowOrder = false,
  renderActiveAccessory,
  colors = DEFAULT_LIST_SHEET_COLORS,
  actionName = "list-sheet",
  testID,
}: SearchableListSheetProps<T>) {
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const typography = useTypography()
  const [query, setQuery] = useState("")
  // FlashList virtualizes but needs an explicit height inside the formSheet (the
  // content root is unbounded). Derived from the native detent index — see
  // useSheetListHeight, the single owner of that gotcha.
  const listHeight = useSheetListHeight(windowHeight)
  // Debounce so a fast double-tap can't fire the selection (and router.back())
  // twice and pop the underlying screen.
  const lastSelectRef = useRef(0)
  const uiTag = useUiTag()
  const direction = useTextDirection()
  const t = useT("ListSheet")
  const epoch = useLocaleEpoch()

  const { active, filtered } = useMemo(
    () =>
      assembleSheetList({
        rows,
        activeId,
        query,
        getSelectionId,
        getPrimaryLabel,
        getSearchValues,
        keepRowOrder,
        uiTag,
      }),
    [
      rows,
      activeId,
      query,
      getSelectionId,
      getPrimaryLabel,
      getSearchValues,
      keepRowOrder,
      uiTag,
    ],
  )

  const { primaryText, secondaryText } = useMemo(
    () => ({
      primaryText: { color: colors.text },
      secondaryText: { color: colors.secondaryText },
    }),
    [colors.text, colors.secondaryText],
  )

  const statusOf = useCallback(
    (item: T): string | null | undefined => {
      if (!getStatusParts) return getStatusLabel?.(item)
      const parts = getStatusParts(item)
      return parts.length > 0 ? statusPartsLabel(parts) : null
    },
    [getStatusLabel, getStatusParts],
  )

  // The lines under the name. With status parts, the secondary label and the
  // parts share one line.
  const renderSubLines = useCallback(
    (
      secondary: string | null | undefined,
      status: string | null | undefined,
      parts: readonly StatusPart[] | undefined,
    ) => {
      if (parts) {
        const segments = [...(secondary ? [{ text: secondary }] : []), ...parts]
        return segments.length > 0 ? (
          <Text
            style={[
              styles.nativeText,
              typography.bodySmall,
              secondaryText,
              direction.ui,
            ]}
            numberOfLines={2}
          >
            {segments.map((segment, index) => (
              <Fragment key={index}>
                {index > 0 ? STATUS_PART_SEPARATOR : null}
                <Text style={segment.strong ? styles.statusStrong : undefined}>
                  {segment.text}
                </Text>
              </Fragment>
            ))}
          </Text>
        ) : null
      }
      return (
        <>
          {secondary ? (
            <Text
              style={[styles.nativeText, typography.bodySmall, secondaryText]}
              numberOfLines={1}
            >
              {secondary}
            </Text>
          ) : null}
          {status ? (
            <Text
              style={[
                styles.nativeText,
                typography.bodySmall,
                secondaryText,
                direction.ui,
              ]}
              numberOfLines={1}
            >
              {status}
            </Text>
          ) : null}
        </>
      )
    },
    [typography, secondaryText, direction],
  )

  const handleSelect = useCallback(
    (item: T) => {
      const now = Date.now()
      if (!acceptSheetTap(now, lastSelectRef.current)) return
      if (isSelectable && !isSelectable(item)) return
      lastSelectRef.current = now
      onSelect(item)
    },
    [isSelectable, onSelect],
  )

  const renderItem = useCallback(
    ({ item }: { item: T }) => {
      const secondary = getSecondaryLabel?.(item)
      const parts = getStatusParts?.(item)
      const status = statusOf(item)
      const primaryDirection = direction.text(getPrimaryLang?.(item))
      return (
        <Pressable
          style={({ pressed }) => [styles.listRow, pressed && feedback.pressed]}
          onPress={() => handleSelect(item)}
          accessibilityRole="radio"
          accessibilityState={{ selected: false }}
          accessibilityLabel={accessibleName(t, getPrimaryLabel(item), status)}
          // The mark fits only a label that is the name alone (R10).
          accessibilityLanguage={
            status ? undefined : primaryDirection.accessibilityLanguage
          }
          {...{ "dd-action-name": `${actionName}-row` }}
        >
          <View style={styles.nameColumn}>
            <Text
              style={[typography.body, primaryText, primaryDirection.style]}
              numberOfLines={1}
              accessibilityLanguage={primaryDirection.accessibilityLanguage}
            >
              {getPrimaryLabel(item)}
            </Text>
            {renderSubLines(secondary, status, parts)}
          </View>
        </Pressable>
      )
    },
    [
      getPrimaryLabel,
      getPrimaryLang,
      getSecondaryLabel,
      getStatusParts,
      statusOf,
      renderSubLines,
      handleSelect,
      typography,
      primaryText,
      secondaryText,
      t,
      actionName,
      direction,
    ],
  )

  const keyExtractor = useCallback((item: T) => getKey(item), [getKey])

  const activeSecondary = active ? getSecondaryLabel?.(active) : null
  const activeParts = active ? getStatusParts?.(active) : undefined
  const activeStatus = active ? statusOf(active) : null
  const activeDetail = active ? getActiveDetailLabel?.(active) : null
  const activeDirection = direction.text(
    active ? getPrimaryLang?.(active) : null,
  )

  // Search + current selection live in the list header so they scroll with the
  // list in one container.
  const header = (
    <View style={styles.header}>
      {headerTop}

      <View
        style={[styles.searchContainer, { backgroundColor: colors.surface }]}
      >
        <Ionicons
          name="search-outline"
          size={18}
          color={colors.secondaryText}
        />
        <TextInput
          style={[
            styles.searchInput,
            typography.body,
            primaryText,
            direction.ui,
          ]}
          placeholder={searchPlaceholder}
          placeholderTextColor={colors.secondaryText}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={searchAccessibilityLabel}
        />
        {query.length > 0 && (
          <Pressable
            onPress={() => setQuery("")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("clearSearchAriaLabel")}
            {...{ "dd-action-name": `${actionName}-clear-search` }}
          >
            <Ionicons
              name="close-circle"
              size={18}
              color={colors.secondaryText}
            />
          </Pressable>
        )}
      </View>

      {active && (
        <View style={styles.currentSection}>
          <Text
            style={[
              styles.currentLabel,
              typography.bodySmall,
              secondaryText,
              direction.ui,
            ]}
          >
            {t("current")}
          </Text>
          <View style={[styles.listRow, { backgroundColor: colors.surface }]}>
            <View
              style={styles.activeLabel}
              // A plain View is not an accessibility element; without this the
              // label never reaches the native tree and VoiceOver reads the
              // child texts one by one.
              accessible
              accessibilityLabel={accessibleName(
                t,
                getPrimaryLabel(active),
                activeStatus,
              )}
              accessibilityLanguage={
                activeStatus ? undefined : activeDirection.accessibilityLanguage
              }
            >
              <Ionicons name="checkmark" size={18} color={colors.accent} />
              <View style={styles.nameColumn}>
                <Text
                  style={[
                    typography.body,
                    styles.listRowTextActive,
                    primaryText,
                    activeDirection.style,
                  ]}
                  // An accessory takes width, so a long name gets a second line.
                  numberOfLines={renderActiveAccessory ? 2 : 1}
                  accessibilityLanguage={activeDirection.accessibilityLanguage}
                >
                  {getPrimaryLabel(active)}
                </Text>
                {renderSubLines(activeSecondary, activeStatus, activeParts)}
                {activeDetail ? (
                  <Text
                    style={[
                      styles.nativeText,
                      typography.bodySmall,
                      secondaryText,
                    ]}
                    numberOfLines={2}
                  >
                    {activeDetail}
                  </Text>
                ) : null}
              </View>
            </View>
            {renderActiveAccessory?.(active)}
          </View>
        </View>
      )}
    </View>
  )

  return (
    <View testID={testID} style={styles.container}>
      <View style={{ height: listHeight }}>
        <FlashList
          data={filtered}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          // Recycled rows redraw on a language change (KTD5).
          extraData={epoch}
          keyboardShouldPersistTaps="handled"
          // Off by intent: FlashList v2's default maintainVisibleContentPosition
          // (for chat-like lists) makes our list jump when the search swaps data
          // wholesale (e.g. the X clearing the query scrolls up then settles).
          maintainVisibleContentPosition={{ disabled: true }}
          ListHeaderComponent={header}
          contentContainerStyle={{
            paddingHorizontal: HORIZONTAL_PADDING,
            paddingBottom: insets.bottom + 24,
          }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptySearch}>
              <Text style={[typography.body, secondaryText]}>
                {emptySearchMessage}
              </Text>
            </View>
          }
        />
      </View>
    </View>
  )
}

// Colors are not here: they come from the `colors` prop at render time.
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 36,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  searchInput: {
    flex: 1,
    padding: 0,
  },
  currentSection: {
    marginBottom: 12,
  },
  currentLabel: {
    marginBottom: 6,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    minHeight: 48,
  },
  nameColumn: {
    flex: 1,
    minWidth: 0,
  },
  activeLabel: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  listRowTextActive: {
    fontWeight: "600",
  },
  nativeText: {
    marginTop: 2,
  },
  statusStrong: {
    fontWeight: "700",
  },
  emptySearch: {
    alignItems: "center",
    paddingVertical: 24,
  },
})
