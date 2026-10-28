import { useMemo } from "react"
import { Platform } from "react-native"
import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { validateStreamingUrl } from "../../lib/validateUrl"
import { NativeTrackChoice } from "./NativeTrackChoice"
import type { TrackChoiceOption } from "./androidTrackChoiceSession"
import { deriveSubtitlePanelState, type DetailsDataState } from "./panelState"

export function NativeDetailsTrackPanel({
  kind,
  dataState,
  onRetry,
  onClose,
}: {
  kind: "audio" | "subtitles"
  dataState?: DetailsDataState
  onRetry?: () => void
  onClose: () => void
}) {
  const session = useWatchSession()
  const subtitles = useMemo(
    () => deriveSubtitlePanelState(session.activeVariantMediaState, dataState),
    [session.activeVariantMediaState, dataState],
  )
  const phase = kind === "audio" ? (dataState ?? "ready") : subtitles.kind
  const options = useMemo<TrackChoiceOption[]>(() => {
    const rows: TrackChoiceOption[] = []
    if (kind === "subtitles")
      rows.push({ id: "__off__", label: "Subtitles Off", pinned: true })
    if (phase === "error")
      rows.push({ id: "__retry__", label: "Try again", pinned: true })
    if (kind === "audio" && phase === "ready") {
      rows.push(
        ...(session.video?.variants ?? []).map((variant) => ({
          id: variant.documentId,
          label:
            variant.languageName ?? variant.languageSlug ?? "Unknown language",
          detail: variant.languageNameNative ?? "",
          searchText: `${variant.languageSlug ?? ""} ${variant.languageBcp47 ?? ""}`,
          disabled: !validateStreamingUrl(variant.hls),
        })),
      )
    } else if (kind === "subtitles" && subtitles.kind === "loaded") {
      rows.push(
        ...subtitles.subtitles.map((track) => ({
          id: track.languageSlug,
          label: track.languageName || track.languageSlug,
          detail: track.languageNameNative ?? "",
          searchText: track.languageBcp47,
        })),
      )
    }
    return rows
  }, [kind, phase, session.video?.variants, subtitles])
  const status =
    phase === "loading"
      ? "Loading languages…"
      : phase === "error"
        ? "Couldn’t load languages"
        : options.every((row) => row.pinned)
          ? "No languages available"
          : null
  return (
    <NativeTrackChoice
      nativeModuleName={
        Platform.OS === "android" ? "NativeAndroidPlayer" : "NativeSwiftPlayer"
      }
      title={kind === "audio" ? "Audio Language" : "Subtitles"}
      options={options}
      selected={
        kind === "audio"
          ? (session.activeVariant?.documentId ?? null)
          : session.subtitleEnabled
            ? session.activeSubtitleSlug
            : "__off__"
      }
      status={status}
      onClose={onClose}
      onSelect={(id) => {
        if (id === "__retry__") {
          if (kind === "audio" || dataState === "error") onRetry?.()
          else session.ensureActiveVariantMedia()
          return false
        }
        if (kind === "audio") {
          const index =
            session.video?.variants.findIndex(
              (variant) => variant.documentId === id,
            ) ?? -1
          if (index >= 0) session.setActiveVariantIndex(index)
        } else if (id === "__off__") session.setSubtitleEnabled(false)
        else if (
          subtitles.kind === "loaded" &&
          subtitles.subtitles.some((track) => track.languageSlug === id)
        ) {
          session.setActiveSubtitleSlug(id)
          session.setSubtitleEnabled(true)
        }
        onClose()
      }}
    />
  )
}
