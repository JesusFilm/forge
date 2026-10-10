import type { JobRecord } from "@/types/job"

export type JobSnapshotEvent =
  | {
      type: "snapshot"
      jobs: JobRecord[]
    }
  | {
      type: "snapshot"
      job: JobRecord
    }

export type JobUpsertEvent = {
  type: "job-upsert"
  job: JobRecord
}

export type JobStreamEvent = JobSnapshotEvent | JobUpsertEvent

type JobEventListener = (event: JobUpsertEvent) => void
type JobEventSubscription = (listener: JobEventListener) => () => void

const encoder = new TextEncoder()
const allJobSubscribers = new Set<JobEventListener>()
const jobSubscribers = new Map<string, Set<JobEventListener>>()

const DEFAULT_KEEPALIVE_MS = 15_000

function addSubscriber(
  subscribers: Set<JobEventListener>,
  listener: JobEventListener,
): () => void {
  subscribers.add(listener)

  return () => {
    subscribers.delete(listener)
  }
}

export function subscribeToAllJobEvents(
  listener: JobEventListener,
): () => void {
  return addSubscriber(allJobSubscribers, listener)
}

export function subscribeToJobEvents(
  jobId: string,
  listener: JobEventListener,
): () => void {
  const subscribers = jobSubscribers.get(jobId) ?? new Set<JobEventListener>()
  jobSubscribers.set(jobId, subscribers)
  subscribers.add(listener)

  return () => {
    subscribers.delete(listener)
    if (subscribers.size === 0) {
      jobSubscribers.delete(jobId)
    }
  }
}

export function publishJobEvent(job: JobRecord): void {
  const event: JobUpsertEvent = {
    type: "job-upsert",
    job,
  }

  const matchingSubscribers = jobSubscribers.get(job.id)
  const listeners = [
    ...allJobSubscribers,
    ...(matchingSubscribers ? [...matchingSubscribers] : []),
  ]

  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      console.warn("[job-events] listener failed:", error)
    }
  }
}

export function encodeEvent(event: JobStreamEvent): Uint8Array {
  const lines = [`event: ${event.type}`]
  const payload = JSON.stringify(event)

  for (const line of payload.split(/\r?\n/)) {
    lines.push(`data: ${line}`)
  }

  lines.push("", "")

  return encoder.encode(lines.join("\n"))
}

export function encodeComment(comment: string): Uint8Array {
  return encoder.encode(`: ${comment}\n\n`)
}

export function createSseHeaders(): Headers {
  return new Headers({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  })
}

export function createJobEventStreamResponse({
  request,
  initialEvent,
  subscribe,
  keepaliveMs = DEFAULT_KEEPALIVE_MS,
}: {
  request: Request
  initialEvent: JobStreamEvent
  subscribe: JobEventSubscription
  keepaliveMs?: number
}): Response {
  let cleanupOnce = false
  let unsubscribe: (() => void) | undefined
  let keepaliveTimer: ReturnType<typeof setInterval> | undefined
  let abortListener: (() => void) | undefined

  const cleanup = () => {
    if (cleanupOnce) {
      return
    }

    cleanupOnce = true

    if (abortListener) {
      request.signal.removeEventListener("abort", abortListener)
    }

    if (keepaliveTimer) {
      clearInterval(keepaliveTimer)
    }

    unsubscribe?.()
    unsubscribe = undefined
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const closeFromAbort = () => {
        cleanup()
        controller.close()
      }

      abortListener = closeFromAbort
      request.signal.addEventListener("abort", closeFromAbort, { once: true })

      controller.enqueue(encodeEvent(initialEvent))
      unsubscribe = subscribe((event) => {
        try {
          controller.enqueue(encodeEvent(event))
        } catch {
          cleanup()
        }
      })

      keepaliveTimer = setInterval(() => {
        try {
          controller.enqueue(encodeComment("keepalive"))
        } catch {
          cleanup()
        }
      }, keepaliveMs)
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: createSseHeaders(),
  })
}
