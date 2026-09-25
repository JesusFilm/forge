/**
 * The two things the Profile row can do with the notification test ID (R31).
 * They live apart from the component for the same reason `openExternalUrl` does:
 * a platform side effect the render suite mocks by module.
 *
 * Neither ever throws at the viewer. Nothing here logs the ID: it is not a
 * secret, but it identifies one phone, so it stays out of telemetry.
 */
import { Clipboard, Share } from "react-native"

export function copyPushTestId(testDeviceId: string): void {
  try {
    // A named import compiles to a member access at THIS line, so react-native's
    // Clipboard deprecation notice fires on a copy press and never at import.
    Clipboard.setString(testDeviceId)
  } catch {
    // Nothing to tell the viewer: the ID is on screen and can be read out.
  }
}

export function sharePushTestId(testDeviceId: string): void {
  // A dismissed sheet resolves, so only a failure to open reaches the catch.
  void Share.share({ message: testDeviceId }).catch(() => {})
}
