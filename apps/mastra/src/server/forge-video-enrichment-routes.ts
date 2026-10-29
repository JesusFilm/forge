import { randomUUID } from "node:crypto"
import { z } from "zod"
import { isValidServiceBearer } from "./service-bearer"
import {
  ForgeVideoEnrichmentInputSchema,
  type ForgeVideoEnrichmentInput,
  type ForgeVideoEnrichmentOutput,
} from "./forge-video-enrichment-contract"
import { executionDigest } from "./enrichment-input-digest"
import {
  getEnrichmentAdmissionStore,
  type EnrichmentAdmissionStore,
} from "./enrichment-admission-store"
import { admitManagerEnrichmentRun } from "../services/manager-enrichment-execution-client"

const BODY_MAX_BYTES = 64 * 1024
export type ForgeVideoEnrichmentRouteOutcome = {
  status: number
  body: Record<string, unknown>
}
type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  configured: boolean
  callbackConfigured?: boolean
  readJson: () => Promise<unknown>
  store?: EnrichmentAdmissionStore
}
type StartRouteHandlerInput = RouteHandlerInput & {
  launch?: (
    input: ForgeVideoEnrichmentInput,
    options: { runId: string },
  ) => Promise<ForgeVideoEnrichmentOutput>
  admit?: (input: ForgeVideoEnrichmentInput, runId: string) => Promise<void>
}
function authorize(
  input: RouteHandlerInput,
): ForgeVideoEnrichmentRouteOutcome | null {
  if (!input.configured)
    return {
      status: 503,
      body: { error: "config_missing: MASTRA_ENRICHMENT_API_KEYS not set" },
    }
  if (
    !isValidServiceBearer({
      authHeader: input.authHeader,
      allowlist: input.serviceKeys,
    })
  )
    return { status: 401, body: { error: "Service bearer required" } }
  if (input.callbackConfigured === false)
    return {
      status: 503,
      body: {
        error:
          "config_missing: MANAGER_ENRICHMENT_CALLBACK_URL and MANAGER_ENRICHMENT_CALLBACK_API_KEY must be set",
      },
    }
  return null
}
async function readBody(readJson: () => Promise<unknown>): Promise<unknown> {
  const body = await readJson().catch(() => undefined)
  if (
    body === undefined ||
    Buffer.byteLength(JSON.stringify(body)) > BODY_MAX_BYTES
  )
    return undefined
  return body
}
export async function handleForgeVideoEnrichmentRouteRequest(
  options: RouteHandlerInput,
): Promise<ForgeVideoEnrichmentRouteOutcome> {
  const denied = authorize(options)
  if (denied) return denied
  const parsed = ForgeVideoEnrichmentInputSchema.safeParse(
    await readBody(options.readJson),
  )
  if (!parsed.success)
    return { status: 400, body: { error: "Validation failed" } }
  const runId = randomUUID()
  try {
    await (options.store ?? getEnrichmentAdmissionStore()).reserve({
      runId,
      jobId: parsed.data.jobId,
      inputDigest: executionDigest(parsed.data),
    })
    return { status: 202, body: { ok: true, runId } }
  } catch {
    return {
      status: 503,
      body: { error: "Durable enrichment admission unavailable" },
    }
  }
}
const startRequest = z
  .object({
    runId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    input: ForgeVideoEnrichmentInputSchema,
  })
  .strict()
export async function handleForgeVideoEnrichmentStartRouteRequest(
  options: StartRouteHandlerInput,
): Promise<ForgeVideoEnrichmentRouteOutcome> {
  const denied = authorize(options)
  if (denied) return denied
  const parsed = startRequest.safeParse(await readBody(options.readJson))
  if (!parsed.success)
    return { status: 400, body: { error: "Validation failed" } }
  const { runId, input } = parsed.data
  let store: EnrichmentAdmissionStore
  try {
    store = options.store ?? getEnrichmentAdmissionStore()
    const claim = await store.claim({
      runId,
      jobId: input.jobId,
      inputDigest: executionDigest(input),
    })
    if (claim === "started") return { status: 202, body: { ok: true, runId } }
    if (claim !== "claimed")
      return {
        status: 409,
        body: {
          error:
            "Run was not accepted for this input, or start is consumed/ambiguous",
        },
      }
  } catch {
    return {
      status: 503,
      body: { error: "Durable enrichment admission unavailable" },
    }
  }
  try {
    // The atomic Admin claim binds the current Manager owner and blocks a new
    // owner while admission is in flight. The later graph must claim each spend.
    await (options.admit ?? admitManagerEnrichmentRun)(input, runId)
    const launch =
      options.launch ??
      (await import("../mastra/workflows/forge-video-enrichment"))
        .launchForgeVideoEnrichmentWorkflow
    const result = await launch(input, { runId })
    if (result.runId !== runId) throw new Error("Run identity mismatch")
    await store.finish(runId, "started")
    return { status: 202, body: { ok: true, runId } }
  } catch {
    await store.finish(runId, "ambiguous").catch(() => {})
    return {
      status: 502,
      body: { error: "forge-video-enrichment workflow failed to start" },
    }
  }
}
