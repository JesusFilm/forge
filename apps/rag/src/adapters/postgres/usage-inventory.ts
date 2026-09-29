import type { PrismaClient } from "../../generated/prisma/index.js"
import { UsageError } from "../../contracts/consumer-usage.js"
/** Independent operator capability; collectors and report readers cannot modify inventory. */
export class PostgresUsageInventory {
  constructor(private readonly db: PrismaClient) {}
  async declare(
    deploymentId: string,
    startsAt: Date,
    expectedReplicas: number,
  ): Promise<void> {
    if (
      !/^[A-Za-z0-9-]{1,80}$/.test(deploymentId) ||
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isInteger(expectedReplicas) ||
      expectedReplicas < 1 ||
      expectedReplicas > 64
    )
      throw new UsageError("unavailable")
    await this.db
      .$executeRaw`INSERT INTO usage_private.deployment_inventory(deployment_id, starts_at, expected_replicas) VALUES(${deploymentId}, ${startsAt}, ${expectedReplicas})`
  }
  async close(deploymentId: string, endsAt: Date): Promise<void> {
    if (
      !/^[A-Za-z0-9-]{1,80}$/.test(deploymentId) ||
      !Number.isFinite(endsAt.getTime())
    )
      throw new UsageError("unavailable")
    const changed = await this.db
      .$executeRaw`UPDATE usage_private.deployment_inventory SET ends_at=${endsAt} WHERE deployment_id=${deploymentId} AND starts_at <= ${endsAt} AND ends_at IS NULL`
    if (changed !== 1) throw new UsageError("unavailable")
  }
}
