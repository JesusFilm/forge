import type { PoolConfig } from "pg"

export type PrismaPoolProfile = "main" | "sync"

type PrismaPgAdapterConfig = {
  poolConfig: PoolConfig
  options?: {
    schema?: string
  }
}

const POOL_PROFILES = {
  main: {
    max: 10,
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 300_000,
  },
  sync: {
    max: 5,
    connectionTimeoutMillis: 60_000,
    idleTimeoutMillis: 300_000,
  },
} as const satisfies Record<PrismaPoolProfile, PoolConfig>

export function prismaPgAdapterConfigForProfile(
  databaseUrl: string | undefined,
  profile: PrismaPoolProfile,
): PrismaPgAdapterConfig {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required")
  }

  // Parse only the query so libpq multi-host authorities and encoding survive.
  // PrismaPg needs its own schema option for qualified model queries.
  const query = databaseUrl.match(/\?([^#]*)/u)?.[1]
  const schema = query ? new URLSearchParams(query).get("schema") : null

  return {
    poolConfig: {
      connectionString: databaseUrl,
      ...POOL_PROFILES[profile],
    },
    options: schema ? { schema } : undefined,
  }
}
