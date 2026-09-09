import AsyncStorage from "@react-native-async-storage/async-storage"
import { documentDirectory } from "expo-file-system/legacy"
import * as MediaLibrary from "expo-media-library"
import { AppState, Platform } from "react-native"

import { publishExportReport } from "../components/ExportReportHost"
import { datadogLog } from "./datadog"
import {
  notifyIosBackgroundComplete,
  startMediaDownload,
  stopTask,
} from "./downloadEngine"
import { getExportSessionStore } from "./exportSession"
import {
  copyFile,
  ensureDirectory,
  fileExists,
  freeDiskBytes,
  removeUri,
} from "./offlineFileSystem"
import type { OfflineDownloadRecord } from "./offlineManifest"
import {
  createRawExportAdapter,
  type RawExportAdapter,
} from "./rawExportAdapter"
import { buildExportRoot, createTransferPort } from "./transferPort"

/**
 * The composition root for raw file export: the ONE place the injected ports of
 * `rawExportAdapter` meet their real native bindings. Everything below it stays
 * pure and unit-testable, which is why no other module imports
 * `expo-media-library` or the download engine for export.
 *
 * Built lazily. Module scope would load the native media library during the
 * bundle's first evaluation, which is the shape that turns a module-level throw
 * into a white screen.
 */

/**
 * R13/R36: the export reads offline records and never writes one. Records live
 * in React state, so `DownloadsProvider` attaches the reader the way it attaches
 * the session store's storage port.
 */
let findOfflineRecord: (
  videoSlug: string,
) => OfflineDownloadRecord | null | undefined = () => null

/**
 * Wire the runtime's two host-owned dependencies. Called once from
 * `DownloadsProvider`, which owns both the manifest and the app's storage.
 */
export function attachRawExportRuntime(deps: {
  findOfflineRecord: (
    videoSlug: string,
  ) => OfflineDownloadRecord | null | undefined
}): void {
  findOfflineRecord = deps.findOfflineRecord
  getExportSessionStore().attachStorage({
    get: (key) => AsyncStorage.getItem(key),
    set: (key, value) => AsyncStorage.setItem(key, value),
    remove: (key) => AsyncStorage.removeItem(key),
  })
}

let adapter: RawExportAdapter | null = null

export function getRawExportAdapter(): RawExportAdapter {
  if (adapter) return adapter
  adapter = createRawExportAdapter({
    exportRoot: buildExportRoot(documentDirectory),
    port: createTransferPort({
      start: startMediaDownload,
      stop: stopTask,
      notifyBackgroundComplete: notifyIosBackgroundComplete,
    }),
    fs: {
      ensureDirectory,
      removeUri,
      copyFile,
      fileExists,
      freeDiskBytes,
    },
    library: {
      // `true` is the write-only flag: it asks for the add-only scope KTD7
      // declares, and never the full-access one.
      getPermission: () => MediaLibrary.getPermissionsAsync(true),
      requestPermission: () => MediaLibrary.requestPermissionsAsync(true),
      saveToLibrary: (uri) => MediaLibrary.saveToLibraryAsync(uri),
      createAsset: (uri) => MediaLibrary.createAssetAsync(uri),
      // The port types the asset as `unknown` on purpose — it is opaque to
      // every pure module. Cast to the call's own parameter type, not to a
      // named export, because the package ships two `Asset` shapes.
      createAlbum: (albumName, asset, copyAsset) =>
        MediaLibrary.createAlbumAsync(
          albumName,
          asset as Parameters<typeof MediaLibrary.createAlbumAsync>[1],
          copyAsset,
        ),
    },
    platform: Platform.OS === "android" ? "android" : "ios",
    getAppState: () => AppState.currentState,
    findOfflineRecord: (videoSlug) => findOfflineRecord(videoSlug),
    report: publishExportReport,
    telemetry: datadogLog,
  })
  return adapter
}

/** Test-only: drop the memoised adapter so a suite builds a fresh one. */
export function resetRawExportRuntimeForTests(): void {
  adapter = null
  findOfflineRecord = () => null
}
