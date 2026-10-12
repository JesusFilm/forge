// feat-694 KTD3: the app decides the layout direction from the UI Locale, and the
// layout-direction module saves it and applies it to native parts. A wrong
// direction in use costs one reload: at start, or on Android when the viewer returns.
import { reloadAppAsync } from "expo"
import { useSyncExternalStore } from "react"
import { AppState, Platform } from "react-native"

import {
  getLayoutDirectionModule,
  type LayoutDirectionState,
  type NativeMode,
  type ReloadKind,
} from "../../modules/layout-direction"
import { readAppVersionParts } from "../lib/appVersion"
import { reportDatadogError } from "../lib/datadog"
import {
  getCatalogTag,
  getLocaleResolution,
  subscribeLocale,
} from "./localeStore"
import { isLayoutRtl } from "./layoutRtl"
import { MIRRORED_LAYOUT_ENABLED } from "./mirroredLayout"
import { isRtlTag } from "./resolveLocale"

export type DirectionRecord = Pick<
  LayoutDirectionState,
  "nativeMode" | "reloadCount" | "reloadBundle" | "reportedFault"
>

export type DirectionInputs = {
  platform: string
  /** The UI catalog tag in use, e.g. `ar`. */
  uiTag: string
  mirroringEnabled: boolean
  localeReadFailed: boolean
  /** React Native's direction, fixed at the start of this JavaScript runtime. */
  inUseRTL: boolean
  record: DirectionRecord
  /** The update id, or the native build number for an embedded bundle. Only a
   *  mismatch reads it, so a matched start never loads `expo-updates`. */
  readBundle: () => string
}

export type DirectionDecision =
  | {
      kind: "matched"
      nativeMode: NativeMode
      saveNativeMode: boolean
      clearRecord: boolean
    }
  | { kind: "reload"; wantedRTL: boolean; nativeMode: NativeMode }
  | {
      kind: "stuck"
      nativeMode: NativeMode
      saveNativeMode: boolean
      fault: string
      report: boolean
    }
  | { kind: "keep"; nativeMode: NativeMode; clearRecord: boolean }

/** A record that a direction reload wrote, with no fault reported since. */
function isReloadRecord(record: DirectionRecord): boolean {
  return record.reloadCount > 0 && record.reportedFault == null
}

/** KTD5: with mirroring off, iOS forces left-to-right and Android keeps its default. */
export function nativeModeFor(
  isRTL: boolean,
  mirroringEnabled: boolean,
  platform: string,
): NativeMode {
  if (mirroringEnabled) return isRTL ? "rtl" : "ltr"
  return platform === "android" ? "none" : "ltr"
}

export function decideDirection(input: DirectionInputs): DirectionDecision {
  const { record, platform, mirroringEnabled, inUseRTL } = input
  // KTD3: an English fallback after a failed read must not cause a reload.
  if (input.localeReadFailed) {
    return {
      kind: "keep",
      nativeMode: nativeModeFor(inUseRTL, mirroringEnabled, platform),
      // A reload record left here would mark the next cold start as reloaded.
      clearRecord: isReloadRecord(record),
    }
  }
  const wantedRTL = mirroringEnabled && isRtlTag(input.uiTag)
  const nativeMode = nativeModeFor(wantedRTL, mirroringEnabled, platform)
  if (wantedRTL === inUseRTL) {
    return {
      kind: "matched",
      nativeMode,
      saveNativeMode: record.nativeMode !== nativeMode,
      clearRecord: record.reloadCount > 0 || record.reportedFault != null,
    }
  }
  // KTD4: a count from another bundle is stale, so a new update retries once.
  const bundle = input.readBundle()
  const reloads = record.reloadBundle === bundle ? record.reloadCount : 0
  if (reloads === 0) return { kind: "reload", wantedRTL, nativeMode }
  const fault = `${wantedRTL ? "rtl" : "ltr"}:${bundle}`
  const inUseMode = nativeModeFor(inUseRTL, mirroringEnabled, platform)
  return {
    kind: "stuck",
    nativeMode: inUseMode,
    saveNativeMode: record.nativeMode !== inUseMode,
    fault,
    report: record.reportedFault !== fault,
  }
}

/** A handled direction fault, reported to Datadog and never thrown to the app. */
export class LayoutDirectionFault extends Error {
  constructor(
    readonly fault:
      | "stuck"
      | "locale_read_failed"
      | "reload_failed"
      | "reload_stalled"
      | "check_failed",
  ) {
    super(`layout direction: ${fault}`)
    this.name = "LayoutDirectionFault"
  }
}

type StartSnapshot = {
  record: LayoutDirectionState
  /** The kind of direction reload that started this runtime, if any. */
  reloadedBy: ReloadKind | null
}

let snapshot: StartSnapshot | null = null
let started = false
let reloadPending = false
const pendingListeners = new Set<() => void>()

const NO_RECORD: LayoutDirectionState = {
  nativeMode: null,
  reloadCount: 0,
  reloadKind: null,
  reloadBundle: null,
  reportedFault: null,
}

/** A direction reload that has not ended this runtime by then did not happen. */
export const RELOAD_DEADLINE_MS = 8000
/** The longest wait for the native restore before the start gate opens. */
export const RESTORE_WAIT_MS = 1000

// KTD3.5: the first reader takes the record, before any clear. A reloaded
// runtime has a count and no reported fault; a stuck one has already reported.
function startSnapshot(): StartSnapshot {
  if (snapshot) return snapshot
  let record = NO_RECORD
  try {
    record = getLayoutDirectionModule().getState()
  } catch (error) {
    report("check_failed", error)
  }
  snapshot = {
    record,
    reloadedBy: isReloadRecord(record) ? record.reloadKind : null,
  }
  return snapshot
}

/** KTD9: true for the whole runtime that an Android return reload started. */
export function afterReturnReload(): boolean {
  return startSnapshot().reloadedBy === "return"
}

/** The kind of direction reload that started this runtime, for telemetry. */
export function directionReloadKind(): ReloadKind | null {
  return startSnapshot().reloadedBy
}

function setReloadPending(value: boolean): void {
  if (reloadPending === value) return
  reloadPending = value
  pendingListeners.forEach((listener) => listener())
}

function subscribeReloadPending(listener: () => void): () => void {
  pendingListeners.add(listener)
  return () => pendingListeners.delete(listener)
}

export function isDirectionReloadPending(): boolean {
  return reloadPending
}

/** True while a start reload is pending; the root layout then mounts nothing. */
export function useDirectionReloadPending(): boolean {
  return useSyncExternalStore(subscribeReloadPending, isDirectionReloadPending)
}

function currentBundle(): string {
  try {
    /* eslint-disable-next-line @typescript-eslint/no-require-imports */
    const Updates = require("expo-updates") as {
      isEnabled?: boolean
      isEmbeddedLaunch?: boolean
      updateId?: string | null
    }
    if (Updates.isEnabled && !Updates.isEmbeddedLaunch && Updates.updateId) {
      return `update:${Updates.updateId}`
    }
  } catch {
    // No expo-updates module: the bundle is the one in the native build.
  }
  return `build:${readAppVersionParts().build ?? "unknown"}`
}

/** Resolves when `work` settles or after `ms`, whichever comes first. */
function settleWithin(work: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    work.then(done, done)
  })
}

function report(fault: LayoutDirectionFault["fault"], error?: unknown): void {
  reportDatadogError(error ?? new LayoutDirectionFault(fault), {
    "layout_direction.fault": fault,
    "layout_direction.ui_tag": getCatalogTag(),
    "layout_direction.in_use_rtl": isLayoutRtl(),
  })
}

async function reloadFor(
  decision: Extract<DirectionDecision, { kind: "reload" }>,
  kind: ReloadKind,
  inUse: { isRTL: boolean; nativeMode: NativeMode },
  bundle: string,
): Promise<void> {
  const layout = getLayoutDirectionModule()
  let restored = false
  // The save sets React Native's own direction, which its layout reads on each
  // pass. So a reload that fails, or never ends this runtime, puts the direction
  // in use back; a gate behind a load also needs a time-based release.
  const restore = async (
    fault: LayoutDirectionFault["fault"],
    error?: unknown,
  ): Promise<void> => {
    if (restored) return
    restored = true
    report(fault, error)
    const putBack = (async () => {
      await layout
        .saveDirection({
          isRTL: inUse.isRTL,
          nativeMode: inUse.nativeMode,
          reloadCount: 0,
          reloadKind: null,
          reloadBundle: null,
        })
        .catch(() => {})
      await layout.applyNativeMode(inUse.nativeMode).catch(() => {})
    })()
    // A native call that never settles must not keep the gate shut.
    await settleWithin(putBack, RESTORE_WAIT_MS)
    setReloadPending(false)
  }
  const deadline = setTimeout(
    () => void restore("reload_stalled"),
    RELOAD_DEADLINE_MS,
  )
  try {
    await layout.saveDirection({
      isRTL: decision.wantedRTL,
      nativeMode: decision.nativeMode,
      reloadCount: 1,
      reloadKind: kind,
      reloadBundle: bundle,
    })
    // A save that ended after the deadline: the restore has run, so no reload.
    if (restored) return
    await reloadAppAsync("layout direction")
  } catch (error) {
    clearTimeout(deadline)
    await restore("reload_failed", error)
  }
}

function check(kind: ReloadKind): void {
  const layout = getLayoutDirectionModule()
  if (!layout.available) return
  const { record } = startSnapshot()
  let bundle: string | undefined
  const readBundle = () => (bundle ??= currentBundle())
  const inUseRTL = isLayoutRtl()
  const decision = decideDirection({
    platform: Platform.OS,
    uiTag: getCatalogTag(),
    mirroringEnabled: MIRRORED_LAYOUT_ENABLED,
    localeReadFailed: getLocaleResolution().match === "error",
    inUseRTL,
    record: kind === "start" ? record : layout.getState(),
    readBundle,
  })
  const failed = (error: unknown) => report("check_failed", error)
  switch (decision.kind) {
    case "matched":
      if (decision.saveNativeMode) {
        layout.saveNativeMode(decision.nativeMode).catch(failed)
      }
      if (decision.clearRecord) layout.clearReloadRecord().catch(failed)
      return
    case "reload":
      if (kind === "start") setReloadPending(true)
      void reloadFor(
        decision,
        kind,
        {
          isRTL: inUseRTL,
          nativeMode: nativeModeFor(
            inUseRTL,
            MIRRORED_LAYOUT_ENABLED,
            Platform.OS,
          ),
        },
        readBundle(),
      )
      return
    case "stuck":
      // KTD4: React and native parts keep one direction, the one in use.
      if (decision.saveNativeMode) {
        layout.saveNativeMode(decision.nativeMode).catch(failed)
      }
      if (decision.report) {
        report("stuck")
        layout.saveReportedFault(decision.fault).catch(failed)
      }
      return
    case "keep":
      layout.applyNativeMode(decision.nativeMode).catch(failed)
      if (decision.clearRecord) layout.clearReloadRecord().catch(failed)
      report("locale_read_failed")
      return
  }
}

// KTD3.3: Android checks again only on a move to `active` after a locale change,
// so picture-in-picture, background audio, and split screen never reload.
function watchReturns(): void {
  if (Platform.OS !== "android") return
  let localeChanged = false
  subscribeLocale(() => {
    localeChanged = true
  })
  AppState.addEventListener("change", (state) => {
    if (state !== "active" || !localeChanged) return
    localeChanged = false
    try {
      check("return")
    } catch (error) {
      report("check_failed", error)
    }
  })
}

/** KTD3: once, at module scope in app/_layout.tsx, after startLocaleSync(). */
export function startLayoutDirection(): void {
  if (started) return
  started = true
  try {
    check("start")
    watchReturns()
  } catch (error) {
    setReloadPending(false)
    report("check_failed", error)
  }
}
