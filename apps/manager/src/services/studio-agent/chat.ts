import { studioGenerationOutputSchema } from "@forge/studio-contracts/generation"
import { createHash } from "node:crypto"
import { z } from "zod"
import {
  studioChatSchema,
  studioAgentEventSchema,
  type StudioAgentEvent,
} from "@forge/studio-contracts/agent"
import {
  studioProjectSchema,
  studioCommandResultSchema,
} from "@forge/studio-contracts"
import { StudioBoundaryError, type StudioCaller } from "@forge/studio-server"
import {
  studioServiceCall,
  studioServiceRequest,
  studioToolGrant,
} from "./transport"
export async function studioChat(
  caller: StudioCaller,
  raw: unknown,
  signal: AbortSignal,
) {
  if (!caller.scopes.includes("shorts:chat"))
    throw new StudioBoundaryError("insufficient_scope")
  const input = studioChatSchema.parse(raw)
  const delegated = { ...caller, authority: "delegated" as const }
  const project = studioProjectSchema.parse(
    await studioServiceCall("admin", delegated, {
      action: "read",
      input: input.projectId,
    }),
  )
  if (project.revision !== input.expectedRevision)
    throw new StudioBoundaryError("CONFLICT", 409)
  const frozen = z
    .object({
      admission: z.string(),
      provenance: z.object({
        agentVersionId: z.string(),
        blockVersionId: z.string(),
        digest: z.string(),
        agentDigest: z.string(),
        blockDigest: z.string(),
      }),
    })
    .parse(
      await studioServiceCall("mastra", delegated, {
        action: "freeze",
        input,
        project,
      }),
    )
  const attempt = studioCommandResultSchema.parse(
    await studioServiceCall("admin", delegated, {
      action: "request",
      input: {
        projectId: input.projectId,
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
        kind: "GENERATION",
        executionInputDigest: createHash("sha256")
          .update(
            JSON.stringify({
              message: input.message,
              project: project.document,
            }),
          )
          .digest("hex"),
        instructions: [frozen.provenance],
      },
    }),
  )
  const binding = {
    admission: frozen.admission,
    attemptId: attempt.attemptId!,
    inputKey: input.idempotencyKey,
    project,
    message: input.message,
  }
  const bound = z.object({ admission: z.string() }).parse(
    await studioServiceCall("mastra", delegated, {
      action: "bind",
      ...binding,
    }),
  )
  const abort = new AbortController()
  const output = new ReadableStream<Uint8Array>({
    cancel() {
      abort.abort()
    },
    async start(controller) {
      let cancelled = false
      const emit = (event: StudioAgentEvent) => {
        try {
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify(event) + "\n"),
          )
        } catch {
          cancelled = true
        }
      }
      let generation = studioGenerationOutputSchema.parse({
        text: "",
        proposals: [],
        diagnostics: [],
      })
      let succeeded = false
      let ownsExecution = false
      try {
        emit({
          type: "admitted",
          attemptId: attempt.attemptId!,
          instructions: frozen.provenance,
        })
        const response = await studioServiceRequest(
          "mastra",
          delegated,
          {
            action: "run",
            admission: bound.admission,
            toolGrant: await studioToolGrant(
              delegated,
              project.projectId,
              project.revision,
            ),
            attemptId: attempt.attemptId,
            inputKey: input.idempotencyKey,
            project,
            message: input.message,
          },
          AbortSignal.any([signal, abort.signal]),
        )
        ownsExecution = true
        const reader = response.body!.getReader(),
          decoder = new TextDecoder()
        let buffer = "",
          bytes = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            bytes += value.length
            if (bytes > 262144)
              throw new StudioBoundaryError("Studio output exceeded limit", 502)
            buffer += decoder.decode(value, { stream: true })
            let newline: number
            while ((newline = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, newline)
              buffer = buffer.slice(newline + 1)
              const event = studioAgentEventSchema.parse(JSON.parse(line))
              if (event.type === "done") succeeded = true
              else if (event.type === "error") {
                emit(event)
                throw new StudioBoundaryError("Studio generation failed", 502)
              } else {
                // Validate the next bounded retained state before exposing a proposal.
                generation = studioGenerationOutputSchema.parse({
                  text:
                    generation.text + (event.type === "text" ? event.text : ""),
                  proposals:
                    event.type === "proposal"
                      ? [...generation.proposals, event.proposal]
                      : generation.proposals,
                  diagnostics:
                    event.type === "diagnostic"
                      ? [...generation.diagnostics, event.message]
                      : generation.diagnostics,
                })
                emit(event)
              }
            }
          }
        } finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
        if (!succeeded || buffer.trim())
          throw new StudioBoundaryError("Incomplete Studio stream", 502)
      } catch {
        succeeded = false
        emit({
          type: "error",
          message:
            "Studio generation interrupted. Inspect retained results and execution status before requesting another run.",
        })
      } finally {
        try {
          if (ownsExecution)
            await studioServiceCall(
              "admin",
              {
                ...delegated,
                clientId: "shorts-hosted",
                scopes: ["shorts:attempt:finish"],
              },
              {
                action: "finish",
                generation,
                input: {
                  projectId: input.projectId,
                  expectedRevision: input.expectedRevision,
                  idempotencyKey: `${attempt.attemptId}:finish`,
                  attemptId: attempt.attemptId,
                  status: succeeded ? "SUCCEEDED" : "FAILED",
                  operations: [],
                  result: {
                    assets: [],
                    costMicros: null,
                    diagnostic: succeeded
                      ? "Hosted proposal generation completed; no edits applied"
                      : "Hosted stream failed",
                  },
                },
              },
            )
          if (succeeded) emit({ type: "done" })
        } catch {
          emit({
            type: "error",
            message:
              "Attempt completion could not be recorded. Inspect history before retrying.",
          })
        }
        if (!cancelled)
          try {
            controller.close()
          } catch {
            /* reader cancelled */
          }
      }
    },
  })
  return new Response(output, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  })
}
