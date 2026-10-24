type BoundedSearchTraceWriteQueueOptions<T> = {
  concurrency: number
  maxPending: number
  worker: (value: T) => Promise<void>
  onError?: (error: unknown) => void
}

type QueuedValue<T> = {
  value: T
  complete: () => void
}

export class BoundedSearchTraceWriteQueue<T> {
  private readonly pending: QueuedValue<T>[] = []
  private active = 0
  private scheduled = false

  constructor(
    private readonly options: BoundedSearchTraceWriteQueueOptions<T>,
  ) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
      throw new Error("Search trace queue concurrency must be positive")
    }
    if (!Number.isInteger(options.maxPending) || options.maxPending < 1) {
      throw new Error("Search trace queue capacity must be positive")
    }
  }

  enqueue(value: T): boolean {
    return this.enqueueWithCompletion(value) != null
  }

  enqueueWithCompletion(value: T): Promise<void> | null {
    if (this.active + this.pending.length >= this.options.maxPending) {
      return null
    }
    let complete!: () => void
    const completion = new Promise<void>((resolve) => {
      complete = resolve
    })
    this.pending.push({ value, complete })
    this.schedule()
    return completion
  }

  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      this.drain()
    })
  }

  private drain(): void {
    while (this.active < this.options.concurrency && this.pending.length > 0) {
      const queued = this.pending.shift()
      if (queued === undefined) return
      this.active += 1
      Promise.resolve()
        .then(() => this.options.worker(queued.value))
        .catch((error: unknown) => this.options.onError?.(error))
        .finally(() => {
          queued.complete()
          this.active -= 1
          this.schedule()
        })
    }
  }
}
