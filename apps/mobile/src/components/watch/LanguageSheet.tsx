import { useCallback, useMemo, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../../hooks/useTypography"
import { pickLocalizedName } from "../../lib/pickLocalizedName"
import { ACCENT, TEXT_PRIMARY, TEXT_SECONDARY } from "../../lib/color"
import { feedback, HORIZONTAL_PADDING } from "../../styles/shared"
import type { WatchVariant } from "../../lib/normalizeVideo"

function resolveLanguageName(name: string | null): string {
  if (name == null) return "Unknown"
  const parsed = pickLocalizedName(name)
  return parsed ?? name
}

function sortedVariants(variants: WatchVariant[]): WatchVariant[] {
  return [...variants].sort((a, b) => {
    const nameA = resolveLanguageName(a.languageName).toLowerCase()
    const nameB = resolveLanguageName(b.languageName).toLowerCase()
    return nameA.localeCompare(nameB)
  })
}

export type LanguageSheetProps = {
  variants: WatchVariant[]
  activeVariantSlug: string
  onLanguageChange: (variantSlug: string, hlsUrl: string) => void
  onClose: () => void
}

export function LanguageSheetContent({
  variants,
  activeVariantSlug,
  onLanguageChange,
  onClose,
}: LanguageSheetProps) {
  const insets = useSafeAreaInsets()
  const typography = useTypography()
  const [query, setQuery] = useState("")

  const sorted = useMemo(() => sortedVariants(variants), [variants])
  const filtered = useMemo(() => {
    if (!query.trim()) return sorted
    const lower = query.toLowerCase()
    return sorted.filter((v) =>
      resolveLanguageName(v.languageName).toLowerCase().includes(lower),
    )
  }, [sorted, query])

  const handleSelect = useCallback(
    (variant: WatchVariant) => {
      if (!variant.hls) return
      onLanguageChange(variant.slug, variant.hls)
      onClose()
    },
    [onLanguageChange, onClose],
  )

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={18} color={TEXT_SECONDARY} />
        <BottomSheetTextInput
          style={[styles.searchInput, typography.body]}
          placeholder="Search languages..."
          placeholderTextColor={TEXT_SECONDARY}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={TEXT_SECONDARY} />
          </Pressable>
        )}
      </View>

      <BottomSheetScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.listContainer}>
          {filtered.map((variant) => {
            const isActive = variant.slug === activeVariantSlug
            return (
              <Pressable
                key={variant.documentId}
                style={({ pressed }) => [
                  styles.listRow,
                  isActive && styles.listRowActive,
                  pressed && feedback.pressed,
                ]}
                onPress={() => handleSelect(variant)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={resolveLanguageName(variant.languageName)}
              >
                <Text
                  style={[
                    styles.listRowText,
                    typography.body,
                    isActive && styles.listRowTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {resolveLanguageName(variant.languageName)}
                </Text>
              </Pressable>
            )
          })}
          {filtered.length === 0 && (
            <View style={styles.emptySearch}>
              <Text style={[styles.emptySearchText, typography.body]}>
                No languages found
              </Text>
            </View>
          )}
        </View>
      </BottomSheetScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: HORIZONTAL_PADDING,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  searchInput: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    padding: 0,
  },
  listContainer: {
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: 4,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 8,
    minHeight: 48,
    borderLeftWidth: 3,
    borderLeftColor: "rgba(0, 0, 0, 0)",
  },
  listRowActive: {
    borderLeftColor: ACCENT,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  listRowText: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    flex: 1,
  },
  listRowTextActive: {
    fontWeight: "600",
  },
  emptySearch: {
    alignItems: "center",
    paddingVertical: 24,
  },
  emptySearchText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
})
