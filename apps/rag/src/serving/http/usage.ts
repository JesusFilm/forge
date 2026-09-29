import { randomUUID } from "node:crypto"
import type { ServerResponse } from "node:http"
import type {
  ServiceDenial,
  UsageWriter,
} from "../../contracts/consumer-usage.js"

/** Serializes local writes with heartbeats. Failures freeze coverage until a durable gap is recorded. */
export class UsageCollector {
  readonly instanceId = randomUUID()
  private queue: Promise<unknown> = Promise.resolve()
  private timer?: ReturnType<typeof setInterval>
  private opened = false
  private failedFrom?: Date
  private lastCheckpoint: Date
  constructor(
    private readonly store: UsageWriter,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.lastCheckpoint = this.now()
  }
  private run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    const work = this.queue.then(async () => {
      try {
        if (!this.opened) {
          await this.store.open(this.instanceId, this.now())
          this.opened = true
        }
        if (this.failedFrom) {
          await this.store.gap(this.instanceId, this.failedFrom, this.now())
          this.failedFrom = undefined
        }
        return await operation()
      } catch {
        this.failedFrom ??= this.lastCheckpoint
        console.error("[rag] event=usage_unavailable")
        return undefined
      }
    })
    this.queue = work
    return work
  }
  async start(): Promise<void> {
    await this.run(async () => {})
    this.timer = setInterval(() => {
      void this.flush()
    }, 5000)
    this.timer.unref()
  }
  async admit(consumerId: string, outgoing?: ServerResponse): Promise<void> {
    const admittedAt = this.now()
    // Install listeners before the asynchronous admission; an early disconnect still completes as failure.
    let settled = false
    const completion = new Promise<boolean>((resolve) => {
      if (!outgoing) {
        resolve(false)
        return
      }
      if (outgoing.destroyed) {
        resolve(false)
        return
      }
      outgoing.once("finish", () => {
        settled = true
        resolve(outgoing.statusCode >= 200 && outgoing.statusCode < 300)
      })
      outgoing.once("close", () => {
        if (!settled) resolve(false)
      })
    })
    const attempt = await this.run(() =>
      this.store.admit(this.instanceId, consumerId, admittedAt),
    )
    if (attempt) {
      if (!outgoing)
        await this.run(() =>
          this.store.gap(
            this.instanceId,
            this.lastCheckpoint,
            new Date(this.now().getTime() + 1),
          ),
        )
      void completion.then((success) =>
        this.run(() => this.store.complete(attempt, success)),
      )
    }
  }
  denial(reason: ServiceDenial): void {
    const at = this.now()
    void this.run(() => this.store.denial(reason, at))
  }
  async flush(stop = false): Promise<void> {
    const at = this.now()
    await this.run(async () => {
      await this.store.checkpoint(this.instanceId, at, stop)
      this.lastCheckpoint = at
    })
  }
  async stop(): Promise<void> {
    clearInterval(this.timer)
    await this.flush(true)
  }
}
