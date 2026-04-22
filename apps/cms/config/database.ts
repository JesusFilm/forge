import type { Core } from "@strapi/strapi"

const config = ({
  env,
}: Core.Config.Shared.ConfigParams): Core.Config.Database => {
  return {
    settings: {
      useTypescriptMigrations: true,
    },
    connection: {
      client: "postgres",
      connection: {
        connectionString: env("DATABASE_URL"),
        host: env("DATABASE_HOST", "localhost"),
        port: env.int("DATABASE_PORT", 5432),
        database: env("DATABASE_NAME", "strapi"),
        user: env("DATABASE_USERNAME", "strapi"),
        password: env("DATABASE_PASSWORD", "strapi"),
        ssl: env.bool("DATABASE_SSL", false) && {
          key: env("DATABASE_SSL_KEY", undefined),
          cert: env("DATABASE_SSL_CERT", undefined),
          ca: env("DATABASE_SSL_CA", undefined),
          capath: env("DATABASE_SSL_CAPATH", undefined),
          cipher: env("DATABASE_SSL_CIPHER", undefined),
          rejectUnauthorized: env.bool(
            "DATABASE_SSL_REJECT_UNAUTHORIZED",
            true,
          ),
        },
        schema: env("DATABASE_SCHEMA", "public"),
      },
      pool: {
        min: env.int("DATABASE_POOL_MIN", 2),
        // GraphQL association resolvers fire N+1 findOne queries that each
        // need their own connection. A single nested query can easily need
        // 15+ concurrent connections; the old default of 10 caused cascading
        // KnexTimeoutErrors under normal GraphQL load.
        max: env.int("DATABASE_POOL_MAX", 25),
        // Set per-connection statement_timeout and idle_in_transaction timeout
        // so slow or abandoned queries release connections back to the pool.
        //
        // Also enable pgvector's HNSW iterative scan so filtered nearest-
        // neighbour queries (e.g. `WHERE locale = ? ORDER BY embedding <=> ?`)
        // can keep fetching from the partial HNSW index until LIMIT is
        // satisfied, instead of stopping at the default ef_search window of
        // 40 candidates. Combined with the per-locale partial indexes
        // created in `bootstrap/ensure-pgvector.ts`, this is what makes
        // experience semantic search use the index at scale.
        // `relaxed_order` allows pgvector to return rows out of strict
        // distance order during iteration, which is fine because the
        // outer ORDER BY in our queries re-sorts the result. SET commands
        // are quietly ignored if the pgvector extension is missing.
        afterCreate(
          conn: { query: (sql: string, cb: () => void) => void },
          cb: () => void,
        ) {
          const statementTimeout = env.int("DATABASE_STATEMENT_TIMEOUT", 30000)
          const idleTxTimeout = env.int(
            "DATABASE_IDLE_IN_TRANSACTION_TIMEOUT",
            60000,
          )
          conn.query(
            `SET statement_timeout = ${statementTimeout};
             SET idle_in_transaction_session_timeout = ${idleTxTimeout};
             SET hnsw.iterative_scan = relaxed_order;
             SET hnsw.max_scan_tuples = 20000;`,
            cb,
          )
        },
        // Reap idle connections more aggressively to free resources.
        idleTimeoutMillis: env.int("DATABASE_POOL_IDLE_TIMEOUT", 30000),
        reapIntervalMillis: env.int("DATABASE_POOL_REAP_INTERVAL", 1000),
      },
      acquireConnectionTimeout: env.int("DATABASE_CONNECTION_TIMEOUT", 60000),
    },
  }
}

export default config
