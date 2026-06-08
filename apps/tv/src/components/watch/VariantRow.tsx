// Shared audio-dub (variant) row for the watch panels (LanguagePanel + the
// in-player menu's Audio Language section). The two panels rendered a
// byte-identical disabled-View / enabled-FocusableCard pair per annotated
// variant row; that pair lives here once so the disabled / focus / checkmark
// semantics can't drift between the on-page picker and the overlay menu.
//
// Semantics (unchanged from both callers):
//   - disabled row (no playable HLS): a plain non-focusable View, visually muted,
//     with an "Unavailable" tag — the D-pad skips it so an unplayable language
//     can't be selected.
//   - enabled row: a FocusableCard that, on press, selects the variant by its
//     original index and closes the panel; the active row gets initial focus
//     (hasTVPreferredFocus) and a checkmark.

import { Text, View, type ViewStyle } from "react-native"

import { FocusableCard } from "../FocusableCard"
import type { AnnotatedVariantRow } from "./panelState"
import { panelStyles } from "./panelStyles"

export function VariantRow({
  row,
  onSelect,
  onClose,
  rowInnerStyle,
}: {
  /** The annotated variant to render (carries disabled / active + index). */
  row: AnnotatedVariantRow
  /** Select this dub by its original variant index (writes activeVariantIndex). */
  onSelect: (index: number) => void
  /** Dismiss the panel after a selection. */
  onClose: () => void
  /**
   * Override for the row's inner padding. Defaults to the on-page panel padding
   * (`panelStyles.rowInner`); the in-player menu passes the tighter
   * `panelStyles.rowInnerCompact`. Behavior-preserving — keeps each panel's
   * existing spacing.
   */
  rowInnerStyle?: ViewStyle
}) {
  const { variant, index, disabled, active } = row
  const name = variant.languageName ?? variant.languageSlug ?? variant.slug
  const native = variant.languageNameNative
    ? `  ·  ${variant.languageNameNative}`
    : ""
  const innerStyle = rowInnerStyle ?? panelStyles.rowInner

  // Unplayable dub (no HLS): inert, non-focusable, muted. Rendered as a plain
  // View — never wrapped in a FocusableCard — so the D-pad skips it and the
  // viewer can't select an unplayable language. "Unavailable" tag mirrors
  // DESIGN.md §4's ghosted unfocusable error treatment.
  if (disabled) {
    return (
      <View
        style={[panelStyles.row, panelStyles.disabledRow]}
        accessibilityLabel={`${name}, unavailable`}
      >
        <View style={innerStyle}>
          <Text
            style={[panelStyles.rowText, panelStyles.disabledText]}
            numberOfLines={1}
          >
            {name}
            {native}
          </Text>
          <Text style={panelStyles.unavailable}>Unavailable</Text>
        </View>
      </View>
    )
  }

  return (
    <FocusableCard
      onPress={() => {
        onSelect(index)
        onClose()
      }}
      hasTVPreferredFocus={active}
      focusScale={1.02}
      style={panelStyles.row}
      accessibilityLabel={name}
    >
      <View style={innerStyle}>
        <Text style={panelStyles.rowText} numberOfLines={1}>
          {name}
          {native}
        </Text>
        {active ? <Text style={panelStyles.check}>{"✓"}</Text> : null}
      </View>
    </FocusableCard>
  )
}
