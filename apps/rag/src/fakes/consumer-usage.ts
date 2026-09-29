import type { UsageWriter } from "../contracts/consumer-usage.js"
export class MemoryUsageStore implements UsageWriter {
  private requests = 0
  private successes = 0
  private attempts = new Set<string>()
  async open(): Promise<void> {}
  async admit(): Promise<string> {
    this.requests++
    const id = crypto.randomUUID()
    this.attempts.add(id)
    return id
  }
  async complete(id: string, success: boolean): Promise<void> {
    if (this.attempts.delete(id) && success) this.successes++
  }
  async checkpoint(): Promise<void> {}
  async gap(): Promise<void> {}
  async denial(): Promise<void> {}
  totals(): { requests: number; successes: number } {
    return { requests: this.requests, successes: this.successes }
  }
}
