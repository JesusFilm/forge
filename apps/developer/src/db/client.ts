import { Pool, type QueryResultRow } from "pg"
import { env } from "@/config/env"

const globalForPool = globalThis as unknown as {
  developerAuthPool?: Pool
}

export const authRegistryPool =
  globalForPool.developerAuthPool ??
  new Pool({
    connectionString: env.AUTH_DATABASE_URL,
    max: 4,
  })

if (process.env.NODE_ENV !== "production") {
  globalForPool.developerAuthPool = authRegistryPool
}

export async function queryAuthRegistry<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
) {
  const result = await authRegistryPool.query<T>(text, [...values])
  return result.rows
}
