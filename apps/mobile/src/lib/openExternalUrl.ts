/**
 * Open an external (CMS-/config-sourced) URL in the system browser. Lives
 * apart from validateUrl.ts so that module stays RN-free for the pure
 * watchHome logic modules that import it.
 */
import { Linking } from "react-native"

import { validateActionUrl } from "./validateUrl"

export function openExternalUrl(url: string): void {
  if (validateActionUrl(url)) {
    Linking.openURL(url)
  }
}
