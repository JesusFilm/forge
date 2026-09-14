import { studioGenerationBatchSchema } from "@forge/studio-contracts/generation"
import { studioAgentEventSchema } from "@forge/studio-contracts/agent"
import { StudioBoundaryError, type StudioCaller } from "@forge/studio-server"
import { studioChat } from "./chat"
/** One immutable native admission per explicit target; cancellation stops undispatched targets. */
export async function studioGenerationBatch(
  caller: StudioCaller,
  raw: unknown,
  signal: AbortSignal,
) {
  if (
    caller.authority !== "interactive" ||
    caller.clientId !== "shorts-manager"
  )
    throw new StudioBoundaryError("Interactive production admission required")
  const input = studioGenerationBatchSchema.parse(raw),
    abort = new AbortController()
  const combined = AbortSignal.any([signal, abort.signal])
  const output = new ReadableStream<Uint8Array>({
    cancel() {
      abort.abort()
    },
    async start(controller) {
      let closed = false
      const emit = (event: unknown) => {
        if (closed) return
        try {
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify(event) + "\n"),
          )
        } catch {
          closed = true
          abort.abort()
        }
      }
      try {
        for (const request of input.requests) {
          if (combined.aborted) break
          emit({
            type: "target-start",
            projectId: request.projectId,
            revision: request.expectedRevision,
          })
          try {
            const response = await studioChat(caller, request, combined),
              reader = response.body!.getReader(),
              decoder = new TextDecoder()
            let pending = "",
              size = 0,
              doneEvent = false,
              failureMessage: string | undefined
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                size += value.length
                if (size > 262144)
                  throw new StudioBoundaryError("Target output exceeds 256 KiB")
                pending += decoder.decode(value, { stream: true })
                let newline: number
                while ((newline = pending.indexOf("\n")) >= 0) {
                  const event = studioAgentEventSchema.parse(
                    JSON.parse(pending.slice(0, newline)),
                  )
                  pending = pending.slice(newline + 1)
                  if (event.type === "done") doneEvent = true
                  if (event.type === "error") failureMessage = event.message
                  emit({
                    type: "target-event",
                    projectId: request.projectId,
                    event,
                  })
                }
              }
              if (failureMessage || !doneEvent || pending.trim())
                throw new StudioBoundaryError(
                  failureMessage ??
                    "Target incomplete; inspect retained attempt before another request",
                )
            } finally {
              await reader.cancel().catch(() => {})
              reader.releaseLock()
            }
          } catch (error) {
            emit({
              type: "target-error",
              projectId: request.projectId,
              message:
                error instanceof Error
                  ? error.message
                  : "Generation interrupted",
            })
          }
        }
        emit({ type: combined.aborted ? "batch-cancelled" : "batch-finished" })
      } finally {
        if (!closed) {
          try {
            controller.close()
          } catch {
            /* Client disconnected. */
          }
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
