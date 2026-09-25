// The top bar's download button (feat-551 U10, R29, R30). A native alert
// shows the catalog size before a download starts; the same alert cancels,
// retries, updates, and removes. The top bar shows the progress.
import { Alert } from "react-native"

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
import { READER_SHEET_COPY } from "./copy"
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

const COPY = READER_SHEET_COPY.download

const OK: DownloadPromptButton = {
  label: COPY.ok,
  style: "default",
  action: "dismiss",
}

function failedMessage(
  translation: CatalogTranslation,
  state: Extract<TranslationDownloadState, { kind: "failed" }>,
): string {
  const bodies = COPY.failedBody
  if (state.reason === "no-space") {
    return bodies["no-space"](
      formatDownloadSize(translation.downloadBytes * DOWNLOAD_SPACE_FACTOR),
    )
  }
  return bodies[state.reason]
}

export function downloadPrompt(input: DownloadPromptInput): DownloadPrompt {
  const { translation, state, runningId } = input
  const { name } = translation
  const size = formatDownloadSize(translation.downloadBytes)
  // R30: BSB is inside the app, whatever a state says.
  if (translation.id === BSB_TRANSLATION_ID || state.kind === "bundled") {
    return {
      title: COPY.bundledTitle(name),
      message: COPY.bundledBody,
      buttons: [OK],
    }
  }
  const start = (label: string): DownloadPromptButton => ({
    label,
    style: "default",
    action: "start",
  })
  const close: DownloadPromptButton = {
    label: READER_SHEET_COPY.close,
    style: "cancel",
    action: "dismiss",
  }
  const remove: DownloadPromptButton = {
    label: COPY.remove,
    style: "destructive",
    action: "remove",
  }
  const busy = runningId !== null && runningId !== translation.id

  switch (state.kind) {
    case "downloading":
      return {
        title: COPY.runningTitle(name),
        message:
          state.phase === "install"
            ? COPY.installingBody
            : COPY.runningBody(Math.round(state.percent), size),
        buttons: [
          { label: COPY.keepGoing, style: "cancel", action: "dismiss" },
          { label: COPY.stop, style: "destructive", action: "cancel-download" },
        ],
      }
    case "downloaded":
      if (isUpdateAvailable(translation, state) && !busy) {
        return {
          title: COPY.updateTitle(name),
          message: COPY.updateBody(size),
          buttons: [close, remove, start(COPY.update)],
        }
      }
      return {
        title: COPY.onDeviceTitle(name),
        message: COPY.onDeviceBody(formatDownloadSize(state.bytes)),
        buttons: [close, remove],
      }
    case "failed":
      if (busy) break
      return {
        title: COPY.failedTitle(name),
        message: failedMessage(translation, state),
        buttons:
          state.reason === "too-large"
            ? [OK]
            : [
                { label: COPY.cancel, style: "cancel", action: "dismiss" },
                start(COPY.retry),
              ],
      }
    case "checking":
    case "not-downloaded":
      if (busy) break
      return {
        title: COPY.startTitle(name),
        message: COPY.startBody(size),
        buttons: [
          { label: COPY.cancel, style: "cancel", action: "dismiss" },
          start(COPY.start),
        ],
      }
  }
  return { title: COPY.busyTitle, message: COPY.busyBody, buttons: [OK] }
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
      // The state store reports the result; the top bar shows it. R37 logs
      // the outcome once, when the download ends.
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

// U11 wires the reader's `onOpenDownload` here. It reads the manifests first,
// so a download the device already holds never shows as not downloaded.
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
