import { SEEKER_PRODUCTION_PROMPT } from "../mastra/agents/seeker-production-config"
import {
  fetchLangfusePrompt,
  resolveExactManagedPrompt,
  type LangfusePromptClientResult,
} from "./langfuse-prompt-client"

type PinnedPrompt = { name: string; revision: string; contentHash: string }
type ExactResult = Awaited<ReturnType<typeof resolveExactManagedPrompt>>

export function createSeekerPromptHealthCheck({
  pinned = SEEKER_PRODUCTION_PROMPT,
  resolvePinned = ({ name, revision, contentHash }: PinnedPrompt) =>
    resolveExactManagedPrompt({
      name,
      version: Number(revision),
      expectedContentHash: contentHash,
    }),
  fetchLabel = ({ name }: PinnedPrompt) =>
    fetchLangfusePrompt({ name, label: "production" }),
  log = console.warn,
}: {
  pinned?: PinnedPrompt
  resolvePinned?: (pinned: PinnedPrompt) => Promise<ExactResult>
  fetchLabel?: (pinned: PinnedPrompt) => Promise<LangfusePromptClientResult>
  log?: (message: string) => void
} = {}) {
  let state: "unknown" | "aligned" | "mismatch" | "critical" = "unknown"
  return async () => {
    const exact = await resolvePinned(pinned)
    if (!exact.ok) {
      if (state !== "critical")
        log(
          `[seeker-prompt-health] event=pinned_version_unavailable revision=${pinned.revision} effect=pinned_version_unavailable severity=critical reason=${exact.reason}`,
        )
      state = "critical"
      return {
        healthy: false as const,
        critical: true as const,
        labelAligned: false as const,
      }
    }
    const label = await fetchLabel(pinned)
    const aligned = label.ok && String(label.version) === pinned.revision
    if (!aligned && state !== "mismatch")
      log(
        `[seeker-prompt-health] event=label_mismatch pinned_revision=${pinned.revision} label_revision=${label.ok ? label.version : "unavailable"} effect=alert_only action=move_production_label`,
      )
    if (aligned && (state === "mismatch" || state === "critical"))
      log(
        `[seeker-prompt-health] event=recovered pinned_revision=${pinned.revision} effect=alert_cleared`,
      )
    state = aligned ? "aligned" : "mismatch"
    return {
      healthy: true as const,
      critical: false as const,
      labelAligned: aligned,
    }
  }
}

export const checkSeekerPromptHealth = createSeekerPromptHealthCheck()
