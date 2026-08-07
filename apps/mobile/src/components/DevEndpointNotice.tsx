import { useSyncExternalStore } from "react"
import { Text, View } from "react-native"
import {
  getUnreachableAdminEndpoint,
  subscribeAdminEndpointUnreachable,
} from "../lib/adminEndpoint"

/**
 * Development-only banner for an admin endpoint that refused the connection.
 * It sits OVER whatever Home rendered rather than replacing it: a failed fetch
 * falls through to the frozen fallback, which otherwise looks like a load.
 *
 * The signal comes from a module-scope store because the Apollo link chain that
 * raises it lives outside React. `app/_layout.tsx` requires this file only
 * under `__DEV__`, so a release bundle never pulls it in.
 */
export function DevEndpointNotice() {
  const endpoint = useSyncExternalStore(
    subscribeAdminEndpointUnreachable,
    getUnreachableAdminEndpoint,
  )

  if (!endpoint) return null

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        backgroundColor: "#7f1d1d",
        paddingTop: 60,
        paddingBottom: 12,
        paddingHorizontal: 16,
      }}
    >
      <Text style={{ color: "#fecaca", fontSize: 13, fontWeight: "bold" }}>
        Admin endpoint unreachable
      </Text>
      <Text
        style={{ color: "#fee2e2", fontSize: 11, fontFamily: "monospace" }}
        selectable
      >
        {endpoint}
      </Text>
      <Text style={{ color: "#fca5a5", fontSize: 11, marginTop: 4 }}>
        Nothing answered. Home is showing its frozen fallback, not loaded
        content.
      </Text>
    </View>
  )
}
