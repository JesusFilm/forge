import AsyncStorage from "@react-native-async-storage/async-storage"
import { Directory, File } from "expo-file-system"
import { documentDirectory } from "expo-file-system/legacy"
// `documentDirectory` comes from the `/legacy` subpath because the package root
// re-exports it through `legacyWarnings` as a stub that THROWS at runtime. The
// `Directory` / `File` classes above are the root's own API and are not stubs.

import { publishExportReport } from "../components/ExportReportHost"
import { datadogLog } from "./datadog"
import { telemetryErrorMessage } from "./downloadErrors"
import {
  notifyIosBackgroundComplete,
  pauseTask,
  resumeTask,
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
 * pure and unit-testable, which is why no other module imports the folder
 * picker or the download engine for export.
 *
 * The ADAPTER is built lazily, so a throw while wiring it cannot happen during
 * module evaluation. That is the only deferral here: the native imports above
 * are evaluated when this module loads, and `DownloadsProvider` imports it at
 * the root layout, so they load at app start regardless of any call site.
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
      pause: pauseTask,
      resume: resumeTask,
      notifyBackgroundComplete: notifyIosBackgroundComplete,
    }),
    fs: {
      ensureDirectory,
      removeUri,
      copyFile,
      fileExists,
      freeDiskBytes,
    },
    destination: {
      // A dismissal and a picker that cannot open both reject, with codes that
      // differ per platform. Both mean no folder, so the code is logged rather
      // than matched — a version bump must not turn a dismissal into a failure.
      pickFolder: async () => {
        try {
          const directory = await Directory.pickDirectoryAsync()
          return { uri: directory.uri }
        } catch (error) {
          datadogLog.info("raw_export.folder_not_picked", {
            error_message: telemetryErrorMessage(error),
          })
          return null
        }
      },
      listNames: async (folder) =>
        new Directory(folder.uri).list().map((entry) => entry.name),
      copyInto: async ({ stagedPath, folder, fileName }) => {
        const source = new File(stagedPath)
        // The destination child takes the SOURCE's name on both platforms, so
        // the rename is what names the saved file. Appending the name to the
        // folder's uri instead resolves back to the folder on an Android tree.
        if (source.name !== fileName) source.rename(fileName)
        await source.copy(new Directory(folder.uri))
      },
      removeIfExists: async ({ folder, fileName }) => {
        const match = new Directory(folder.uri)
          .list()
          .find((entry) => entry.name === fileName)
        match?.delete()
      },
    },
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
