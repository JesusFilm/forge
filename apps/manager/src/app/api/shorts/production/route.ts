import { StudioProductionError } from "@/services/studio-production/errors"
import {
  StudioNarrationClaimObserved,
  StudioNarrationDispatchFailure,
} from "@/services/studio-production/runner"
import { NextResponse, after } from "next/server"
import { z } from "zod"
import { studioProductionRequestSchema } from "@forge/studio-contracts/production"
import { studioCommandResultSchema } from "@forge/studio-contracts"
import { authenticateStudioRequest, readStudioBody } from "@/lib/studio-request"
import {
  createStudioInteractiveClient,
  StudioTransportError,
} from "@/backend/studio-interactive"
import {
  narrationQuote,
  executeNarration,
} from "@/services/studio-production/narration"
import { studioProductionClient } from "@/services/studio-production/transport"
import {
  experimentDraftSchema,
  experimentQuote,
  executeStudioExperiment,
} from "@/services/studio-production/experiments"
import { registerExperimentVoice } from "@/services/studio-production/register-voice"
export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  try {
    const input = studioProductionRequestSchema.parse(
      JSON.parse(
        new TextDecoder().decode(await readStudioBody(request, 32768)),
      ),
    )
    const call = createStudioInteractiveClient(actor)
    let result: unknown
    if (input.kind === "plan")
      result = await narrationQuote(call, {
        projectId: input.projectId,
        expectedRevision: input.expectedRevision,
      })
    else if (input.kind === "status")
      result = await call("production-read", {
        id: input.runId,
        after: input.after,
      })
    else if (input.kind === "cancel")
      result = await call("production-cancel", input.runId)
    else if (input.kind === "experiment-estimate")
      result = experimentQuote(input.input)
    else if (input.kind === "experiment-register")
      result = await registerExperimentVoice(
        actor.approvedByUserId,
        call,
        input,
      )
    else {
      let runId: string,
        experiment = false
      if (input.kind === "narrate") {
        const quote = await narrationQuote(call, {
          projectId: input.input.projectId,
          expectedRevision: input.input.expectedRevision,
        })
        if (
          quote.estimateMicros === null ||
          quote.estimateMicros > input.maxCostMicros ||
          !quote.plan.segments.length
        )
          throw new StudioProductionError(
            quote.unavailable ??
              "Review current speech and estimate before narration",
          )
        const attempt = studioCommandResultSchema.parse(
          await call("request", {
            ...input.input,
            kind: "NARRATION",
            instructions: [],
          }),
        )
        runId = z.object({ id: z.string() }).parse(
          await call("production-admit", {
            attemptId: attempt.attemptId,
            maxCostMicros: input.maxCostMicros,
          }),
        ).id
      } else if (input.kind === "experiment-run") {
        const quote = experimentQuote(
          experimentDraftSchema.strip().parse(input.input),
        )
        if (
          JSON.stringify(quote.estimate) !==
          JSON.stringify(input.input.estimate)
        )
          throw new StudioProductionError(
            "Estimate changed; review and confirm the current experiment estimate",
          )
        const admitted = z
          .object({ id: z.string() })
          .parse(await call("experiment-request", input.input))
        runId = z.object({ id: z.string() }).parse(
          await call("production-admit", {
            experimentId: admitted.id,
            maxCostMicros: input.input.maxCostMicros,
          }),
        ).id
        experiment = true
      } else {
        runId = input.runId
        experiment = Boolean(
          z
            .object({ run: z.object({ experimentId: z.string().nullable() }) })
            .parse(
              await studioProductionClient(actor.approvedByUserId, runId).call(
                "context",
                {},
              ),
            ).run.experimentId,
        )
      }
      after(async () => {
        try {
          if (experiment)
            await executeStudioExperiment(actor.approvedByUserId, call, runId)
          else await executeNarration(actor.approvedByUserId, call, runId)
        } catch (error) {
          if (experiment)
            console.error(
              "Studio experiment interrupted; inspect retained execution calls",
              runId,
            )
          else {
            if (error instanceof StudioNarrationClaimObserved) return
            const diagnostic =
              error instanceof Error
                ? error.message.slice(0, 2000)
                : "Narration failed; inspect before retry"
            await studioProductionClient(actor.approvedByUserId, runId)
              .call(
                error instanceof StudioNarrationDispatchFailure
                  ? "fail"
                  : "preflight-error",
                { diagnostic, phase: "narration" },
              )
              .catch(() => {
                console.error("Studio narration completion unconfirmed", runId)
              })
          }
        }
      })
      result = { runId, state: "ADMITTED" }
    }
    return Response.json(
      { result },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Production request rejected",
      },
      { status: error instanceof StudioTransportError ? error.status : 400 },
    )
  }
}
