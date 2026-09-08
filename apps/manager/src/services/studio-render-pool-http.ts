import { StudioRenderPoolBindingError } from "./studio-render-pool-errors"
import {
  STUDIO_RENDER_PROFILE,
  STUDIO_RENDER_WIRE_BYTES,
} from "@forge/studio-contracts/render"
import { readStudioBody, StudioRequestTooLarge } from "@/lib/studio-request"
import {
  StudioRenderPoolAuth,
  StudioRenderPoolAuthorizationError,
} from "./studio-render-pool-auth"
import type { StudioRenderPoolGateway } from "./studio-render-pool-gateway"
const limits = {
  claim: { ms: 10000, bytes: 4096 },
  input: { ms: STUDIO_RENDER_PROFILE.preparationMs, bytes: 4096 },
  owns: { ms: 5000, bytes: 4096 },
  retain: {
    ms: STUDIO_RENDER_PROFILE.retentionTransferMs,
    bytes: STUDIO_RENDER_WIRE_BYTES,
  },
  receipt: { ms: 5000, bytes: 1049600 },
  finish: { ms: STUDIO_RENDER_PROFILE.terminalRecordingMs, bytes: 1049600 },
} as const
type Action = keyof typeof limits
type Gateway = Pick<StudioRenderPoolGateway, Action>
const response = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } })

/** Process-local memory/work bound, not assignment authority. An aborted HTTP
 * response does not release an underlying noncancellable operation's slot. */
export function createStudioPoolHandler(
  auth: StudioRenderPoolAuth,
  gateway: Gateway,
) {
  let active = 0,
    heavy = false
  return async (request: Request, action: string): Promise<Response> => {
    if (!Object.hasOwn(limits, action))
      return response({ error: "Unavailable" }, 404)
    const name = action as Action
    const header = request.headers.get("authorization")
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null
    try {
      if (name === "claim") auth.worker(header)
      else auth.lease(token)
    } catch {
      return response({ error: "Authorization refused" }, 401)
    }
    const expensive = name === "input" || name === "retain"
    if (active >= 4 || (expensive && heavy))
      return response({ error: "Busy" }, 503)
    active++
    if (expensive) heavy = true
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(limits[name].ms),
    ])
    const transferDeadline =
      performance.now() + STUDIO_RENDER_PROFILE.retentionTransferMs - 5000
    let abort: () => void = () => {}
    const stopped = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener("abort", abort, { once: true })
      if (signal.aborted) abort()
    })
    const work = (async () => {
      // Upload gets at most10s inside this operation's original allowance.
      const bodySignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(STUDIO_RENDER_PROFILE.uploadMs),
      ])
      const bytes = await readStudioBody(
        request,
        limits[name].bytes,
        bodySignal,
      )
      const raw: unknown = JSON.parse(new TextDecoder().decode(bytes))
      signal.throwIfAborted()
      let result: unknown
      if (name === "claim") result = await gateway.claim(header, raw, signal)
      else if (name === "retain") {
        // Keep5s within the same45s operation for signing/delivering a partial
        // receipt after cooperative transfer timeout; never reset the window.
        const transfer = AbortSignal.any([
          signal,
          AbortSignal.timeout(
            Math.max(1, Math.floor(transferDeadline - performance.now())),
          ),
        ])
        result = await gateway.retain(token, raw, transfer)
      } else if (name === "finish" || name === "receipt")
        result = await gateway[name](token, raw, signal)
      else {
        if (
          !raw ||
          typeof raw !== "object" ||
          Array.isArray(raw) ||
          Object.keys(raw).length
        )
          throw new StudioRenderPoolBindingError("Unexpected input")
        result = await gateway[name](token, signal)
      }
      signal.throwIfAborted()
      return response(result)
    })().finally(() => {
      active--
      if (expensive) heavy = false
    })
    try {
      return await Promise.race([work, stopped])
    } catch (error) {
      return response(
        { error: "Operation unconfirmed" },
        error instanceof StudioRequestTooLarge
          ? 413
          : error instanceof StudioRenderPoolAuthorizationError
            ? 401
            : 409,
      )
    } finally {
      signal.removeEventListener("abort", abort)
    }
  }
}
