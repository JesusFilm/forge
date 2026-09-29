import { getT, type UiT } from "../i18n/useT"

/**
 * Both platforms open a folder picker, so both labels name the same act. The
 * noun follows the platform: Apple's app is called Files, and Android's picker
 * is the system file chooser whatever the OEM ships.
 *
 * A function of the OS, not a `Platform.OS` conditional read inline, because
 * jest runs this app as iOS ONLY — an inline read would leave the Android
 * wording permanently unexercised.
 */
export function rawModeLabel(
  platformOS: string,
  // A `.ts` module, so a menu built at tap time reads the catalog in use then.
  t: UiT<"DownloadSheet"> = getT("DownloadSheet"),
): string {
  return platformOS === "ios" ? t("saveToFiles") : t("saveToDevice")
}
