import type { PrismaClient } from "@prisma/client"
import { after } from "next/server"

import {
  recordWatchSearchTraceToCompletionSafely,
  type RecordWatchSearchTraceInput,
} from "./search-trace.service"
import { BoundedSearchTraceWriteQueue } from "./search-trace-write-queue"
import type {
  WatchSearchInput,
  WatchSearchResponse,
} from "./watch-search.service"

const SHADOW_QUEUE_CONCURRENCY = 1
const SHADOW_QUEUE_CAPACITY = 64

type WatchSearchService = {
  search(input: WatchSearchInput): Promise<WatchSearchResponse>
}

export type WatchSearchShadowJob = {
  input: WatchSearchInput
  primaryResponse: WatchSearchResponse
  prisma: PrismaClient
  service: WatchSearchService
}

type RunWatchSearchShadowDeps = {
  now?: () => Date
  recordTrace?: (
    input: RecordWatchSearchTraceInput,
    prisma: PrismaClient,
  ) => Promise<unknown>
}

type ScheduleAfter = (callback: () => Promise<void>) => void

type WatchSearchShadowQueueOptions = {
  concurrency?: number
  maxPending?: number
  worker?: (job: WatchSearchShadowJob) => Promise<void>
  scheduleAfter?: ScheduleAfter
  logger?: Pick<Console, "warn">
}

function errorClass(error: unknown): string {
  if (error instanceof Error && error.name) return error.name
  return typeof error
}

export async function runWatchSearchShadow(
  job: WatchSearchShadowJob,
  deps: RunWatchSearchShadowDeps = {},
): Promise<void> {
  const now = deps.now ?? (() => new Date())
  const recordTrace =
    deps.recordTrace ?? recordWatchSearchTraceToCompletionSafely
  const shadowInput: WatchSearchInput = {
    ...job.input,
    mode: "default",
    shadowMode: null,
    clientRequestId: job.primaryResponse.requestId,
  }
  const startedAt = now()
  const response = await job.service.search(shadowInput)
  const completedAt = now()

  await recordTrace(
    {
      input: shadowInput,
      response,
      startedAt,
      completedAt,
      traceRole: "shadow",
      shadowOfRequestId: job.primaryResponse.requestId,
    },
    job.prisma,
  )
}

export class WatchSearchShadowQueue {
  private readonly queue: BoundedSearchTraceWriteQueue<WatchSearchShadowJob>
  private readonly maxPending: number
  private readonly scheduleAfter: ScheduleAfter
  private readonly logger: Pick<Console, "warn">
  private reserved = 0

  constructor(options: WatchSearchShadowQueueOptions = {}) {
    this.maxPending = options.maxPending ?? SHADOW_QUEUE_CAPACITY
    this.scheduleAfter =
      options.scheduleAfter ?? ((callback) => after(callback))
    this.logger = options.logger ?? console
    this.queue = new BoundedSearchTraceWriteQueue({
      concurrency: options.concurrency ?? SHADOW_QUEUE_CONCURRENCY,
      maxPending: this.maxPending,
      worker: options.worker ?? runWatchSearchShadow,
      onError: (error) => {
        this.logger.warn(
          `[watch-search] event=shadow_failed error_class=${errorClass(error)}`,
        )
      },
    })
  }

  enqueue(job: WatchSearchShadowJob): boolean {
    if (this.reserved >= this.maxPending) {
      this.logger.warn(
        `[watch-search] event=shadow_queue_full capacity=${this.maxPending}`,
      )
      return false
    }

    this.reserved += 1
    try {
      this.scheduleAfter(async () => {
        try {
          const completion = this.queue.enqueueWithCompletion(job)
          if (!completion) {
            this.logger.warn(
              `[watch-search] event=shadow_queue_full capacity=${this.maxPending}`,
            )
            return
          }
          await completion
        } finally {
          this.reserved -= 1
        }
      })
      return true
    } catch (error) {
      this.reserved -= 1
      this.logger.warn(
        `[watch-search] event=shadow_schedule_failed error_class=${errorClass(error)}`,
      )
      return false
    }
  }
}

const watchSearchShadowQueue = new WatchSearchShadowQueue()

export function enqueueWatchSearchShadow(job: WatchSearchShadowJob): boolean {
  return watchSearchShadowQueue.enqueue(job)
}
