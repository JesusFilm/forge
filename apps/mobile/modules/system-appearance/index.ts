/** The phone's own light or dark setting; null when it is not known. */
export type PhoneColorScheme = "light" | "dark" | null

export type SystemAppearanceModule = {
  /** False in Expo Go, older dev clients, Android, and Jest: the setting is null. */
  available: boolean
  /** The native cache of the window scene's style. It ignores the app's own
   *  dark window override (feat-705 KTD3, KTD4). */
  getPhoneColorScheme(): PhoneColorScheme
  addChangeListener(listener: (scheme: PhoneColorScheme) => void): {
    remove(): void
  }
}

// Keep in step with `Events(...)` in ios/SystemAppearanceModule.swift.
const CHANGE_EVENT = "onChange"

type NativeSystemAppearance = {
  getColorScheme(): unknown
  addListener(
    event: typeof CHANGE_EVENT,
    listener: (event: { colorScheme?: unknown } | null) => void,
  ): { remove(): void }
}

const INERT: SystemAppearanceModule = {
  available: false,
  getPhoneColorScheme: () => null,
  addChangeListener: () => ({ remove: () => {} }),
}

function readScheme(value: unknown): PhoneColorScheme {
  return value === "light" || value === "dark" ? value : null
}

function wrap(native: NativeSystemAppearance): SystemAppearanceModule {
  return {
    available: true,
    getPhoneColorScheme: () => readScheme(native.getColorScheme()),
    addChangeListener: (listener) =>
      native.addListener(CHANGE_EVENT, (event) =>
        listener(readScheme(event?.colorScheme)),
      ),
  }
}

let cached: SystemAppearanceModule | null = null

/* eslint-disable @typescript-eslint/no-require-imports */
function load(): SystemAppearanceModule {
  try {
    const { requireOptionalNativeModule } = require("expo") as {
      requireOptionalNativeModule: (name: string) => unknown
    }
    const native = requireOptionalNativeModule("SystemAppearance")
    return native == null ? INERT : wrap(native as NativeSystemAppearance)
  } catch {
    return INERT
  }
}
/* eslint-enable @typescript-eslint/no-require-imports */

export function getSystemAppearanceModule(): SystemAppearanceModule {
  cached ??= load()
  return cached
}
