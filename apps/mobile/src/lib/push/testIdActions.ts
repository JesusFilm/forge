/**
 * The copy action of R31's test ID reveal. It never throws at the viewer:
 * `setStringAsync` is async, so a failed copy rejects into the catch below. A
 * missing native module fails when expo-clipboard is imported, not here; the
 * fingerprint runtime version keeps a build without it from loading this bundle.
 *
 * Nothing here logs the ID: it is not a secret, but it identifies one phone, so
 * it stays out of telemetry.
 */
import * as Clipboard from "expo-clipboard"

export function copyPushTestId(testDeviceId: string): void {
  // A failed copy has nothing to tell the viewer: the alert showed the ID.
  void Clipboard.setStringAsync(testDeviceId).catch(() => {})
}
