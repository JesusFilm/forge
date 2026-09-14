import { createPrivateKey } from "node:crypto"
import { z } from "zod"
import { env } from "@/config/env"
import {
  studioDocumentSchema,
  studioIdSchema,
  studioDigestSchema,
} from "@forge/studio-contracts"
import { STUDIO_RENDER_PROFILE } from "@forge/studio-contracts/render"
import { retainStudioRenderOutput } from "./studio-render-retention"
import { studioRenderClient } from "./studio-render-transport"
import { prepareStudioRenderInput } from "./studio-render-input"
import { executeStudioRenderRequest } from "./studio-render-execution"
import {
  runStudioRenderJob,
  StudioRenderRunError,
  type StudioRenderRunPort,
} from "./studio-render-runner"

const contextSchema = z.object({
  snapshot: z.object({
    projectId: studioIdSchema,
    revision: z.number().int().positive(),
    inputHash: studioDigestSchema,
    document: studioDocumentSchema,
    executionProfile: z
      .record(z.string(), z.union([z.string(), z.number()]))
      .refine(
        (value) =>
          Object.keys(value).length ===
            Object.keys(STUDIO_RENDER_PROFILE).length &&
          Object.entries(STUDIO_RENDER_PROFILE).every(
            ([key, expected]) => value[key] === expected,
          ),
        "Unsupported immutable render profile",
      ),
  }),
})
const claimSchema = z.discriminatedUnion("execute", [
  z.object({ execute: z.literal(false), leaseId: z.null() }),
  z.object({
    execute: z.literal(true),
    leaseId: z.uuid(),
    expiresAt: z.number().int().positive(),
  }),
])

function renderPort(parent: AbortSignal): StudioRenderRunPort {
  const call = studioRenderClient(parent).call
  return {
    enqueue: (id) => call("enqueue", id),
    claim: async (id) => claimSchema.parse(await call("claim", id)),
    owns: async (id, leaseId, signal) =>
      z.boolean().parse(
        await studioRenderClient(signal).call("owns", {
          attemptId: id,
          leaseId,
        }),
      ),
    finish: (attemptId, leaseId, status, result, signal) =>
      studioRenderClient(signal).call("finish", {
        attemptId,
        leaseId,
        status,
        result,
      }),
    prepare: async (attemptId, leaseId, leaseExpiresAt, signal) => {
      const client = studioRenderClient(signal)
      const { snapshot } = contextSchema.parse(
        await client.call("context", attemptId),
      )
      const prepared = await prepareStudioRenderInput(
        client.assets,
        snapshot.projectId,
        snapshot.document,
        env.STUDIO_PREVIEW_API_KEY ?? "",
        signal,
      )
      if (!env.STUDIO_RENDER_SERVICE_URL || !env.STUDIO_RENDER_PRIVATE_KEY)
        throw new StudioRenderRunError("Render service configuration required")
      const config = {
        endpoint: env.STUDIO_RENDER_SERVICE_URL,
        privateKey: createPrivateKey(env.STUDIO_RENDER_PRIVATE_KEY),
      }
      return {
        execute: async (executionSignal) => {
          const { output, proof } = await executeStudioRenderRequest(
            config,
            {
              attemptId,
              leaseId,
              leaseExpiresAt,
              inputHash: snapshot.inputHash,
              ...prepared,
            },
            executionSignal,
          )
          return {
            retain: async (retentionSignal) => {
              return retainStudioRenderOutput(
                studioRenderClient(retentionSignal).assets,
                snapshot,
                attemptId,
                leaseId,
                output,
                proof,
                retentionSignal,
              )
            },
          }
        },
      }
    },
  }
}

/** One local dispatch at a time; canonical DB leases fence other replicas and
 * restart scans recover admitted attempts missed before queue insertion. */
export async function dispatchStudioRenders(signal: AbortSignal) {
  const ids = z
    .array(studioIdSchema)
    .max(100)
    .parse(await studioRenderClient(signal).call("pending", null))
  for (const id of ids) {
    signal.throwIfAborted()
    try {
      await runStudioRenderJob(id, renderPort(signal), signal)
    } catch {
      if (signal.aborted) return
      console.warn(
        "[studio-render] Dispatch incomplete; canonical lease reconciliation retained",
      )
    }
  }
}

let running = false
export function startStudioRenderDispatcher() {
  if (
    running ||
    !env.STUDIO_RENDER_SERVICE_URL ||
    !env.STUDIO_RENDER_PRIVATE_KEY
  )
    return
  running = true
  const stop = new AbortController()
  const shutdown = () => stop.abort()
  process.once("SIGTERM", shutdown)
  process.once("SIGINT", shutdown)
  void (async () => {
    const { setTimeout: wait } = await import("node:timers/promises")
    try {
      while (!stop.signal.aborted) {
        try {
          await dispatchStudioRenders(stop.signal)
        } catch {
          if (!stop.signal.aborted)
            console.warn(
              "[studio-render] Reconciliation unavailable; retrying canonical queue",
            )
        }
        await wait(2000, undefined, { signal: stop.signal, ref: false })
      }
    } catch {
      /* Shutdown aborts the idle poll and active native request. */
    } finally {
      running = false
      process.removeListener("SIGTERM", shutdown)
      process.removeListener("SIGINT", shutdown)
    }
  })()
}
