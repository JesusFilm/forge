import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Ionicons from "@expo/vector-icons/Ionicons"
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons"

import { useTypography } from "../../hooks/useTypography"
import {
  ACCENT,
  TEXT_BODY,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import { feedback, HORIZONTAL_PADDING } from "../../styles/shared"
import { formatFileSize, tierDownloads } from "../../lib/downloadTiers"
import type { WatchDownload, WatchSubtitle } from "../../lib/normalizeVideo"
import { RAW_EXPORT_ENABLED } from "../../lib/rawExportConstants"
import { TERMS_OF_USE_PARAGRAPHS } from "../../lib/terms-of-use"

function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "0:00"
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

export function TermsModal({
  visible,
  onAccept,
  onCancel,
}: {
  visible: boolean
  onAccept: () => void
  onCancel: () => void
}) {
  const insets = useSafeAreaInsets()
  const typography = useTypography()

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.termsContainer,
            {
              paddingTop:
                Platform.OS === "android" ? insets.top + 16 : insets.top + 24,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <Text style={[styles.termsTitle, typography.titleLarge]}>
            Terms of Use
          </Text>
          <ScrollView style={styles.termsScroll}>
            {TERMS_OF_USE_PARAGRAPHS.map((paragraph, index) => (
              <Text
                key={index}
                style={[
                  styles.termsText,
                  typography.body,
                  index > 0 && styles.termsParagraphGap,
                ]}
              >
                {paragraph}
              </Text>
            ))}
          </ScrollView>
          <View style={styles.termsFooter}>
            <Pressable
              style={({ pressed }) => [
                styles.termsCancelButton,
                pressed && feedback.pressed,
              ]}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={[styles.termsCancelText, typography.body]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.termsAcceptButton,
                pressed && feedback.pressed,
              ]}
              onPress={onAccept}
              accessibilityRole="button"
              accessibilityLabel="Accept terms of use"
            >
              <Text style={[styles.termsAcceptText, typography.body]}>
                Accept
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

export type DropdownOption = {
  key: string
  label: string
  /** Optional trailing text shown on the right (e.g. a file size). */
  trailing?: string
  /** Grayed out and non-selectable (e.g. already downloaded in this option). */
  disabled?: boolean
  /** Short note shown on a disabled row in place of `trailing` (e.g. "Already downloaded"). */
  note?: string
}

/** Cap the open panel at ~5 rows so long lists scroll inside the dropdown, not grow the sheet. */
const DROPDOWN_MAX_HEIGHT = 240

/**
 * Collapsed select expanding to a bounded, internally-scrollable list, so the
 * sheet stays compact on first present regardless of option count. Exported so
 * the series download sheet reuses one dropdown implementation (no style drift).
 */
export function Dropdown({
  sectionLabel,
  options,
  selectedKey,
  open,
  onToggle,
  onSelect,
}: {
  sectionLabel: string
  options: DropdownOption[]
  selectedKey: string
  open: boolean
  onToggle: () => void
  onSelect: (key: string) => void
}) {
  const typography = useTypography()
  const selected = options.find((o) => o.key === selectedKey) ?? options[0]

  return (
    <View style={styles.dropdownSection}>
      <Text style={[styles.dropdownSectionLabel, typography.bodySmall]}>
        {sectionLabel}
      </Text>
      <Pressable
        style={({ pressed }) => [
          styles.dropdownTrigger,
          open && styles.dropdownTriggerOpen,
          pressed && feedback.pressed,
        ]}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={
          selected != null ? `${sectionLabel}, ${selected.label}` : sectionLabel
        }
      >
        <Text style={[styles.dropdownValue, typography.body]} numberOfLines={1}>
          {selected?.label}
        </Text>
        <View style={styles.dropdownRight}>
          {selected?.trailing != null && (
            <Text style={[styles.dropdownTrailing, typography.bodySmall]}>
              {selected.trailing}
            </Text>
          )}
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={18}
            color={TEXT_SECONDARY}
          />
        </View>
      </Pressable>
      {open && (
        <View style={styles.dropdownPanel}>
          <ScrollView
            style={styles.dropdownPanelScroll}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            accessibilityLabel={`${sectionLabel} options`}
          >
            <View accessibilityRole="radiogroup">
              {options.map((opt) => {
                const disabled = opt.disabled === true
                // A disabled row (e.g. already downloaded) never reads as the
                // active choice, even if it's still the current selectedKey.
                const isSelected = !disabled && opt.key === selectedKey
                return (
                  <Pressable
                    key={opt.key}
                    style={({ pressed }) => [
                      styles.dropdownOption,
                      isSelected && styles.dropdownOptionSelected,
                      !disabled && pressed && feedback.pressed,
                    ]}
                    onPress={disabled ? undefined : () => onSelect(opt.key)}
                    disabled={disabled}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected, disabled }}
                    accessibilityLabel={
                      opt.note != null ? `${opt.label}, ${opt.note}` : opt.label
                    }
                  >
                    <Text
                      style={[
                        styles.dropdownOptionLabel,
                        typography.body,
                        isSelected && styles.dropdownOptionLabelSelected,
                        disabled && styles.dropdownOptionLabelDisabled,
                      ]}
                      numberOfLines={1}
                    >
                      {opt.label}
                    </Text>
                    <View style={styles.dropdownRight}>
                      {disabled && opt.note != null ? (
                        <Text
                          style={[
                            styles.dropdownOptionNote,
                            typography.bodySmall,
                          ]}
                        >
                          {opt.note}
                        </Text>
                      ) : (
                        <>
                          {opt.trailing != null && (
                            <Text
                              style={[
                                styles.dropdownOptionTrailing,
                                typography.bodySmall,
                                isSelected &&
                                  styles.dropdownOptionLabelSelected,
                              ]}
                            >
                              {opt.trailing}
                            </Text>
                          )}
                          {/* A SELECTABLE row can carry a note too — a quality
                              you don't hold offline is still choosable, it just
                              costs a transfer. */}
                          {opt.note != null && (
                            <Text
                              style={[
                                styles.dropdownOptionNote,
                                typography.bodySmall,
                              ]}
                            >
                              {opt.note}
                            </Text>
                          )}
                          {isSelected && (
                            <Ionicons
                              name="checkmark"
                              size={18}
                              color="#ffffff"
                            />
                          )}
                        </>
                      )}
                    </View>
                  </Pressable>
                )
              })}
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  )
}

/** R1: what the viewer asked the sheet to do with the video. */
export type DownloadMode = "offline" | "raw"

/**
 * The raw label names the PLATFORM's own photos app: Apple's is called Photos,
 * and "Gallery" is the term Android users recognise whatever the OEM ships.
 *
 * A function of the OS, not a `Platform.OS` conditional read inline, because
 * jest runs this app as iOS ONLY — an inline read would leave the Android
 * wording permanently unexercised.
 */
export function rawModeLabel(platformOS: string): string {
  return platformOS === "ios" ? "Save to Photos" : "Save to Gallery"
}

/**
 * The label carries the whole choice — there is no description beside it — so
 * each one names its destination. Short enough to sit on ONE line in a
 * half-width card; lengthening either one wraps both.
 */
export const DOWNLOAD_MODE_LABELS: Record<DownloadMode, string> = {
  offline: "Offline Watching",
  raw: rawModeLabel(Platform.OS),
}

/**
 * Screen-reader only. The visible descriptions are gone, but a hint costs a
 * sighted viewer nothing and still explains where the file ends up.
 */
const DOWNLOAD_MODE_HINTS: Record<DownloadMode, string> = {
  offline: "Watch it in the app without a network.",
  raw: "Keep it in your device library, outside the app.",
}

const DOWNLOAD_MODE_ANNOUNCEMENTS: Record<DownloadMode, string> = {
  offline: "Offline copy selected. The subtitle choice is available.",
  raw: "Device file selected. The subtitle choice is hidden. A saved file carries no subtitles.",
}

/** R37, series sheet: a count at the selected quality, not one named quality. */
export function formatSeriesReuseNote(
  reusableCount: number,
  totalCount: number,
): string {
  const head = `${reusableCount} of ${totalCount} episodes reuse an offline copy at this quality.`
  return reusableCount >= totalCount
    ? head
    : `${head} The other episodes download again.`
}

/**
 * R32: an export replaces nothing, so raw mode lifts every already-downloaded
 * gate the offline path applies. Offline mode keeps the value it computed.
 */
/** Sentinel for the "bundle no subtitle" row; a slug can never collide with it. */
export const NO_SUBTITLE_KEY = "__none__"

/**
 * The subtitle choice, shared by BOTH sheets rather than copied into each — a
 * duplicated control is this repo's recorded way for a fix to reach only one
 * screen. `union` is slug → display name, so a dub carrying two tracks for one
 * language (normalizeDubMedia does not dedupe) cannot produce duplicate rows.
 */
export function SubtitlePicker({
  union,
  selectedSlug,
  downloadedSlug,
  open,
  onToggle,
  onSelect,
}: {
  union: Map<string, string>
  selectedSlug: string | null
  /** Already-saved subtitle (null = saved with none, undefined = n/a) → disabled. */
  downloadedSlug?: string | null
  open: boolean
  onToggle: () => void
  onSelect: (slug: string | null) => void
}) {
  const options = useMemo<DropdownOption[]>(() => {
    // Only a saved subtitle LANGUAGE is "already downloaded" — the "No subtitles"
    // row is never disabled (re-downloading "no subtitle" isn't a thing).
    const disabledKey =
      typeof downloadedSlug === "string" ? downloadedSlug : null
    const mark = (opt: DropdownOption): DropdownOption =>
      opt.key === disabledKey
        ? { ...opt, disabled: true, note: "Already downloaded" }
        : opt
    const base: DropdownOption[] = [
      mark({ key: NO_SUBTITLE_KEY, label: "No subtitles" }),
    ]
    const sorted = [...union.entries()].sort((a, b) =>
      a[1].toLowerCase().localeCompare(b[1].toLowerCase()),
    )
    for (const [slug, name] of sorted)
      base.push(mark({ key: slug, label: name }))
    return base
  }, [union, downloadedSlug])

  return (
    <Dropdown
      sectionLabel="Subtitles"
      options={options}
      selectedKey={selectedSlug ?? NO_SUBTITLE_KEY}
      open={open}
      onToggle={onToggle}
      onSelect={(key) => onSelect(key === NO_SUBTITLE_KEY ? null : key)}
    />
  )
}

/**
 * slug → display name for one dub's tracks. A Map because the normalizer does
 * not dedupe by language, and `languageName` can normalize to "" — an empty
 * label would render a blank row.
 */
export function subtitleUnionOf(
  subtitles: readonly {
    languageSlug: string
    languageName: string
  }[],
): Map<string, string> {
  const union = new Map<string, string>()
  for (const sub of subtitles) {
    if (!sub.languageSlug) continue
    union.set(sub.languageSlug, sub.languageName || sub.languageSlug)
  }
  return union
}

export function suspendedInRawMode<T>(
  mode: DownloadMode,
  value: T,
): T | undefined {
  return mode === "raw" ? undefined : value
}

/**
 * R1: the two modes, on both sheets, from one implementation. R33's switch
 * removes it entirely rather than disabling it — a disabled control describes
 * something this build cannot do.
 */
export function DownloadModeControl({
  mode,
  onChange,
}: {
  mode: DownloadMode
  onChange: (mode: DownloadMode) => void
}) {
  const typography = useTypography()
  if (!RAW_EXPORT_ENABLED) return null

  const select = (next: DownloadMode) => {
    if (next === mode) return
    onChange(next)
    // The subtitle region leaves with the mode, so a screen reader hears why.
    AccessibilityInfo.announceForAccessibility(
      DOWNLOAD_MODE_ANNOUNCEMENTS[next],
    )
  }

  return (
    <View style={styles.modeSection}>
      <View accessibilityRole="radiogroup" style={styles.modeGroup}>
        {(["offline", "raw"] as const).map((option) => {
          const checked = option === mode
          return (
            <Pressable
              key={option}
              style={({ pressed }) => [
                styles.modeOption,
                checked && styles.modeOptionSelected,
                pressed && feedback.pressed,
              ]}
              onPress={() => select(option)}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              accessibilityLabel={DOWNLOAD_MODE_LABELS[option]}
              accessibilityHint={DOWNLOAD_MODE_HINTS[option]}
            >
              {/* The filled dot carries the choice too, so the selected row
                  never rests on colour alone. */}
              <Ionicons
                name={checked ? "radio-button-on" : "radio-button-off"}
                size={20}
                color={checked ? ACCENT : TEXT_SECONDARY}
              />
              <View style={styles.modeTextGroup}>
                <Text
                  style={[
                    styles.modeLabel,
                    typography.body,
                    checked && styles.modeLabelSelected,
                  ]}
                >
                  {DOWNLOAD_MODE_LABELS[option]}
                </Text>
              </View>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/** A note the sheet states above the pickers, in raw mode only. */
export function SheetNote({ text }: { text: string }) {
  const typography = useTypography()
  return <Text style={[styles.sheetNote, typography.bodySmall]}>{text}</Text>
}

/**
 * The consent gate both sheets show in raw mode. Shared, like every other
 * control on these two sheets: a hand-copied second version is this repo's
 * recorded way for a fix — a wording change, a legal correction — to reach
 * only one screen.
 */
export function TermsAcceptanceRow({
  accepted,
  onToggle,
  onOpenTerms,
}: {
  accepted: boolean
  onToggle: () => void
  onOpenTerms: () => void
}) {
  const typography = useTypography()
  return (
    <View style={styles.touRow}>
      <Pressable
        onPress={onToggle}
        hitSlop={8}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        accessibilityLabel="I agree to the Terms of Use"
        style={({ pressed }) => pressed && feedback.pressed}
      >
        <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
          {accepted && <Ionicons name="checkmark" size={16} color="#ffffff" />}
        </View>
      </Pressable>
      <Text style={[styles.touText, typography.bodySmall]}>
        I agree to the{" "}
      </Text>
      <Pressable
        onPress={onOpenTerms}
        hitSlop={4}
        accessibilityRole="link"
        accessibilityLabel="Read Terms of Use"
      >
        <Text style={[styles.touLink, typography.bodySmall]}>Terms of Use</Text>
      </Pressable>
    </View>
  )
}

export type DownloadSheetProps = {
  videoTitle: string | null
  duration: number | null
  languageName: string | null
  downloads: WatchDownload[]
  /** The dub's subtitle tracks, offered beside the quality in offline mode. */
  subtitles: readonly WatchSubtitle[]
  /**
   * The subtitle active on the watch screen. It SEEDS the picker, so a viewer
   * watching with Spanish captions who just taps Download still gets them —
   * defaulting to "No subtitles" like the series sheet would silently ship a
   * caption-less copy.
   */
  subtitleLanguageSlug: string | null
  /**
   * The completed offline copy's rendition, or null when the video has none.
   *
   * BOTH identifiers, because neither is reliable alone: `normalizeVideo`
   * defaults `documentId` to "" (so an empty id would match the first row by
   * accident), and `quality` is the raw rendition string, unique within a dub
   * but not guaranteed present. The id wins when it is real.
   */
  offlineCopy?: { renditionId: string; quality: string } | null
  /** The subtitle language of a completed offline copy, for the reuse note. */
  offlineCopySubtitleSlug?: string | null
  /**
   * Which mode the sheet OPENS on. R2 still holds — the sheet never remembers
   * the last choice — but an entry point that exists to do one specific thing
   * ("Save to Photos" on a downloaded video) may say so, once, on the way in.
   */
  initialMode?: DownloadMode
  /**
   * Start the chosen rendition in the chosen mode, with the subtitle picked
   * HERE (null = none). The route builds the full request, dismisses the sheet,
   * and downloads via DownloadsProvider.
   */
  onStartDownload: (
    rendition: WatchDownload,
    mode: DownloadMode,
    subtitleSlug: string | null,
  ) => void
}

export function DownloadSheetContent({
  videoTitle,
  duration,
  languageName,
  subtitles,
  subtitleLanguageSlug,
  downloads,
  offlineCopy = null,
  offlineCopySubtitleSlug = undefined,
  initialMode = "offline",
  onStartDownload,
}: DownloadSheetProps) {
  const insets = useSafeAreaInsets()
  const typography = useTypography()

  const tiered = useMemo(() => tierDownloads(downloads), [downloads])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [touAccepted, setTouAccepted] = useState(false)
  const [termsVisible, setTermsVisible] = useState(false)
  const [qualityOpen, setQualityOpen] = useState(false)
  const [subtitleOpen, setSubtitleOpen] = useState(false)
  // R2: nothing writes the choice back; a fresh sheet takes `initialMode`,
  // which the caller sets per entry point and defaults to offline.
  const [mode, setMode] = useState<DownloadMode>(initialMode)
  const rawMode = mode === "raw"
  // Owner decision 2026-09-14: only an EXPORT needs the Terms. An offline
  // copy stays inside the app; a saved file leaves it, which is what the
  // clause is about. The acceptance itself survives a mode switch.
  const termsSatisfied = !rawMode || touAccepted

  const subtitleUnion = useMemo(() => subtitleUnionOf(subtitles), [subtitles])
  const [subtitleSlug, setSubtitleSlug] = useState<string | null>(null)
  // The dub's tracks arrive lazily, so a useState initializer would seed from
  // an empty union and stick at null. Seed when they land, and only ONCE — a
  // re-render must never overwrite a manual pick. Only a slug the dub actually
  // carries is selectable; anything else names a row the picker never renders.
  const subtitleTouchedRef = useRef(false)
  useEffect(() => {
    if (subtitleTouchedRef.current) return
    if (
      subtitleLanguageSlug == null ||
      !subtitleUnion.has(subtitleLanguageSlug)
    )
      return
    subtitleTouchedRef.current = true
    setSubtitleSlug(subtitleLanguageSlug)
  }, [subtitleUnion, subtitleLanguageSlug])

  // Key by tier-array index, not documentId: ids aren't unique (normalizeVideo
  // defaults documentId to "" and doesn't dedupe), so they'd collide React keys
  // and break selection (findIndex always resolving to the first match).
  // Which tier the offline copy is, or -1. By documentId: the record's
  // qualityLabel is the raw rendition string, not one of the three tier names.
  const heldIndex = useMemo(() => {
    if (offlineCopy == null) return -1
    const byId = offlineCopy.renditionId
      ? tiered.findIndex(
          (t) =>
            t.documentId !== "" && t.documentId === offlineCopy.renditionId,
        )
      : -1
    if (byId >= 0) return byId
    return offlineCopy.quality
      ? tiered.findIndex((t) => t.quality === offlineCopy.quality)
      : -1
  }, [tiered, offlineCopy])

  const qualityOptions = useMemo<DropdownOption[]>(
    () =>
      tiered.map((t, index) => ({
        key: String(index),
        label: t.tier,
        trailing: formatFileSize(t.size),
        // Only in raw mode: the held copy exports instantly, every other
        // quality has to come down the wire first. In offline mode the same
        // row means a swap, which the sheet already frames as a swap.
        note:
          rawMode && heldIndex >= 0 && index !== heldIndex
            ? "Downloads again"
            : undefined,
      })),
    [tiered, rawMode, heldIndex],
  )
  const selectedQualityKey = String(selectedIndex)

  // Keep selectedIndex in range if the renditions list changes out from under
  // it — otherwise the trigger shows a stale tier while Download silently
  // no-ops (handleDownload reads tiered[selectedIndex]).
  useEffect(() => {
    if (selectedIndex >= tiered.length) setSelectedIndex(0)
  }, [tiered.length, selectedIndex])

  // Open on the quality already held, so "Save to Photos" on a downloaded
  // video is a reuse rather than a silent re-download. Once, when the tiers
  // land — they arrive with the lazily-fetched dub, and a later re-run would
  // fight the viewer's own pick.
  // Gated on `heldIndex` — the value it seeds FROM — not on the tiers being
  // present. The renditions come back from Apollo's cache on the first render
  // while the offline record arrives a tick later from DownloadsProvider, so a
  // tiers-gated one-shot burns itself before there is anything to seed with.
  // A manual pick sets the same latch, so a late-arriving record never
  // overrides the viewer.
  const qualityTouchedRef = useRef(false)
  useEffect(() => {
    if (qualityTouchedRef.current || heldIndex < 0) return
    qualityTouchedRef.current = true
    setSelectedIndex(heldIndex)
  }, [heldIndex])

  const handleDownload = useCallback(() => {
    if (!termsSatisfied || tiered.length === 0) return
    const selected = tiered[selectedIndex]
    if (!selected) return
    // Enqueue and hand off to the background engine; the parent dismisses the
    // sheet. One copy per video is enforced by DownloadsProvider.
    onStartDownload(selected, mode, rawMode ? null : subtitleSlug)
  }, [
    termsSatisfied,
    tiered,
    selectedIndex,
    mode,
    rawMode,
    subtitleSlug,
    onStartDownload,
  ])

  if (downloads.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons
          name="cloud-download-outline"
          size={48}
          color={TEXT_SECONDARY}
        />
        <Text style={[styles.emptyText, typography.body]}>
          No downloads available
        </Text>
      </View>
    )
  }

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        <View style={styles.header}>
          {videoTitle != null && (
            <Text
              style={[styles.videoTitle, typography.titleLarge]}
              numberOfLines={2}
            >
              {videoTitle}
            </Text>
          )}
          <View style={styles.metaRow}>
            {duration != null && duration > 0 && (
              <View style={styles.metaPill}>
                <Ionicons
                  name="time-outline"
                  size={14}
                  color={TEXT_SECONDARY}
                />
                <Text style={[styles.metaPillText, typography.bodySmall]}>
                  {formatDuration(duration)}
                </Text>
              </View>
            )}
            {languageName != null && (
              <View style={styles.metaPill}>
                <Ionicons
                  name="globe-outline"
                  size={14}
                  color={TEXT_SECONDARY}
                />
                <Text style={[styles.metaPillText, typography.bodySmall]}>
                  {languageName}
                </Text>
              </View>
            )}
            {/* R5: an exported file cannot carry the subtitle, so raw mode
                removes the pill instead of describing an empty promise. It
                mirrors the PICKED subtitle, so the header and the picker below
                can never disagree. */}
            {!rawMode && (
              <View style={styles.metaPill}>
                <MaterialCommunityIcons
                  name="closed-caption-outline"
                  size={16}
                  color={TEXT_SECONDARY}
                />
                <Text style={[styles.metaPillText, typography.bodySmall]}>
                  {(subtitleSlug != null
                    ? subtitleUnion.get(subtitleSlug)
                    : null) ?? "No subtitles"}
                </Text>
              </View>
            )}
          </View>
        </View>

        <DownloadModeControl mode={mode} onChange={setMode} />

        <Dropdown
          sectionLabel="Select a file size"
          options={qualityOptions}
          selectedKey={selectedQualityKey}
          open={qualityOpen}
          onToggle={() => setQualityOpen((o) => !o)}
          onSelect={(key) => {
            qualityTouchedRef.current = true
            setSelectedIndex(Number(key))
            setQualityOpen(false)
          }}
        />

        {/* R5: only an offline copy can carry a subtitle, so the picker leaves
            with raw mode. The chosen slug SURVIVES the hide, mirroring the
            series sheet, so switching back restores the choice. */}
        {!rawMode && subtitleUnion.size > 0 && (
          <SubtitlePicker
            union={subtitleUnion}
            selectedSlug={subtitleSlug}
            downloadedSlug={offlineCopySubtitleSlug}
            open={subtitleOpen}
            onToggle={() => setSubtitleOpen((o) => !o)}
            onSelect={(slug) => {
              subtitleTouchedRef.current = true
              setSubtitleSlug(slug)
              setSubtitleOpen(false)
            }}
          />
        )}

        {rawMode && (
          <TermsAcceptanceRow
            accepted={touAccepted}
            onToggle={() => setTouAccepted((v) => !v)}
            onOpenTerms={() => setTermsVisible(true)}
          />
        )}

        <Pressable
          style={({ pressed }) => [
            styles.downloadButton,
            !termsSatisfied && styles.downloadButtonDisabled,
            pressed && termsSatisfied && feedback.pressed,
          ]}
          onPress={handleDownload}
          disabled={!termsSatisfied}
          accessibilityRole="button"
          accessibilityLabel={
            rawMode ? "Save video to the device" : "Download video"
          }
          accessibilityState={{ disabled: !termsSatisfied }}
        >
          <Ionicons name="download-outline" size={20} color="#ffffff" />
          <Text style={[styles.downloadButtonText, typography.body]}>
            {rawMode ? "Save to device" : "Download"}
          </Text>
        </Pressable>
      </ScrollView>

      <TermsModal
        visible={termsVisible}
        onAccept={() => {
          setTouAccepted(true)
          setTermsVisible(false)
        }}
        onCancel={() => setTermsVisible(false)}
      />
    </>
  )
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 36,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    paddingVertical: 48,
  },
  emptyText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    textAlign: "center",
  },
  header: {
    marginBottom: 24,
  },
  videoTitle: {
    color: TEXT_PRIMARY,
    fontWeight: "700",
    fontFamily: "System",
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    // Wrap chips onto the next line instead of pushing a long language name
    // (and the chips after it) off the right edge. Row gap matches the column.
    flexWrap: "wrap",
    rowGap: 8,
    columnGap: 8,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  metaPillText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
  dropdownSection: {
    marginBottom: 24,
  },
  modeSection: {
    marginBottom: 24,
  },
  modeGroup: {
    // Side by side. The default `stretch` keeps both cards the height of the
    // taller one, so the longer label wrapping does not leave a short sibling.
    flexDirection: "row",
    gap: 8,
  },
  modeOption: {
    // Equal halves, so neither card's width depends on its label length.
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    // Tighter than the stacked layout was: the card is now half as wide and
    // the longer label needs the room more than the padding does.
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    minHeight: 48,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  modeOptionSelected: {
    borderColor: ACCENT,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  modeTextGroup: {
    flexShrink: 1,
  },
  modeLabel: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
  },
  modeLabelSelected: {
    fontWeight: "600",
  },
  sheetNote: {
    color: TEXT_BODY,
    fontFamily: "System",
    marginBottom: 16,
  },
  dropdownSectionLabel: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    marginBottom: 12,
  },
  dropdownPanelScroll: {
    maxHeight: DROPDOWN_MAX_HEIGHT,
  },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 8,
    minHeight: 48,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  dropdownTriggerOpen: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  dropdownValue: {
    color: TEXT_PRIMARY,
    fontWeight: "600",
    fontFamily: "System",
    flexShrink: 1,
    marginRight: 8,
  },
  dropdownRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dropdownTrailing: {
    color: TEXT_BODY,
    fontFamily: "System",
  },
  dropdownPanel: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    overflow: "hidden",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
  },
  dropdownOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
  },
  dropdownOptionSelected: {
    backgroundColor: ACCENT,
  },
  dropdownOptionLabel: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    flexShrink: 1,
    marginRight: 8,
  },
  dropdownOptionLabelSelected: {
    color: "#ffffff",
    fontWeight: "600",
  },
  dropdownOptionTrailing: {
    color: TEXT_BODY,
    fontFamily: "System",
  },
  dropdownOptionLabelDisabled: {
    color: TEXT_SECONDARY,
    opacity: 0.55,
  },
  dropdownOptionNote: {
    color: TEXT_SECONDARY,
    opacity: 0.75,
    fontFamily: "System",
    fontStyle: "italic",
  },
  touRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  touText: {
    color: TEXT_BODY,
    fontFamily: "System",
  },
  touLink: {
    color: ACCENT,
    fontWeight: "600",
    fontFamily: "System",
    textDecorationLine: "underline",
  },
  downloadButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    minHeight: 48,
  },
  downloadButtonDisabled: {
    opacity: 0.5,
  },
  downloadButtonText: {
    color: "#ffffff",
    fontWeight: "600",
    fontFamily: "System",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
  },
  termsContainer: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.95)",
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  termsTitle: {
    color: TEXT_PRIMARY,
    fontWeight: "700",
    fontFamily: "System",
    marginBottom: 16,
  },
  termsScroll: {
    flex: 1,
  },
  termsText: {
    color: TEXT_BODY,
    fontFamily: "System",
  },
  termsParagraphGap: {
    marginTop: 16,
  },
  termsFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.1)",
  },
  termsCancelButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
  },
  termsCancelText: {
    color: TEXT_SECONDARY,
    fontWeight: "600",
    fontFamily: "System",
  },
  termsAcceptButton: {
    backgroundColor: ACCENT,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
  },
  termsAcceptText: {
    color: "#ffffff",
    fontWeight: "600",
    fontFamily: "System",
  },
})
