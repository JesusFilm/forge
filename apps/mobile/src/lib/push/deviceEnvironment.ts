/**
 * What the phone itself supplies for a registration (R2): the platform, the app
 * build, the phone's own language tag and its time zone.
 *
 * The locale and the zone come from the standard `Intl` API, which needs no new
 * dependency. The engine caches the zone per launch, so a viewer who flies
 * across zones registers the new one on the next start (R3, KTD9).
 *
 * `resolvePushDeviceEnvironment` is the pure half, so every branch is testable;
 * `readPushDeviceEnvironment` is the one place that touches the platform.
 */

import { Platform } from "react-native"
import Constants from "expo-constants"

import {
  normalizePhoneLocale,
  normalizeTimeZone,
  resolveAppBuild,
  type PushDeviceEnvironment,
} from "./payload"

export type PushDeviceEnvironmentInput = {
  platformOs: string
  version: string | null | undefined
  /** EAS resolves the build number remotely, so it is absent in a local run. */
  platformBuild: string | number | null | undefined
  locale: string | null | undefined
  timeZone: string | null | undefined
}

export function resolvePushDeviceEnvironment(
  input: PushDeviceEnvironmentInput,
): PushDeviceEnvironment {
  return {
    // Admin knows two transports. A web bundle registers nothing, so anything
    // that is not Android reads as iOS rather than inventing a third value.
    platform: input.platformOs === "android" ? "ANDROID" : "IOS",
    appBuild: resolveAppBuild(input.version, input.platformBuild),
    phoneLocale: normalizePhoneLocale(input.locale),
    timeZone: normalizeTimeZone(input.timeZone),
  }
}

/** The phone's own locale tag and zone, or nothing when `Intl` refuses. */
export function readIntlOptions(): {
  locale: string | null
  zone: string | null
} {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions()
    return { locale: resolved.locale ?? null, zone: resolved.timeZone ?? null }
  } catch {
    return { locale: null, zone: null }
  }
}

export function readPushDeviceEnvironment(): PushDeviceEnvironment {
  const config = Constants.expoConfig
  const intl = readIntlOptions()
  return resolvePushDeviceEnvironment({
    platformOs: Platform.OS,
    version: config?.version,
    platformBuild:
      Platform.OS === "android"
        ? config?.android?.versionCode
        : config?.ios?.buildNumber,
    locale: intl.locale,
    timeZone: intl.zone,
  })
}
