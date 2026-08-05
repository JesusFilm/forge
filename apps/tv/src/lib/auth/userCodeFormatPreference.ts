// Persisted choice of user-code format for the sign-in screen (feat-322).
// Both RFC 8628 formats are implemented so the decision can be made from real
// screens; this remembers which one the device is showing across launches.
//
// This is a PRE-SHIP evaluation switch, not a per-user setting: the format
// must be identical on every platform forever (Paramount+ varies it per
// device and produced users holding a code that won't fit the web field), so
// once the call is made this module and its toggle come out together.

import { getStorage } from "../safeStorage"
import {
  DEFAULT_USER_CODE_FORMAT,
  USER_CODE_FORMATS,
  type UserCodeFormat,
} from "./deviceAuthFlow"

export const USER_CODE_FORMAT_STORAGE_KEY = "forge.tv.user_code_format"

/** Narrows unknown storage content to a format, else the default. */
export function parseUserCodeFormat(raw: string | null): UserCodeFormat {
  return USER_CODE_FORMATS.includes(raw as UserCodeFormat)
    ? (raw as UserCodeFormat)
    : DEFAULT_USER_CODE_FORMAT
}

/** The other format — the toggle is binary today and asserts so at the type
 *  level, so adding a third format fails to compile here rather than silently
 *  making one unreachable. */
export function nextUserCodeFormat(current: UserCodeFormat): UserCodeFormat {
  return current === "letters" ? "numbers" : "letters"
}

export async function loadUserCodeFormat(): Promise<UserCodeFormat> {
  try {
    return parseUserCodeFormat(
      await getStorage().getItem(USER_CODE_FORMAT_STORAGE_KEY),
    )
  } catch {
    return DEFAULT_USER_CODE_FORMAT
  }
}

/** Best-effort: a storage failure must never block the sign-in screen. */
export async function saveUserCodeFormat(
  format: UserCodeFormat,
): Promise<void> {
  try {
    await getStorage().setItem(USER_CODE_FORMAT_STORAGE_KEY, format)
  } catch {
    // Ignored — the in-memory choice still applies for this run.
  }
}
