/**
 * The one place the push text is built (R14). Each function reads the catalog
 * when it runs, never at load, so the text follows a language change.
 */

import { getT } from "../../i18n/useT"

/**
 * R21: shown when a notification names a destination this build cannot read:
 * an unknown kind or a malformed payload. A destination that no longer exists
 * is NOT this message — that route shows its own not-found screen (R30).
 */
export function pushUnresolvableDestinationMessage(): string {
  return getT("Push")("unresolvableDestination")
}

/** The Android channel's name, in the UI language of the pass (KTD9). */
export function pushAnnouncementsChannelName(): string {
  return getT("Push")("announcementsChannelName")
}

export type PushTestIdCopy = Readonly<{
  title: string
  help: string
  registering: string
  notificationsOff: string
  close: string
  copy: string
}>

/** R31's alert text, read once per reveal. */
export function pushTestIdCopy(): PushTestIdCopy {
  const t = getT("Push")
  return {
    title: t("testIdTitle"),
    help: t("testIdHelp"),
    registering: t("testIdRegistering"),
    notificationsOff: t("testIdNotificationsOff"),
    close: t("testIdClose"),
    copy: t("testIdCopy"),
  }
}
