import type { ServerResponse } from "node:http"
import type {
  ServiceDenial,
  UsageWriter,
} from "../../contracts/consumer-usage.js"

/** Records attempts and completed responses; database failures never block retrieval. */
export class UsageCollector {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly store: UsageWriter,
    private readonly now: () => Date = () => new Date(),
  ) {}
  private run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    const work = this.queue.then(async () => {
      try {
        return await operation()
      } catch {
        console.error("[rag] event=usage_unavailable")
        return undefined
      }
    })
    this.queue = work
    return work
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
      this.store.admit(consumerId, admittedAt),
    )
    if (attempt) {
      void completion.then((success) =>
        this.run(() => this.store.complete(attempt, success)),
      )
    }
  }
  denial(reason: ServiceDenial): void {
    const at = this.now()
    void this.run(() => this.store.denial(reason, at))
  }
  async flush(): Promise<void> {
    await this.queue
  }
  async stop(): Promise<void> {
    await this.flush()
  }
}
