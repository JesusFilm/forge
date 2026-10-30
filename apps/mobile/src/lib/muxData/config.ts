import { env } from "../../env"

/**
 * The dashboard join key for each surface. Never change a value after the
 * first production view (KTD6). The Experience value applies only when the
 * chosen backend cannot see native-control seeks (R13).
 */
export const MUX_PLAYER_NAMES = {
  watch: "forge-mobile-watch",
  experience: "forge-mobile-experience",
  explore: "forge-mobile-explore",
} as const

export type MuxPlayerName =
  (typeof MUX_PLAYER_NAMES)[keyof typeof MUX_PLAYER_NAMES]

export type MuxDataConfig = {
  envKey: string
  playerNames: typeof MUX_PLAYER_NAMES
}

// An absent key does not stop the SDKs: an empty key goes to
// inferred.litix.io and a malformed key to img.litix.io (KTD3).
const ENV_KEY_SHAPE = /^[a-z0-9]+$/

/**
 * The one gate for Mux Data (KTD3, R25). Every attach path reads only this
 * function, and null means no monitor, no SDK call, and no `mux-embed` import.
 */
export function resolveMuxDataConfig(): MuxDataConfig | null {
  const envKey = env.EXPO_PUBLIC_MUX_DATA_ENV_KEY?.trim()
  if (!envKey || !ENV_KEY_SHAPE.test(envKey)) return null
  return { envKey, playerNames: MUX_PLAYER_NAMES }
}
