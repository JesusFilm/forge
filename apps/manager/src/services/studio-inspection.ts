import type { StudioAction } from "@forge/studio-contracts/transport"
import {
  STUDIO_INSPECTION_LIMITS,
  studioInspectionContextSchema,
  studioInspectionEvidenceSchema,
  studioInspectionRequestSchema,
  type StudioInspectionEvidence,
} from "@forge/studio-contracts/inspection"
import { env } from "@/config/env"
import { StudioBoundaryError } from "@forge/studio-server"
import { createStudioAssetBroker } from "./studio-broker"
import { studioRenderClient } from "./studio-render-transport"
import {
  extractStudioInspection,
  incompleteStudioInspection,
} from "./studio-inspection-output"

type InspectionCall = (
  action: StudioAction,
  input: unknown,
  signal?: AbortSignal,
) => Promise<unknown>
/** Bound even adapters which cannot forward AbortSignal. Their late read result
 * is discarded; signal-aware HTTP adapters also cancel the underlying request. */
export async function boundedInspectionCall(
  call: InspectionCall,
  action: StudioAction,
  input: unknown,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  let abort: () => void = () => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
  })
  try {
    return await Promise.race([call(action, input, signal), aborted])
  } finally {
    signal.removeEventListener("abort", abort)
  }
}
const running = new Map<string, Promise<StudioInspectionEvidence>>()

/** Explicit lazy request only. Every caller authenticates before cache lookup.
 * One extraction per Manager process, same-key coalescing and durable first-writer
 * evidence across replicas; no queue, background wakeup or editor initialization. */
export async function inspectStudioRender(
  call: InspectionCall,
  raw: unknown,
  signal?: AbortSignal,
) {
  const requestStarted = Date.now()
  const input = studioInspectionRequestSchema.parse(raw)
  let context = studioInspectionContextSchema.parse(
    await boundedInspectionCall(
      call,
      "inspection-context",
      input,
      AbortSignal.timeout(5000),
    ),
  )
  if (context.evidence)
    return {
      evidence: context.evidence,
      stale: context.stale,
      currentRevision: context.currentRevision,
      cacheHit: true,
      serverRequestMs: Date.now() - requestStarted,
    }
  const key = `${context.attemptId}:${context.output.digest}`
  let pending = running.get(key)
  const coalesced = !!pending
  if (!pending) {
    if (running.size)
      throw new StudioBoundaryError(
        "Inspection is busy; retry after the current bounded inspection finishes",
        503,
      )
    // Disconnect does not cancel accepted preparation for other reconnecting callers.
    const deadline = AbortSignal.timeout(STUDIO_INSPECTION_LIMITS.preparationMs)
    pending = (async () => {
      const started = Date.now()
      let bytes: Buffer
      try {
        bytes = await createStudioAssetBroker(
          (action, input) =>
            boundedInspectionCall(call, action, input, deadline),
          deadline,
        ).read(context.output, STUDIO_INSPECTION_LIMITS.outputBytes)
      } catch (error) {
        if (
          !deadline.aborted &&
          !(
            error instanceof Error &&
            ["TimeoutError", "AbortError"].includes(error.name)
          )
        )
          throw error
        return incompleteStudioInspection(
          context,
          started,
          "Inspection reached its deadline while obtaining exact output bytes. No sampled visual or decoded audio coverage is claimed; retry explicitly after connectivity recovers.",
        )
      }
      const evidence = await extractStudioInspection(
        context,
        bytes,
        {
          ffmpeg: env.STUDIO_FFMPEG_PATH ?? "ffmpeg",
          ffprobe: env.STUDIO_FFPROBE_PATH ?? "ffprobe",
        },
        deadline,
      )
      evidence.preparationStartedAt = new Date(started).toISOString()
      evidence.preparationMs = Date.now() - started
      evidence.evidenceReadyAt = new Date().toISOString()
      // Partial/unsupported results are returned honestly but never poison the
      // durable cache: an explicit retry after recovery can inspect the same MP4.
      if (evidence.status !== "sampled") return evidence
      // Separate bounded persistence allowance; reported preparation is extraction.
      return studioInspectionEvidenceSchema.parse(
        await studioRenderClient(AbortSignal.timeout(5000)).call(
          "inspection-save",
          evidence,
        ),
      )
    })()
    running.set(key, pending)
    void pending.finally(() => running.delete(key)).catch(() => {})
  }
  const evidence = await pending
  // Re-read after potentially long preparation: human edits must mark this old
  // output stale; revoked membership must not leak cached samples.
  signal?.throwIfAborted()
  context = studioInspectionContextSchema.parse(
    await boundedInspectionCall(
      call,
      "inspection-context",
      input,
      AbortSignal.timeout(5000),
    ),
  )
  return {
    evidence,
    stale: context.stale,
    currentRevision: context.currentRevision,
    cacheHit: coalesced,
    serverRequestMs: Date.now() - requestStarted,
  }
}

/** Images are actual MCP image blocks; JSON metadata does not pretend clients
 * inspected them. Avoid duplicating base64 bytes inside the text report. */
export function studioInspectionMcpResult(
  result: Awaited<ReturnType<typeof inspectStudioRender>>,
) {
  const report = {
    ...result,
    evidence: {
      ...result.evidence,
      samples: result.evidence.samples.map(({ image, ...sample }, index) => ({
        ...sample,
        image: {
          mimeType: image.mimeType,
          digest: image.digest,
          contentIndex: index * 2 + 2,
        },
      })),
    },
  }
  return {
    content: [
      { type: "text", text: JSON.stringify(report) },
      ...result.evidence.samples.flatMap((sample) => [
        {
          type: "text",
          text: `Exact rendered output sample: frame ${sample.frame}, ${sample.timestampMs.toFixed(1)} ms (${sample.reasons.join(", ")}).`,
        },
        {
          type: "image",
          mimeType: sample.image.mimeType,
          data: sample.image.data,
        },
      ]),
    ],
    structuredContent: { result: report },
  }
}
