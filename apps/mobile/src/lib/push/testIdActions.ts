/**
 * The copy action of R31's test ID reveal. It lives apart from the alert for
 * the same reason `openExternalUrl` does: a platform side effect a suite mocks
 * by module.
 *
 * It never throws at the viewer. Nothing here logs the ID: it is not a secret,
 * but it identifies one phone, so it stays out of telemetry.
 */
import * as Clipboard from "expo-clipboard"

export function copyPushTestId(testDeviceId: string): void {
  try {
    // A failed copy has nothing to tell the viewer: the alert showed the ID.
    void Clipboard.setStringAsync(testDeviceId).catch(() => {})
  } catch {
    // A missing native module throws at the call, before any promise exists.
  }
}
