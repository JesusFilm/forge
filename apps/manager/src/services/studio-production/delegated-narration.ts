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
    await studioProductionClient(caller.sub, runId)
      .call(
        error instanceof StudioNarrationDispatchFailure
          ? "fail"
          : "preflight-error",
        { diagnostic },
      )
      .catch(() => {
        console.error("Draft narration settlement unconfirmed", runId)
      })
  }
}
