import type { UiT } from "../i18n/useT"

/** The folder-picker label; the noun follows the platform (Apple's app is
 *  Files). The OS is an argument because jest runs as iOS only, and an inline
 *  `Platform.OS` read would leave the Android label untested. */
export function rawModeLabel(
  platformOS: string,
  t: UiT<"DownloadSheet">,
): string {
  return platformOS === "ios" ? t("saveToFiles") : t("saveToDevice")
}
