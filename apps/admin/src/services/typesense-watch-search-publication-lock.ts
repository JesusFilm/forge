/**
 * Shared PostgreSQL advisory lock for current-index publication and candidate
 * lease admission. A publisher holds the session lock for the full Typesense
 * operation; lease acquisition probes the same key transactionally.
 */
import { Client } from "pg"

export const TYPESENSE_WATCH_SEARCH_PUBLICATION_LOCK_ID = 1_179_605_063

export type TypesenseWatchSearchIndexLockClient = {
  connect(): Promise<void>
  query(
    text: string,
    values: readonly unknown[],
  ): Promise<{ rows: Array<{ acquired?: boolean; released?: boolean }> }>
  end(): Promise<void>
}

type TypesenseWatchSearchIndexLockClientFactory = (
  databaseUrl: string,
) => TypesenseWatchSearchIndexLockClient

function defaultLockClientFactory(
  databaseUrl: string,
): TypesenseWatchSearchIndexLockClient {
  const client = new Client({ connectionString: databaseUrl })
  return {
    connect: async () => {
      await client.connect()
    },
    query: async (text, values) => client.query(text, [...values]),
    end: () => client.end(),
  }
}

export async function withTypesenseWatchSearchIndexLock<T>(
  run: () => Promise<T>,
  {
    databaseUrl = process.env.DATABASE_URL,
    clientFactory = defaultLockClientFactory,
  }: {
    databaseUrl?: string
    clientFactory?: TypesenseWatchSearchIndexLockClientFactory
  } = {},
): Promise<T> {
  if (!databaseUrl) throw new Error("DATABASE_URL is required")
  const client = clientFactory(databaseUrl)
  await client.connect()
  let acquired = false
  let runSucceeded = false
  let runResult: T | undefined
  let runError: unknown
  const cleanupErrors: unknown[] = []
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [TYPESENSE_WATCH_SEARCH_PUBLICATION_LOCK_ID],
    )
    if (result.rows[0]?.acquired !== true) {
      throw new Error(
        "Another Typesense Watch Search index release is already running",
      )
    }
    acquired = true
    runResult = await run()
    runSucceeded = true
  } catch (error) {
    runError = error
  } finally {
    if (acquired) {
      try {
        const result = await client.query(
          "SELECT pg_advisory_unlock($1) AS released",
          [TYPESENSE_WATCH_SEARCH_PUBLICATION_LOCK_ID],
        )
        if (result.rows[0]?.released !== true) {
          cleanupErrors.push(
            new Error(
              "PostgreSQL did not release the Typesense Watch Search index lock",
            ),
          )
        }
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    try {
      await client.end()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      runSucceeded ? cleanupErrors : [runError, ...cleanupErrors],
      "Typesense Watch Search index lock cleanup failed",
    )
  }
  if (!runSucceeded) throw runError
  return runResult as T
}
