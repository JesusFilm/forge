export type AppVersionParts = {
  version: string | null
  build: string | null
}

function present(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** "Version 1.0.0 (7)", or "Version 1.0.0" with no build number. With no
 *  version the line has nothing to say, so it is null. */
export function formatAppVersion(parts: AppVersionParts): string | null {
  const version = present(parts.version)
  if (version == null) return null
  const build = present(parts.build)
  return build == null ? `Version ${version}` : `Version ${version} (${build})`
}

/* eslint-disable @typescript-eslint/no-require-imports */
// A dev client built before expo-application red-boxes on the require, so the
// probe comes first. expo-constants has no build number, so a fallback has none.
function readNative(): AppVersionParts {
  try {
    const { requireOptionalNativeModule } = require("expo") as {
      requireOptionalNativeModule: (name: string) => unknown
    }
    if (requireOptionalNativeModule("ExpoApplication") == null)
      return { version: null, build: null }
    const application = require("expo-application") as {
      nativeApplicationVersion?: unknown
      nativeBuildVersion?: unknown
    }
    return {
      version: present(application.nativeApplicationVersion),
      build: present(application.nativeBuildVersion),
    }
  } catch {
    return { version: null, build: null }
  }
}

function readConfigVersion(): string | null {
  try {
    const constants = require("expo-constants") as {
      default?: { expoConfig?: { version?: unknown } | null }
    }
    return present(constants.default?.expoConfig?.version)
  } catch {
    return null
  }
}
/* eslint-enable @typescript-eslint/no-require-imports */

export function readAppVersionParts(): AppVersionParts {
  const native = readNative()
  if (native.version != null) return native
  return { version: readConfigVersion(), build: null }
}
