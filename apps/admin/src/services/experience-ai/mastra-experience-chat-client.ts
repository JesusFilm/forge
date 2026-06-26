/**
 * Streaming chat relay client (consolidation U9).
 *
 * Opens admin's authenticated connection to the standalone
 * `/forge-experience-chat` SSE route and relays its token stream. Admin is the
 * PROXY: it re-emits the upstream `token_delta` chunks on its own editor SSE
 * channel (via the `onToken` callback) and returns the terminal full text so
 * `runMastraChat` can parse + apply the mutation admin-side.
 *
 * SSRF hardening (per docs/solutions/security-issues/ssrf-defense-streaming-proxy-
 * and-codeql-fp-20260504.md): the base URL host is checked against
 * `MASTRA_CHAT_ALLOWED_HOSTS` (when set) BEFORE any fetch; `redirect:"error"`
 * blocks off-host hops so the bearer never bleeds beyond the first vetted hop.
 *
 * Budget: `AbortSignal.timeout(MASTRA_CHAT_TIMEOUT_MS)` composed with the
 * caller's abort signal (the editor's `request.signal`). A closed tab aborts the
 * caller signal → this fetch aborts → the upstream mastra request aborts → the
 * agent run cancels (R6). The timeout is strictly larger than mastra's internal
 * chatTurn budget so a generation-timeout returns a parsed `error` frame /
 * `timeout` reason rather than admin's fetch aborting first.
 */

import { env } from "@/config/env"

export type MastraChatRelayReason =
  | "config_missing"
  | "ssrf_blocked"
  | "auth_failed"
  | "timeout"
  | "cancelled"
  | "network_error"
  | "generation_failed"
  | "parse_error"

export type MastraChatRelayResult =
  | { ok: true; text: string; producedBy: string }
  | { ok: false; reason: MastraChatRelayReason; message?: string }

export type StreamMastraExperienceChatInput = {
  prompt: string
  onToken: (text: string) => void
  abortSignal?: AbortSignal
  baseUrl?: string
  apiKey?: string
  allowedHosts?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

function hostAllowed(
  baseUrl: string,
  allowedHostsCsv: string | undefined,
): boolean {
  // No allowlist configured → the operator-set base host is trusted
  // (redirect:"error" still blocks off-host hops).
  if (!allowedHostsCsv) return true
  let host: string
  try {
    host = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  const allowed = new Set(
    allowedHostsCsv
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  )
  return allowed.has(host)
}

/**
 * Parse a UTF-8 SSE stream, invoking `onFrame(event, data)` per complete frame.
 * Minimal parser: frames are separated by a blank line; an `event:` line is the
 * discriminator and a `data:` line carries the JSON payload.
 *
 * NOTE: `apps/chat/src/lib/sse.ts` is a fork of this parser. If Mastra's SSE
 * frame format changes, update both copies (no shared util package exists yet).
 */
async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (event: string, data: unknown) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let sep: number
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawFrame = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        let event = "message"
        const dataLines: string[] = []
        for (const line of rawFrame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim()
          else if (line.startsWith("data:"))
            dataLines.push(line.slice(5).trim())
        }
        if (dataLines.length === 0) continue
        let data: unknown
        try {
          data = JSON.parse(dataLines.join("\n"))
        } catch {
          continue
        }
        onFrame(event, data)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function streamMastraExperienceChat(
  input: StreamMastraExperienceChatInput,
): Promise<MastraChatRelayResult> {
  const baseUrl = input.baseUrl ?? env.MASTRA_CHAT_BASE_URL
  const apiKey = input.apiKey ?? env.MASTRA_CHAT_API_KEY
  const allowedHosts = input.allowedHosts ?? env.MASTRA_CHAT_ALLOWED_HOSTS
  const timeoutMs = input.timeoutMs ?? env.MASTRA_CHAT_TIMEOUT_MS
  const fetchImpl = input.fetchImpl ?? fetch

  if (!baseUrl || !apiKey) {
    return { ok: false, reason: "config_missing" }
  }
  if (!hostAllowed(baseUrl, allowedHosts)) {
    return { ok: false, reason: "ssrf_blocked" }
  }

  const budgetSignal = AbortSignal.timeout(timeoutMs)
  const signal = input.abortSignal
    ? AbortSignal.any([input.abortSignal, budgetSignal])
    : budgetSignal

  let response: Response
  try {
    response = await fetchImpl(new URL("/forge-experience-chat", baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ prompt: input.prompt }),
      redirect: "error",
      signal,
    })
  } catch (error) {
    if (budgetSignal.aborted) return { ok: false, reason: "timeout" }
    if (input.abortSignal?.aborted) return { ok: false, reason: "cancelled" }
    const name = (error as { name?: string } | null | undefined)?.name
    if (name === "TimeoutError") return { ok: false, reason: "timeout" }
    return { ok: false, reason: "network_error" }
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: "auth_failed" }
  }
  if (!response.ok || response.body == null) {
    return {
      ok: false,
      reason: response.status >= 500 ? "network_error" : "generation_failed",
    }
  }

  // `token_delta` frames are relayed (onToken) inline as they arrive — that is
  // the streaming. Terminal `result`/`error` frames are collected and processed
  // in a normal loop below (NOT mutated inside the closure) so control-flow
  // narrowing works.
  const terminalFrames: Array<{
    event: string
    data: Record<string, unknown>
  }> = []
  try {
    await readSseStream(response.body, (event, data) => {
      const record = (data ?? {}) as Record<string, unknown>
      if (event === "token_delta") {
        if (typeof record.text === "string" && record.text.length > 0) {
          input.onToken(record.text)
        }
        return
      }
      terminalFrames.push({ event, data: record })
    })
  } catch (error) {
    if (budgetSignal.aborted) return { ok: false, reason: "timeout" }
    if (input.abortSignal?.aborted) return { ok: false, reason: "cancelled" }
    const name = (error as { name?: string } | null | undefined)?.name
    if (name === "TimeoutError") return { ok: false, reason: "timeout" }
    return { ok: false, reason: "network_error" }
  }

  let resultText: string | null = null
  let producedBy = "experience-default-chat"
  for (const frame of terminalFrames) {
    if (frame.event === "error") {
      const reason: MastraChatRelayReason =
        frame.data.reason === "timeout" ? "timeout" : "generation_failed"
      const message =
        typeof frame.data.message === "string" ? frame.data.message : undefined
      return { ok: false, reason, message }
    }
    if (frame.event === "result") {
      if (typeof frame.data.text === "string") resultText = frame.data.text
      if (typeof frame.data.producedBy === "string") {
        producedBy = frame.data.producedBy
      }
    }
  }

  if (resultText === null) return { ok: false, reason: "parse_error" }
  return { ok: true, text: resultText, producedBy }
}
