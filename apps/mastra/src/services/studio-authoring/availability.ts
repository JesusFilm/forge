import { studioRuntimeRequestSchema } from "@forge/studio-contracts/agent"
type Config = {
  enabled: boolean
  publicKeys?: string
  admissionSecret?: string
}
/** Signed native read access is independent of paid hosted execution admission. */
export function studioRuntimeAvailable(raw: unknown, config: Config) {
  if (!config.publicKeys) return false
  const parsed = studioRuntimeRequestSchema.safeParse(raw)
  if (!parsed.success) return false
  if (
    parsed.data.action === "instructions" &&
    ["inspect", "compare"].includes(parsed.data.command.action)
  )
    return true
  return config.enabled && !!config.admissionSecret
}
