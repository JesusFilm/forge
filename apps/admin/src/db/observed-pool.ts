import { Pool, type PoolClient, type PoolConfig } from "pg"
import type { PrismaPoolProfile } from "./prisma-pool-config"
import {
  observeRecommendationPoolQueue,
  startRecommendationTiming,
} from "@/lib/recommendation-runtime-observation"

type ConnectCallback = Parameters<Pool["connect"]>[0]

/** Preserve both pg APIs: Prisma transactions use promises; Pool.query uses callbacks. */
export class ObservedPool extends Pool {
  constructor(
    config: PoolConfig,
    private readonly profile: PrismaPoolProfile = "main",
    private readonly observationLog: (line: string) => void = (line) =>
      console.info(line),
  ) {
    super(config)
  }

  override connect(): Promise<PoolClient>
  override connect(callback: ConnectCallback): void
  override connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    const finish = startRecommendationTiming("pool.acquire")
    const started = performance.now()
    const pendingAtStart = this.waitingCount
    const idleAtStart = this.idleCount
    const totalAtStart = this.totalCount
    const complete = (error?: Error, client?: PoolClient) => {
      finish?.(error)
      const elapsedMs = performance.now() - started
      // Prisma's native engine can enter the adapter without the caller's ALS
      // context. Keep slow acquisitions independently visible; never assign
      // them to an arbitrary concurrent request.
      if (elapsedMs < 50 && !error) return
      try {
        this.observationLog(
          JSON.stringify({
            event: "database.pool_acquisition",
            schemaVersion: 1,
            profile: this.profile,
            elapsedMs,
            pendingAtStart,
            idleAtStart,
            totalAtStart,
            requestCorrelated: finish != null,
            outcome: error ? "rejected" : "acquired",
            backendPid:
              client && "processID" in client ? client.processID : null,
          }),
        )
      } catch {
        // Keep the original acquisition/error and release contract intact.
      }
    }
    // Includes connection establishment; it is not purely queue wait.
    observeRecommendationPoolQueue(this.waitingCount)
    if (callback) {
      return super.connect((error, client, release) => {
        complete(error, client)
        callback(error, client, release)
      })
    }
    return super.connect().then(
      (client) => {
        complete(undefined, client)
        return client
      },
      (error: unknown) => {
        complete(error instanceof Error ? error : new Error())
        throw error
      },
    )
  }
}
