import { createHash, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { studioIdSchema } from "@forge/studio-contracts"
import { STUDIO_RENDER_PROFILE } from "@forge/studio-contracts/render"

type DemandPort = {
  key: string | undefined
  forbiddenKeys: (string | undefined)[]
  poolId: string | undefined
  workerId: string | undefined
  enabled: () => boolean
  pending: (signal: AbortSignal) => Promise<unknown>
  timeoutMs?: number
}
const response = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } })
const digest = (value: string) => createHash("sha256").update(value).digest()

/** Read-only host wake hint. This credential grants no job, asset or lease access.
 * Canonical claim eligibility is still checked by the installed VM worker. */
export function createStudioRenderDemandHandler(port: DemandPort) {
  let active = false
  return async (request: Request) => {
    if (
      !port.key ||
      !/^[\x21-\x7e]{32,4096}$/.test(port.key) ||
      port.forbiddenKeys.includes(port.key) ||
      !studioIdSchema.safeParse(port.poolId).success ||
      !studioIdSchema.safeParse(port.workerId).success
    )
      return response({ error: "Unavailable" }, 503)
    const header = request.headers.get("authorization") ?? ""
    if (
      header.length > 4103 ||
      !timingSafeEqual(digest(header), digest(`Bearer ${port.key}`))
    )
      return response({ error: "Authorization refused" }, 401)
    if (active) return response({ error: "Busy" }, 503)
    active = true
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(port.timeoutMs ?? 5000),
    ])
    let abort = () => {}
    const stopped = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener("abort", abort, { once: true })
      if (signal.aborted) abort()
    })
    const work = (async () => {
      signal.throwIfAborted()
      const enabled = port.enabled()
      const pending = enabled
        ? z
            .array(studioIdSchema)
            .max(100)
            .parse(await port.pending(signal))
        : []
      signal.throwIfAborted()
      return response({
        version: 1,
        poolId: port.poolId,
        workerId: port.workerId,
        profileId: STUDIO_RENDER_PROFILE.id,
        enabled,
        hasPending: pending.length > 0,
      })
    })().finally(() => {
      // Preserve the slot until even a noncancellable backend call terminates.
      active = false
    })
    try {
      return await Promise.race([work, stopped])
    } catch {
      return response({ error: "Demand unconfirmed" }, 503)
    } finally {
      signal.removeEventListener("abort", abort)
    }
  }
}
