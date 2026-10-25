/**
 * Streaming chat route handler (consolidation U9).
 *
 * Bearer-gated `/forge-experience-chat`: admin builds the chat prompt
 * (candidates + history + locale state, ABAC already passed) and POSTs
 * `{ prompt }`; this handler runs `experience-default-chat.stream()` and relays
 * an SSE token stream back. Admin re-emits those tokens on its own editor SSE
 * channel (admin = proxy) and uses the terminal `result` frame's full text to
 * parse + apply the mutation (persistence + ratings stay admin-side).
 *
 * Wire frames (one SSE event each):
 *   - token_delta  { text }                       — per stream chunk
 *   - result       { text, producedBy }           — terminal success (full text)
 *   - error        { reason, message }             — terminal failure
 *
 * Budget: the agent stream is bound by an internal `AbortSignal.timeout(
 * TIME_BUDGET_MS.chatTurn)` composed with the inbound request signal, so a
 * closed editor tab (admin aborts its fetch → this request aborts) cancels the
 * agent run through both legs (R6). `maxSteps` caps tool-call recursion.
 *
 * Plain-string logging only.
 */

import { TIME_BUDGET_MS, STEP_CAPS } from "../budgets"
import { isValidServiceBearer } from "../../server/service-bearer"

// Narrow structural surface of the chat agent's streaming API (avoids fighting
// the generic Agent.stream signature; the runtime contract is textStream).
type ChatStreamOutput = { textStream: ReadableStream<string> }
type ChatStreamAgent = {
  stream: (
    prompt: string,
    opts: { maxSteps?: number; abortSignal?: AbortSignal },
  ) => Promise<ChatStreamOutput> | ChatStreamOutput
}

export type ExperienceChatRouteMastra = {
  getAgentById: (id: string) => unknown
}

export type ExperienceChatRouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  getMastra: () => ExperienceChatRouteMastra
  /** Inbound request signal — aborts the agent run when admin disconnects. */
  requestSignal?: AbortSignal
}

const CHAT_AGENT_ID = "experience-default-chat"

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function isPromptBody(value: unknown): value is { prompt: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { prompt?: unknown }).prompt === "string" &&
    (value as { prompt: string }).prompt.length > 0
  )
}

export async function handleExperienceChatRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  getMastra,
  requestSignal,
}: ExperienceChatRouteHandlerInput): Promise<Response> {
  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return jsonResponse(401, { error: "Service bearer required" })
  }

  const raw = await readJson().catch(() => undefined)
  if (!isPromptBody(raw)) {
    return jsonResponse(400, { error: "prompt is required" })
  }
  const prompt = raw.prompt

  const agent = getMastra().getAgentById(CHAT_AGENT_ID) as ChatStreamAgent

  // Compose the inbound request signal with the internal chat budget so EITHER
  // a client disconnect or the 90s ceiling aborts the agent run.
  const budgetSignal = AbortSignal.timeout(TIME_BUDGET_MS.chatTurn)
  const abortSignal = requestSignal
    ? AbortSignal.any([requestSignal, budgetSignal])
    : budgetSignal

  const encoder = new TextEncoder()
  let reader: ReadableStreamDefaultReader<string> | null = null

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const output = await agent.stream(prompt, {
          maxSteps: STEP_CAPS.toolCallingTurn,
          abortSignal,
        })
        reader = output.textStream.getReader()
        let full = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (typeof value === "string" && value.length > 0) {
            full += value
            controller.enqueue(
              encoder.encode(sseFrame("token_delta", { text: value })),
            )
          }
        }
        controller.enqueue(
          encoder.encode(
            sseFrame("result", { text: full, producedBy: CHAT_AGENT_ID }),
          ),
        )
      } catch (error) {
        const reason = budgetSignal.aborted ? "timeout" : "generation_failed"
        console.warn(
          `[forge-experience-chat] event=stream_error reason=${reason}`,
        )
        controller.enqueue(
          encoder.encode(
            sseFrame("error", {
              reason,
              message:
                error instanceof Error ? error.message : "chat stream failed",
            }),
          ),
        )
      } finally {
        controller.close()
      }
    },
    cancel() {
      // Admin disconnected (closed editor tab) → cancel the agent's textStream
      // so the run stops burning provider/tool calls (R6, leg 2).
      void reader?.cancel().catch(() => {})
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
}
