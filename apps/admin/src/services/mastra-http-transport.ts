/**
 * Shared HTTP transport for the admin → mastra service clients
 * (draft / variant / section). Extracted once three clients carried
 * hand-copied near-identical copies and a hardening pass had to touch all of
 * them (the documented extraction trigger in
 * docs/solutions/conventions/single-service-http-client-result-union-convention.md).
 *
 * Design constraints the copies established:
 * - `node:http` by default (PR #1339): the Next-patched global `fetch` fails
 *   over Railway private networking; `node:http` is un-instrumented and works.
 *   The injected-`fetchImpl` path (tests/overrides) keeps using `fetch`.
 * - Runtime timeout guard (PR #1342 class): env-typed numbers can arrive
 *   `undefined`/string under t3-env `skipValidation`, and timer APIs throw
 *   `ERR_INVALID_ARG_TYPE` on those — callers resolve through
 *   `resolveTimeoutMs(value, fallbackMs)`.
 * - Byte cap on the buffered response (OOM-guard law): a legitimate mastra
 *   envelope is a few hundred KB at the extreme (3 bytes per UTF-16 code unit
 *   for non-Latin scripts); 2MB leaves an order of magnitude of headroom.
 *   Over-cap settles with an EMPTY body — the callers' existing ladder then
 *   classifies it (parse_error on 2xx / network_error otherwise) with no new
 *   branch — and aborts the socket rather than draining it.
 */

import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"

export type RawResponse = { status: number; bodyText: string }

/** Byte ceiling for a buffered mastra route response. */
export const MASTRA_RESPONSE_MAX_BYTES = 2 * 1024 * 1024

/**
 * Normalize a request timeout to a positive number, guarding the t3-env
 * `skipValidation` trap. Takes `unknown` so the runtime guards aren't elided
 * by the (wrong) static type.
 */
export function resolveTimeoutMs(value: unknown, fallbackMs: number): number {
  const ms = typeof value === "string" ? Number(value) : value
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0
    ? ms
    : fallbackMs
}

/** POST over `node:http` to dodge the Next-patched global `fetch`. */
export function postViaNode(
  target: URL,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
  options: {
    /** e.g. "draft request timed out" — thrown with name TimeoutError. */
    timeoutErrorMessage: string
    maxResponseBytes?: number
  },
): Promise<RawResponse> {
  const maxResponseBytes = options.maxResponseBytes ?? MASTRA_RESPONSE_MAX_BYTES
  const request = target.protocol === "https:" ? httpsRequest : httpRequest
  return new Promise<RawResponse>((resolve, reject) => {
    // Wall-clock deadline (armed AFTER `req` exists — `request()` can throw
    // synchronously on a malformed header, and a timer armed before that
    // throw would later fire into a TDZ reference and crash the process).
    // `req.setTimeout` below is a socket IDLE timeout — an upstream that
    // trickles a byte every few seconds resets it forever, which would
    // silently defeat callers whose budget must stay under a proxy ceiling
    // (the MCP generate path's 90s-under-Cloudflare invariant). This timer
    // bounds the WHOLE request regardless of activity. Settle FIRST, then
    // destroy — a mid-stream destroy can emit the response's own error
    // before the request's, and the promise must carry TimeoutError.
    // Assigned exactly once below, but cannot be a const: the response
    // handlers close over it, so it must be declared before `req` yet armed
    // only after request() returns.
    // eslint-disable-next-line prefer-const
    let deadline: ReturnType<typeof setTimeout> | undefined
    const req = request(
      target,
      {
        method: "POST",
        headers: {
          ...headers,
          "content-length": Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        let totalBytes = 0
        let overCap = false
        res.on("data", (chunk: Buffer) => {
          if (overCap) return
          totalBytes += chunk.byteLength
          if (totalBytes > maxResponseBytes) {
            // Byte-cap guard: settle FIRST (so the destroy's error event
            // cannot reject), then abort the socket rather than draining it.
            overCap = true
            clearTimeout(deadline)
            resolve({ status: res.statusCode ?? 0, bodyText: "" })
            res.destroy()
            return
          }
          chunks.push(chunk)
        })
        res.on("end", () => {
          if (overCap) return
          clearTimeout(deadline)
          resolve({
            status: res.statusCode ?? 0,
            bodyText: Buffer.concat(chunks).toString("utf8"),
          })
        })
        res.on("error", (error) => {
          if (overCap) return
          clearTimeout(deadline)
          reject(error)
        })
      },
    )
    deadline = setTimeout(() => {
      const error = Object.assign(new Error(options.timeoutErrorMessage), {
        name: "TimeoutError",
      })
      reject(error)
      req.destroy(error)
    }, timeoutMs)
    req.setTimeout(timeoutMs, () => {
      req.destroy(
        Object.assign(new Error(options.timeoutErrorMessage), {
          name: "TimeoutError",
        }),
      )
    })
    req.on("error", (error) => {
      clearTimeout(deadline)
      reject(error)
    })
    req.end(body)
  })
}

/** Transport used when a caller injects `fetchImpl` (unit tests / overrides). */
export async function postViaFetch(
  fetchImpl: typeof fetch,
  target: URL,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
  options: { maxResponseBytes?: number } = {},
): Promise<RawResponse> {
  const maxResponseBytes = options.maxResponseBytes ?? MASTRA_RESPONSE_MAX_BYTES
  const response = await fetchImpl(target, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const bodyText = await response.text()
  // Post-buffering parity with the node path's cap (this path is test-only).
  if (Buffer.byteLength(bodyText) > maxResponseBytes) {
    return { status: response.status, bodyText: "" }
  }
  return { status: response.status, bodyText }
}

/**
 * Render an unknown thrown value as a Railway-logsV2-safe plain string (NEVER
 * JSON.stringify — logsV2 silences stringified payloads from the Next runtime).
 */
export function describeFetchError(error: unknown): string {
  const err = error instanceof Error ? error : undefined
  const cause = err?.cause instanceof Error ? err.cause : undefined
  const rawCode =
    (cause as { code?: unknown } | undefined)?.code ??
    (err as { code?: unknown } | undefined)?.code
  return (
    `name=${err?.name ?? "unknown"} ` +
    `code=${typeof rawCode === "string" ? rawCode : "none"} ` +
    `cause=${cause?.name ?? "none"} ` +
    `message=${err?.message ?? String(error)}`
  )
}

/**
 * Whether a transport throw is the client's own abort (node's TimeoutError
 * from `req.setTimeout` / fetch's AbortError). Callers whose budget sits
 * BELOW mastra's internal one classify this as a retryable `timeout`;
 * callers whose budget exceeds mastra's keep it as `network_error` (a
 * client-side abort there is a genuine transport anomaly).
 */
export function isClientTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  )
}
