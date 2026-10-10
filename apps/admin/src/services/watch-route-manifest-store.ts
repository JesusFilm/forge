import type { PrismaClient } from "@prisma/client"
import {
  WatchRouteManifestSchema,
  type WatchRouteManifest,
} from "./watch-route-manifest.service"

export const WATCH_ROUTE_MANIFEST_SNAPSHOT_KEY = "latest"

export type WatchRouteManifestSnapshotRecord = {
  key: string
  version: string
  generatedAt: Date
  payload: WatchRouteManifest
  payloadSizeBytes: number
  createdAt: Date
  updatedAt: Date
}

type StorePrisma = Pick<PrismaClient, "$executeRaw" | "$queryRaw">

type SnapshotRow = {
  key: string
  version: string
  generatedAt: Date
  payload: unknown
  payloadSizeBytes: number | bigint
  createdAt: Date
  updatedAt: Date
}

export class WatchRouteManifestStore {
  constructor(private readonly prisma: StorePrisma) {}

  async getLatest(): Promise<WatchRouteManifestSnapshotRecord | null> {
    const rows = await this.prisma.$queryRaw<SnapshotRow[]>`
      SELECT
        "key",
        "version",
        "generated_at" AS "generatedAt",
        "payload",
        "payload_size_bytes" AS "payloadSizeBytes",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt"
      FROM "watch_route_manifest_snapshot"
      WHERE "key" = ${WATCH_ROUTE_MANIFEST_SNAPSHOT_KEY}
      LIMIT 1
    `
    const row = rows[0]
    return row ? normalizeSnapshotRow(row) : null
  }

  async upsertLatest(
    manifest: WatchRouteManifest,
  ): Promise<WatchRouteManifestSnapshotRecord> {
    const payload = WatchRouteManifestSchema.parse(manifest)
    const serializedPayload = JSON.stringify(payload)
    const payloadSizeBytes = Buffer.byteLength(serializedPayload, "utf8")
    const generatedAt = new Date(payload.generatedAt)

    await this.prisma.$executeRaw`
      INSERT INTO "watch_route_manifest_snapshot" (
        "key",
        "version",
        "generated_at",
        "payload",
        "payload_size_bytes",
        "created_at",
        "updated_at"
      )
      VALUES (
        ${WATCH_ROUTE_MANIFEST_SNAPSHOT_KEY},
        ${payload.version},
        ${generatedAt},
        ${serializedPayload}::jsonb,
        ${payloadSizeBytes},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("key") DO UPDATE SET
        "version" = EXCLUDED."version",
        "generated_at" = EXCLUDED."generated_at",
        "payload" = EXCLUDED."payload",
        "payload_size_bytes" = EXCLUDED."payload_size_bytes",
        "updated_at" = CURRENT_TIMESTAMP
    `

    const latest = await this.getLatest()
    if (!latest) {
      throw new Error("watch route manifest snapshot missing after upsert")
    }
    return latest
  }
}

function normalizeSnapshotRow(
  row: SnapshotRow,
): WatchRouteManifestSnapshotRecord {
  const rawPayload =
    typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
  return {
    key: row.key,
    version: row.version,
    generatedAt: row.generatedAt,
    payload: WatchRouteManifestSchema.parse(rawPayload),
    payloadSizeBytes: Number(row.payloadSizeBytes),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
