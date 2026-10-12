const NATIVE_MODES = ["rtl", "ltr", "none"] as const
const RELOAD_KINDS = ["start", "return"] as const

export type NativeMode = (typeof NATIVE_MODES)[number]
export type ReloadKind = (typeof RELOAD_KINDS)[number]

export type LayoutDirectionState = {
  nativeMode: NativeMode | null
  reloadCount: number
  reloadKind: ReloadKind | null
  reloadBundle: string | null
  /** The last direction fault reported since the record was cleared. */
  reportedFault: string | null
}

export type SaveDirectionInput = {
  isRTL: boolean
  nativeMode: NativeMode
  reloadCount: number
  reloadKind: ReloadKind | null
  reloadBundle: string | null
}

export type LayoutDirectionModule = {
  /** False in Expo Go, older dev clients, and Jest: every call does nothing. */
  available: boolean
  getState(): LayoutDirectionState
  /** Resolves only after React Native's direction, the native mode, and the
   *  reload record are on disk. A new record clears the reported fault. */
  saveDirection(input: SaveDirectionInput): Promise<void>
  saveNativeMode(mode: NativeMode): Promise<void>
  /** Applies a mode to native containers without saving it. */
  applyNativeMode(mode: NativeMode): Promise<void>
  saveReportedFault(fault: string): Promise<void>
  /** Clears the reload count, kind, bundle, and reported fault. */
  clearReloadRecord(): Promise<void>
}

type NativeLayoutDirection = {
  getState(): Record<string, unknown>
  saveDirection(
    isRTL: boolean,
    nativeMode: NativeMode,
    reloadCount: number,
    reloadKind: ReloadKind | null,
    reloadBundle: string | null,
  ): Promise<void>
  saveNativeMode(mode: NativeMode): Promise<void>
  applyNativeMode(mode: NativeMode): Promise<void>
  saveReportedFault(fault: string): Promise<void>
  clearReloadRecord(): Promise<void>
}

const EMPTY_STATE: LayoutDirectionState = {
  nativeMode: null,
  reloadCount: 0,
  reloadKind: null,
  reloadBundle: null,
  reportedFault: null,
}

const INERT: LayoutDirectionModule = {
  available: false,
  getState: () => EMPTY_STATE,
  saveDirection: async () => {},
  saveNativeMode: async () => {},
  applyNativeMode: async () => {},
  saveReportedFault: async () => {},
  clearReloadRecord: async () => {},
}

function presentString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function oneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): T | null {
  return (values as readonly unknown[]).includes(value) ? (value as T) : null
}

function readState(raw: Record<string, unknown>): LayoutDirectionState {
  const count = raw.reloadCount
  return {
    nativeMode: oneOf(NATIVE_MODES, raw.nativeMode),
    reloadCount:
      typeof count === "number" && Number.isInteger(count) && count > 0
        ? count
        : 0,
    reloadKind: oneOf(RELOAD_KINDS, raw.reloadKind),
    reloadBundle: presentString(raw.reloadBundle),
    reportedFault: presentString(raw.reportedFault),
  }
}

function wrap(native: NativeLayoutDirection): LayoutDirectionModule {
  return {
    available: true,
    getState: () => readState(native.getState() ?? {}),
    saveDirection: (input) =>
      native.saveDirection(
        input.isRTL,
        input.nativeMode,
        input.reloadCount,
        input.reloadKind,
        input.reloadBundle,
      ),
    saveNativeMode: (mode) => native.saveNativeMode(mode),
    applyNativeMode: (mode) => native.applyNativeMode(mode),
    saveReportedFault: (fault) => native.saveReportedFault(fault),
    clearReloadRecord: () => native.clearReloadRecord(),
  }
}

let cached: LayoutDirectionModule | null = null

/* eslint-disable @typescript-eslint/no-require-imports */
function load(): LayoutDirectionModule {
  try {
    const { requireOptionalNativeModule } = require("expo") as {
      requireOptionalNativeModule: (name: string) => unknown
    }
    const native = requireOptionalNativeModule("LayoutDirection")
    return native == null ? INERT : wrap(native as NativeLayoutDirection)
  } catch {
    return INERT
  }
}
/* eslint-enable @typescript-eslint/no-require-imports */

export function getLayoutDirectionModule(): LayoutDirectionModule {
  cached ??= load()
  return cached
}
