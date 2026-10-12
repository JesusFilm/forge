// feat-692 KTD3: the app decides the layout direction from the UI Locale, and the
// layout-direction module saves it and applies it to native parts. A wrong
// direction in use costs one reload: at start, or on Android when the viewer returns.
import { reloadAppAsync } from "expo"
import { useSyncExternalStore } from "react"
import { AppState, I18nManager, Platform } from "react-native"

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
  /** The update id, or the native build number for an embedded bundle. */
  bundle: string
}

export type DirectionDecision =
  | {
      kind: "matched"
      nativeMode: NativeMode
      saveNativeMode: boolean
      clearRecord: boolean
    }
  | { kind: "reload"; wantedRTL: boolean; nativeMode: NativeMode }
  | { kind: "stuck"; nativeMode: NativeMode; fault: string; report: boolean }
  | { kind: "keep"; nativeMode: NativeMode }

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
  const reloads = record.reloadBundle === input.bundle ? record.reloadCount : 0
  if (reloads === 0) return { kind: "reload", wantedRTL, nativeMode }
  const fault = `${wantedRTL ? "rtl" : "ltr"}:${input.bundle}`
  return {
    kind: "stuck",
    nativeMode: nativeModeFor(inUseRTL, mirroringEnabled, platform),
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

// KTD3.5: the first reader takes the record, before any clear. A reloaded
// runtime has a count and no reported fault; a stuck one has already reported.
function startSnapshot(): StartSnapshot {
  if (snapshot) return snapshot
  const record = getLayoutDirectionModule().getState()
  const reloaded = record.reloadCount > 0 && record.reportedFault == null
  snapshot = { record, reloadedBy: reloaded ? record.reloadKind : null }
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

function report(fault: LayoutDirectionFault["fault"], error?: unknown): void {
  reportDatadogError(error ?? new LayoutDirectionFault(fault), {
    "layout_direction.fault": fault,
    "layout_direction.ui_tag": getCatalogTag(),
    "layout_direction.in_use_rtl": I18nManager.getConstants().isRTL,
  })
}

async function reloadFor(
  decision: Extract<DirectionDecision, { kind: "reload" }>,
  kind: ReloadKind,
  inUseMode: NativeMode,
  bundle: string,
): Promise<void> {
  const layout = getLayoutDirectionModule()
  try {
    await layout.saveDirection({
      isRTL: decision.wantedRTL,
      nativeMode: decision.nativeMode,
      reloadCount: 1,
      reloadKind: kind,
      reloadBundle: bundle,
    })
    await reloadAppAsync("layout direction")
  } catch (error) {
    report("reload_failed", error)
    await layout.applyNativeMode(inUseMode).catch(() => {})
    await layout.clearReloadRecord().catch(() => {})
    setReloadPending(false)
  }
}

function check(kind: ReloadKind): void {
  const layout = getLayoutDirectionModule()
  if (!layout.available) return
  const { record } = startSnapshot()
  const bundle = currentBundle()
  const inUseRTL = I18nManager.getConstants().isRTL
  const decision = decideDirection({
    platform: Platform.OS,
    uiTag: getCatalogTag(),
    mirroringEnabled: MIRRORED_LAYOUT_ENABLED,
    localeReadFailed: getLocaleResolution().match === "error",
    inUseRTL,
    record: kind === "start" ? record : layout.getState(),
    bundle,
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
        nativeModeFor(inUseRTL, MIRRORED_LAYOUT_ENABLED, Platform.OS),
        bundle,
      )
      return
    case "stuck":
      // KTD4: React and native parts keep one direction, the one in use.
      layout.saveNativeMode(decision.nativeMode).catch(failed)
      if (decision.report) {
        report("stuck")
        layout.saveReportedFault(decision.fault).catch(failed)
      }
      return
    case "keep":
      layout.applyNativeMode(decision.nativeMode).catch(failed)
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
