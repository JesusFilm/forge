import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useRouter } from "expo-router"
import Ionicons from "@expo/vector-icons/Ionicons"

import {
  Dropdown,
  TermsModal,
  type DropdownOption,
} from "../../src/components/watch/DownloadSheet"
import { SheetError } from "../../src/components/watch/SheetError"
import { useSeriesSession } from "../../src/contexts/SeriesSessionProvider"
import { useDownloads } from "../../src/contexts/DownloadsProvider"
import { useWatchPreferences } from "../../src/contexts/WatchPreferencesProvider"
import { STORAGE_RESERVE_BYTES } from "../../src/lib/offlineConstants"
import { useTypography } from "../../src/hooks/useTypography"
import {
  ACCENT,
  TEXT_BODY,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../src/lib/color"
import { feedback, HORIZONTAL_PADDING } from "../../src/styles/shared"
import { getApolloClient } from "../../src/lib/apolloClient"
import { GET_VIDEO_BY_SLUG, GET_VIDEO_DUB } from "../../src/lib/queries"
import { normalizeDubMedia, normalizeVideo } from "../../src/lib/normalizeVideo"
import {
  formatFileSize,
  formatTierSize,
  type QualityTier,
} from "../../src/lib/downloadTiers"
import {
  resolveSeriesDownload,
  summarizeResolution,
  type SeriesDownloadResolution,
  type SeriesEpisodeResolution,
} from "../../src/lib/seriesDownloadResolver"
import {
  evaluateStorageGate,
  formatEnqueueSummary,
  runSeriesBatchEnqueue,
  type EnqueueSummary,
} from "../../src/lib/seriesDownloadEnqueue"
import { freeDiskBytes } from "../../src/lib/offlineFileSystem"

// Series locale matches the series detail query (app/series/[slug].tsx).
const LOCALE = "en"

const QUALITY_TIERS: readonly QualityTier[] = ["Highest", "High", "Low"]
const NO_SUBTITLE_KEY = "__none__"

type SheetPhase =
  | { kind: "resolving" }
  | { kind: "error"; offline: boolean }
  | { kind: "ready"; resolution: SeriesDownloadResolution }
  | { kind: "enqueuing" }
  | { kind: "done"; summary: EnqueueSummary }

export default function SeriesDownloadRoute() {
  const router = useRouter()
  const { series, selectedLanguageSlug, languages } = useSeriesSession()
  const {
    getRecord,
    startDownload,
    swapDownload,
    supersedeDownload,
    deleteDownload,
    queueBatchRecords,
  } = useDownloads()
  const { wifiOnly } = useWatchPreferences()
  const typography = useTypography()
  const insets = useSafeAreaInsets()

  const [qualityTier, setQualityTier] = useState<QualityTier>("Highest")
  const [qualityOpen, setQualityOpen] = useState(false)
  const [subtitleSlug, setSubtitleSlug] = useState<string | null>(null)
  const [subtitleOpen, setSubtitleOpen] = useState(false)
  const [touAccepted, setTouAccepted] = useState(false)
  const [termsVisible, setTermsVisible] = useState(false)

  const [phase, setPhase] = useState<SheetPhase>({ kind: "resolving" })
  const [storageError, setStorageError] = useState<string | null>(null)
  // Union of subtitle language { slug → name } seen across the resolved set's dub
  // media — collected as a byproduct of the resolution fan-out (the resolver only
  // returns the chosen track, so the union is gathered here from the same fetch).
  const [subtitleUnion, setSubtitleUnion] = useState<Map<string, string>>(
    () => new Map(),
  )
  // The mount-effect controller is cleaned up by its own effect, but a Retry tap
  // spawns a fresh controller outside that effect — track the active one here so
  // each retry aborts the prior fan-out and unmount aborts the last one (R10).
  const retryControllerRef = useRef<AbortController | null>(null)
  useEffect(() => () => retryControllerRef.current?.abort(), [])

  const episodes = series?.episodes ?? null
  const languageSlug = selectedLanguageSlug
  const languageName =
    languages.find((l) => l.slug === languageSlug)?.name ?? languageSlug ?? ""

  // Re-resolve the set for the current quality/language/subtitle choice; aborted
  // on each re-run and unmount so a stale fan-out never writes the new phase.
  // `onlyFailedFrom` restricts to failed episodes (Retry failed) + merges back.
  const runResolution = useCallback(
    async (
      controller: AbortController,
      onlyFailedFrom?: SeriesDownloadResolution,
    ) => {
      if (!episodes || !languageSlug) return
      const target = onlyFailedFrom
        ? episodes.filter((e) =>
            onlyFailedFrom.episodes.some(
              (r) => r.slug === e.slug && r.status === "failed-resolve",
            ),
          )
        : episodes

      setPhase({ kind: "resolving" })
      const client = getApolloClient()
      const subtitleSeen = new Map<string, string>()

      const resolution = await resolveSeriesDownload(
        target,
        { qualityTier, languageSlug, subtitleLanguageSlug: subtitleSlug },
        {
          // Resolution is silent — no progress UI — so the fan-out just fetches;
          // the per-tier sizes appear on the Quality rows once ready.
          getEpisodeVariants: async (slug: string) => {
            const res = await client.query({
              query: GET_VIDEO_BY_SLUG,
              variables: { slug, locale: LOCALE },
              fetchPolicy: "cache-first" as const,
            })
            return normalizeVideo(res.data?.videoBySlug ?? null)?.variants ?? []
          },
          getDubMedia: async (dubDocumentId: string) => {
            const res = await client.query({
              query: GET_VIDEO_DUB,
              variables: { id: dubDocumentId },
              fetchPolicy: "cache-first" as const,
            })
            const media = normalizeDubMedia(res.data?.videoDub ?? null)
            for (const sub of media.subtitles) {
              if (sub.languageSlug) {
                subtitleSeen.set(
                  sub.languageSlug,
                  sub.languageName || sub.languageSlug,
                )
              }
            }
            return media
          },
        },
        controller.signal,
      )
      // Post-unmount guard: never write state after the sheet aborts (R10).
      if (controller.signal.aborted) return

      const merged = onlyFailedFrom
        ? mergeResolution(onlyFailedFrom, resolution)
        : resolution

      setSubtitleUnion((prev) =>
        onlyFailedFrom ? new Map([...prev, ...subtitleSeen]) : subtitleSeen,
      )

      // A total failure (every episode failed-resolve) is distinct from an
      // all-skipped set: it offers retry, not a disabled Confirm.
      const allFailed =
        merged.episodes.length > 0 &&
        merged.failedCount === merged.episodes.length
      if (allFailed) {
        setPhase({ kind: "error", offline: isOffline(resolution) })
        return
      }
      setPhase({ kind: "ready", resolution: merged })
    },
    [episodes, languageSlug, qualityTier, subtitleSlug],
  )

  // Mount / choice-change resolution. New controller per run; aborted on cleanup.
  useEffect(() => {
    const controller = new AbortController()
    void runResolution(controller)
    return () => controller.abort()
  }, [runResolution])

  const resolution = phase.kind === "ready" ? phase.resolution : null

  // Quality options carry each tier's whole-series total as trailing text (the
  // per-video sheet's pattern); the size hint lives here, not in a separate panel.
  const qualityOptions = useMemo<DropdownOption[]>(
    () =>
      QUALITY_TIERS.map((t) => ({
        key: t,
        label: t,
        trailing: resolution
          ? formatTierSize(resolution.tierTotals[t])
          : undefined,
      })),
    [resolution],
  )

  const onConfirm = useCallback(async () => {
    if (!resolution || resolution.resolvedCount === 0 || !touAccepted) return
    setStorageError(null)

    const free = await freeDiskBytes()
    const gate = evaluateStorageGate({
      resolution,
      getRecord,
      freeBytes: free,
      reserveBytes: STORAGE_RESERVE_BYTES,
    })
    if (gate.kind === "unreadable-free") {
      setStorageError("Couldn't check storage. Try again.")
      return
    }
    if (gate.kind === "insufficient") {
      const shortfall = gate.requiredBytes - gate.freeBytes
      setStorageError(
        `Not enough storage. You need about ${formatBytes(shortfall)} more free space.`,
      )
      return
    }

    setPhase({ kind: "enqueuing" })
    const ctx = {
      subtitleLanguageSlug: subtitleSlug,
      allowCellular: !wifiOnly,
    }
    // Snapshot → queue placeholders → enqueue lives in runSeriesBatchEnqueue so
    // the R10 ordering invariant is unit-tested off the route.
    const summary = await runSeriesBatchEnqueue(resolution.resolved, ctx, {
      getRecord,
      startDownload,
      swapDownload,
      supersedeDownload,
      deleteDownload,
      queueBatchRecords,
    })
    // An all-ok batch dismisses straight away; otherwise show the summary panel.
    if (summary.allOk) {
      router.back()
      return
    }
    setPhase({ kind: "done", summary })
  }, [
    resolution,
    touAccepted,
    subtitleSlug,
    wifiOnly,
    getRecord,
    startDownload,
    swapDownload,
    supersedeDownload,
    deleteDownload,
    queueBatchRecords,
    router,
  ])

  const onRetry = useCallback(() => {
    retryControllerRef.current?.abort()
    const controller = new AbortController()
    retryControllerRef.current = controller
    void runResolution(controller)
  }, [runResolution])

  const onRetryFailed = useCallback(() => {
    if (!resolution) return
    retryControllerRef.current?.abort()
    const controller = new AbortController()
    retryControllerRef.current = controller
    void runResolution(controller, resolution)
  }, [resolution, runResolution])

  if (!series || !episodes || !languageSlug) return null

  // ── Render per phase ──────────────────────────────────────────────
  if (phase.kind === "error") {
    return (
      <SheetError
        message={
          phase.offline
            ? "You appear to be offline. Reconnect and try again."
            : "Couldn't load these episodes. Check your connection and try again."
        }
        onRetry={onRetry}
      />
    )
  }

  return (
    <ScrollView
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: insets.bottom + 24 },
      ]}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
    >
      <Text style={[styles.title, typography.titleLarge]} numberOfLines={2}>
        {series.title ?? "Download all"}
      </Text>
      <Text style={[styles.subtitle, typography.bodySmall]}>
        {episodes.length} {episodes.length === 1 ? "episode" : "episodes"} ·{" "}
        {languageName}
      </Text>

      <Dropdown
        sectionLabel="Quality"
        options={qualityOptions}
        selectedKey={qualityTier}
        open={qualityOpen}
        onToggle={() => setQualityOpen((o) => !o)}
        onSelect={(key) => {
          setQualityTier(key as QualityTier)
          setQualityOpen(false)
        }}
      />

      {/* No audio picker: the download language is the series' selected dub
          (Language button / sheet), shown in the header line above. */}
      <SubtitlePicker
        union={subtitleUnion}
        selectedSlug={subtitleSlug}
        open={subtitleOpen}
        onToggle={() => setSubtitleOpen((o) => !o)}
        onSelect={(slug) => {
          setSubtitleSlug(slug)
          setSubtitleOpen(false)
        }}
      />

      {/* Status panel — resolving / partial / all-skipped / summary. */}
      <StatusPanel
        phase={phase}
        languageName={languageName}
        onRetryFailed={onRetryFailed}
        typography={typography}
      />

      {storageError != null && (
        <Text style={[styles.storageError, typography.bodySmall]}>
          {storageError}
        </Text>
      )}

      {phase.kind === "done" ? (
        <Pressable
          style={({ pressed }) => [
            styles.confirmButton,
            pressed && feedback.pressed,
          ]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text style={[styles.confirmButtonText, typography.body]}>Done</Text>
        </Pressable>
      ) : (
        <>
          <View style={styles.touRow}>
            <Pressable
              onPress={() => setTouAccepted((v) => !v)}
              hitSlop={8}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: touAccepted }}
              accessibilityLabel="I agree to the Terms of Use"
              style={({ pressed }) => pressed && feedback.pressed}
            >
              <View
                style={[styles.checkbox, touAccepted && styles.checkboxChecked]}
              >
                {touAccepted && (
                  <Ionicons name="checkmark" size={16} color="#ffffff" />
                )}
              </View>
            </Pressable>
            <Text style={[styles.touText, typography.bodySmall]}>
              I agree to the{" "}
            </Text>
            <Pressable
              onPress={() => setTermsVisible(true)}
              hitSlop={4}
              accessibilityRole="link"
              accessibilityLabel="Read Terms of Use"
            >
              <Text style={[styles.touLink, typography.bodySmall]}>
                Terms of Use
              </Text>
            </Pressable>
          </View>

          <ConfirmButton
            phase={phase}
            resolution={resolution}
            touAccepted={touAccepted}
            onConfirm={onConfirm}
            typography={typography}
          />
        </>
      )}

      <TermsModal
        visible={termsVisible}
        onAccept={() => {
          setTouAccepted(true)
          setTermsVisible(false)
        }}
        onCancel={() => setTermsVisible(false)}
      />
    </ScrollView>
  )
}

// ── Subcomponents ───────────────────────────────────────────────────

function SubtitlePicker({
  union,
  selectedSlug,
  open,
  onToggle,
  onSelect,
}: {
  /** slug → display name, the union of subtitle tracks across resolved episodes. */
  union: Map<string, string>
  selectedSlug: string | null
  open: boolean
  onToggle: () => void
  onSelect: (slug: string | null) => void
}) {
  const options = useMemo<DropdownOption[]>(() => {
    const base: DropdownOption[] = [
      { key: NO_SUBTITLE_KEY, label: "No subtitles" },
    ]
    const sorted = [...union.entries()].sort((a, b) =>
      a[1].toLowerCase().localeCompare(b[1].toLowerCase()),
    )
    for (const [slug, name] of sorted) base.push({ key: slug, label: name })
    return base
  }, [union])

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

function StatusPanel({
  phase,
  languageName,
  onRetryFailed,
  typography,
}: {
  phase: SheetPhase
  languageName: string
  onRetryFailed: () => void
  typography: ReturnType<typeof useTypography>
}) {
  // Resolving and enqueuing render no panel: resolution is silent (per-tier
  // sizes appear on the Quality rows when ready) and enqueuing shows its state
  // on the confirm button ("Downloading"). Both fall through to null.

  if (phase.kind === "done") {
    const line = formatEnqueueSummary(phase.summary)
    return (
      <View style={styles.statusPanel}>
        <Text style={[styles.statusText, typography.body]}>
          {line || "Nothing to download."}
        </Text>
      </View>
    )
  }

  if (phase.kind === "ready") {
    const r = phase.resolution
    if (r.resolvedCount === 0) {
      return (
        <View style={styles.statusPanel}>
          <Text style={[styles.statusText, typography.body]}>
            {`None of the episodes are available in ${languageName}.`}
          </Text>
        </View>
      )
    }
    const skipped = r.skippedLanguageCount + r.skippedNoRenditionCount
    // The total size now rides on the Quality picker; this panel is only the
    // partial-resolution warnings, so omit it entirely when there are none.
    if (skipped === 0 && r.failedCount === 0) return null
    return (
      <View style={styles.statusPanel}>
        {skipped > 0 && (
          <Text style={[styles.skippedText, typography.bodySmall]}>
            {`${skipped} skipped (unavailable in ${languageName})`}
          </Text>
        )}
        {r.failedCount > 0 && (
          <View style={styles.failedRow}>
            <Text style={[styles.skippedText, typography.bodySmall]}>
              {`${r.failedCount} couldn't be checked`}
            </Text>
            <Pressable
              onPress={onRetryFailed}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Retry failed episodes"
            >
              <Text style={[styles.retryFailedText, typography.bodySmall]}>
                Retry failed
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    )
  }

  return null
}

function ConfirmButton({
  phase,
  resolution,
  touAccepted,
  onConfirm,
  typography,
}: {
  phase: SheetPhase
  resolution: SeriesDownloadResolution | null
  touAccepted: boolean
  onConfirm: () => void
  typography: ReturnType<typeof useTypography>
}) {
  const enqueuing = phase.kind === "enqueuing"
  const disabled =
    phase.kind !== "ready" ||
    !resolution ||
    resolution.resolvedCount === 0 ||
    !touAccepted

  return (
    <Pressable
      style={({ pressed }) => [
        styles.confirmButton,
        disabled && styles.confirmButtonDisabled,
        pressed && !disabled && feedback.pressed,
      ]}
      onPress={onConfirm}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={enqueuing ? "Downloading" : "Download all episodes"}
      accessibilityState={{ disabled, busy: enqueuing }}
    >
      {enqueuing ? (
        <ActivityIndicator color="#ffffff" size="small" />
      ) : (
        <Ionicons name="download-outline" size={20} color="#ffffff" />
      )}
      <Text style={[styles.confirmButtonText, typography.body]}>
        {enqueuing ? "Downloading" : "Download all"}
      </Text>
    </Pressable>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────

// Merge a failed-only re-resolution back onto the prior set by slug, then
// re-summarize via the shared resolver helper (no duplicated rollup logic).
function mergeResolution(
  prior: SeriesDownloadResolution,
  retry: SeriesDownloadResolution,
): SeriesDownloadResolution {
  const bySlug = new Map<string, SeriesEpisodeResolution>()
  for (const ep of retry.episodes) bySlug.set(ep.slug, ep)
  const episodes = prior.episodes.map((ep) => bySlug.get(ep.slug) ?? ep)
  return summarizeResolution(episodes)
}

// A fully-failed resolution is "offline" when nothing resolved AND nothing was
// even classified as language-absent/no-rendition — every episode's fetch threw.
function isOffline(resolution: SeriesDownloadResolution): boolean {
  return (
    resolution.resolvedCount === 0 &&
    resolution.skippedLanguageCount === 0 &&
    resolution.skippedNoRenditionCount === 0 &&
    resolution.failedCount > 0
  )
}

function formatBytes(bytes: number): string {
  return formatFileSize(String(Math.max(0, Math.round(bytes))))
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 36,
  },
  title: {
    color: TEXT_PRIMARY,
    fontWeight: "700",
    fontFamily: "System",
    marginBottom: 4,
  },
  subtitle: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    marginBottom: 24,
  },
  statusPanel: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
    marginBottom: 8,
  },
  statusText: {
    color: TEXT_BODY,
    fontFamily: "System",
  },
  skippedText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
  failedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    width: "100%",
  },
  retryFailedText: {
    color: ACCENT,
    fontWeight: "600",
    fontFamily: "System",
    textDecorationLine: "underline",
  },
  storageError: {
    color: ACCENT,
    fontFamily: "System",
    marginBottom: 16,
  },
  touRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
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
  confirmButton: {
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
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    color: "#ffffff",
    fontWeight: "600",
    fontFamily: "System",
  },
})
