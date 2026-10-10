// The download button on the translation sheet's Current card (feat-553 U10,
// R29, R30; owner, 2026-10-01). A native alert shows the size before a
// download starts; the same alert cancels, retries, updates, and removes.
import { Alert } from "react-native"

import { getT, type UiT } from "../../../i18n/useT"
import { formatFileSize } from "../../downloadTiers"
import type { CatalogTranslation } from "../data/catalog"
import { getTranslationDownloads } from "../repository/downloadRuntime"
import {
  DOWNLOAD_SPACE_FACTOR,
  type TranslationDownloadState,
  type TranslationDownloads,
} from "../repository/translationDownloads"
import { reportTranslationDownload } from "../telemetry"
import { BSB_TRANSLATION_ID } from "../versification/classify"
import { isUpdateAvailable } from "./translationList"

export type DownloadPromptAction =
  | "start"
  | "cancel-download"
  | "remove"
  | "dismiss"

export type DownloadPromptButton = {
  label: string
  style: "default" | "cancel" | "destructive"
  action: DownloadPromptAction
}

export type DownloadPrompt = {
  title: string
  message: string
  buttons: DownloadPromptButton[]
}

export type DownloadPromptInput = {
  translation: CatalogTranslation
  state: TranslationDownloadState
  /** The translation that downloads now, if any: one runs at a time. */
  runningId: string | null
}

export function formatDownloadSize(bytes: number): string {
  return formatFileSize(String(bytes))
}

type DownloadT = UiT<"BibleDownload">

function failedMessage(
  t: DownloadT,
  translation: CatalogTranslation,
  state: Extract<TranslationDownloadState, { kind: "failed" }>,
): string {
  switch (state.reason) {
    case "no-space":
      return t("failedNoSpace", {
        size: formatDownloadSize(
          translation.downloadBytes * DOWNLOAD_SPACE_FACTOR,
        ),
      })
    case "network":
      return t("failedNetwork")
    case "too-large":
      return t("failedTooLarge")
    case "invalid-data":
      return t("failedInvalidData")
    case "write-failed":
      return t("failedWriteFailed")
  }
}

// A native alert, so its text comes from the catalog in use when it opens.
export function downloadPrompt(input: DownloadPromptInput): DownloadPrompt {
  const t = getT("BibleDownload")
  const OK: DownloadPromptButton = {
    label: t("ok"),
    style: "default",
    action: "dismiss",
  }
  const { translation, state, runningId } = input
  const { name } = translation
  const size = formatDownloadSize(translation.downloadBytes)
  // R30: BSB is inside the app, whatever a state says.
  if (translation.id === BSB_TRANSLATION_ID || state.kind === "bundled") {
    return {
      title: t("bundledTitle", { name }),
      message: t("bundledBody"),
      buttons: [OK],
    }
  }
  const start = (label: string): DownloadPromptButton => ({
    label,
    style: "default",
    action: "start",
  })
  const close: DownloadPromptButton = {
    label: t("close"),
    style: "cancel",
    action: "dismiss",
  }
  const remove: DownloadPromptButton = {
    label: t("remove"),
    style: "destructive",
    action: "remove",
  }
  const busy = runningId !== null && runningId !== translation.id

  switch (state.kind) {
    case "downloading":
      return {
        title: t("runningTitle", { name }),
        message:
          state.phase === "install"
            ? t("installingBody")
            : t("runningBody", { percent: Math.round(state.percent), size }),
        buttons: [
          { label: t("keepGoing"), style: "cancel", action: "dismiss" },
          {
            label: t("stop"),
            style: "destructive",
            action: "cancel-download",
          },
        ],
      }
    case "downloaded":
      if (isUpdateAvailable(translation, state) && !busy) {
        return {
          title: t("updateTitle", { name }),
          message: t("updateBody", { size }),
          buttons: [close, remove, start(t("update"))],
        }
      }
      return {
        title: t("onDeviceTitle", { name }),
        message: t("onDeviceBody", { size: formatDownloadSize(state.bytes) }),
        buttons: [close, remove],
      }
    case "failed":
      if (busy) break
      return {
        title: t("failedTitle", { name }),
        message: failedMessage(t, translation, state),
        buttons:
          state.reason === "too-large"
            ? [OK]
            : [
                { label: t("cancel"), style: "cancel", action: "dismiss" },
                start(t("retry")),
              ],
      }
    case "checking":
    case "not-downloaded":
      if (busy) break
      return {
        title: t("startTitle", { name }),
        message: t("startBody", { size }),
        buttons: [
          { label: t("cancel"), style: "cancel", action: "dismiss" },
          start(t("start")),
        ],
      }
  }
  return { title: t("busyTitle"), message: t("busyBody"), buttons: [OK] }
}

export type DownloadPromptDownloads = Pick<
  TranslationDownloads,
  "check" | "getState" | "runningId" | "start" | "cancel" | "remove"
>

/** `Alert.alert`'s shape, so a test can capture the buttons. */
export type DownloadPromptAlert = (
  title: string,
  message: string,
  buttons: {
    text: string
    style: DownloadPromptButton["style"]
    onPress: () => void
  }[],
) => void

export type DownloadPromptDeps = {
  downloads?: DownloadPromptDownloads
  alert?: DownloadPromptAlert
}

export function runDownloadAction(
  action: DownloadPromptAction,
  translation: CatalogTranslation,
  downloads: DownloadPromptDownloads,
): void {
  switch (action) {
    case "start":
      // The state store reports the result; the card and the translation
      // pill show it. R37 logs the outcome once, when the download ends.
      void downloads
        .start(translation)
        .then((outcome) => reportTranslationDownload(translation, outcome))
        .catch(() => undefined)
      return
    case "cancel-download":
      downloads.cancel(translation.id)
      return
    case "remove":
      void downloads.remove(translation.id).catch(() => undefined)
      return
    case "dismiss":
      return
  }
}

// The Current card's button opens this. It reads the manifests first, so a
// download the device already holds never shows as not downloaded.
export async function presentReaderDownloadPrompt(
  context: { translation: CatalogTranslation | null },
  deps: DownloadPromptDeps = {},
): Promise<void> {
  const { translation } = context
  if (!translation) return
  const downloads = deps.downloads ?? getTranslationDownloads()
  const alert: DownloadPromptAlert = deps.alert ?? Alert.alert
  try {
    await downloads.check()
  } catch {
    // An unread manifest reads as not downloaded; the prompt still shows.
  }
  const prompt = downloadPrompt({
    translation,
    state: downloads.getState(translation.id),
    runningId: downloads.runningId(),
  })
  alert(
    prompt.title,
    prompt.message,
    prompt.buttons.map((button) => ({
      text: button.label,
      style: button.style,
      onPress: () => runDownloadAction(button.action, translation, downloads),
    })),
  )
}
