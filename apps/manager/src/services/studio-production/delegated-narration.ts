import type { StudioCaller } from "@forge/studio-server"
import { studioServiceCall } from "@/services/studio-agent/transport"
import { executeNarration, narrationQuote } from "./narration"
import { studioProductionClient } from "./transport"
import {
  StudioNarrationClaimObserved,
  StudioNarrationDispatchFailure,
} from "./runner"

// Keep delegated identity on reads too; never fabricate an interactive session assertion.
const delegatedRead =
  (caller: StudioCaller) => (action: string, input: unknown) =>
    studioServiceCall("admin", caller, { action, input })
export function delegatedNarrationQuote(
  caller: StudioCaller,
  input: { projectId: string; expectedRevision: number },
) {
  return narrationQuote(delegatedRead(caller), input)
}
export async function executeDelegatedNarration(
  caller: StudioCaller,
  runId: string,
) {
  try {
    return await executeNarration(caller.sub, delegatedRead(caller), runId)
  } catch (error) {
    if (error instanceof StudioNarrationClaimObserved) return
    const diagnostic =
      error instanceof Error
        ? error.message.slice(0, 2000)
        : "Narration interrupted; inspect retained calls before retry"
    // Unknown transport failures do not establish ownership: finish/attach
    // may already have committed, or a different runner may own a live claim.
    // Preserve the accepted run for same-key resume and canonical inspection.
    if (!(error instanceof StudioNarrationDispatchFailure)) {
      await studioProductionClient(caller.sub, runId)
        .call("reconciliation-note", { diagnostic })
        .catch(() => {
          console.error(
            "Draft narration reconciliation note unconfirmed; resume original request",
            runId,
          )
        })
      return { runId, outcome: "RECONCILIATION_REQUIRED", diagnostic }
    }
    await studioProductionClient(caller.sub, runId)
      .call("fail", { diagnostic })
      .catch(() => {
        console.error("Draft narration settlement unconfirmed", runId)
      })
  }
}
