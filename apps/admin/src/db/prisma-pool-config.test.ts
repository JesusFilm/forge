import { describe, expect, it } from "vitest"

import { prismaPgAdapterConfigForProfile } from "@/db/prisma-pool-config"

describe("prismaPgAdapterConfigForProfile", () => {
  it("selects the requested schema without rewriting a libpq multi-host URL", () => {
    const databaseUrl =
      "postgresql://user:p%40ss@host-a:5432,host-b:5433/forge_admin?schema=preview%2Dcatalog&sslmode=require"
    const config = prismaPgAdapterConfigForProfile(databaseUrl, "main")

    expect(config.poolConfig.connectionString).toBe(databaseUrl)
    expect(config.options).toEqual({ schema: "preview-catalog" })
  })

  it("keeps the main Prisma pool config in code", () => {
    expect(
      prismaPgAdapterConfigForProfile(
        "postgresql://user:pass@localhost:5432/forge_admin?sslmode=require",
        "main",
      ),
    ).toEqual({
      poolConfig: {
        connectionString:
          "postgresql://user:pass@localhost:5432/forge_admin?sslmode=require",
        max: 10,
        connectionTimeoutMillis: 20_000,
        idleTimeoutMillis: 300_000,
      },
      options: undefined,
    })
  })

  it("uses a separate in-code pool profile for Core sync", () => {
    expect(
      prismaPgAdapterConfigForProfile(
        "postgresql://user:pass@localhost:5432/forge_admin",
        "sync",
      ),
    ).toEqual({
      poolConfig: {
        connectionString: "postgresql://user:pass@localhost:5432/forge_admin",
        max: 5,
        connectionTimeoutMillis: 60_000,
        idleTimeoutMillis: 300_000,
      },
      options: undefined,
    })
  })
})
