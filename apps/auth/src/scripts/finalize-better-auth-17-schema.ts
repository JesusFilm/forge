import { prisma } from "@/db/client"
import { env, getAuthBaseUrl } from "@/config/env"

type AccountIdentity = {
  accountId: string
  issuer: string | null
  providerId: string
}

const STATIC_ACCOUNT_ISSUERS = {
  credential: "local:credential",
  firebase: "local:firebase",
  google: "https://accounts.google.com",
  facebook: "https://www.facebook.com",
  apple: "https://appleid.apple.com",
} as const

/**
 * Completes the additive Better Auth 1.7 migration using only trusted runtime
 * configuration. This runs inside the existing post-migrate first-party seed,
 * before the 1.7 runtime starts accepting writes.
 */
export async function finalizeBetterAuth17Schema() {
  const accounts = await prisma.$queryRaw<AccountIdentity[]>`
    SELECT "provider_id" AS "providerId", "account_id" AS "accountId", "issuer"
    FROM "account"
  `
  const mappings = trustedIssuerMappings()
  const issuersByProvider = new Map(
    mappings.map(({ providerId, issuer }) => [providerId, issuer]),
  )

  const unknownProviders = Array.from(
    new Set(
      accounts
        .map(({ providerId }) => providerId)
        .filter((providerId) => !issuersByProvider.has(providerId)),
    ),
  ).sort()
  if (unknownProviders.length > 0) {
    throw new Error(
      `Better Auth 1.7 issuer migration has no trusted mapping for provider(s): ${unknownProviders.join(", ")}`,
    )
  }

  for (const account of accounts) {
    const trustedIssuer = issuersByProvider.get(account.providerId)!
    if (account.issuer !== null && account.issuer !== trustedIssuer) {
      throw new Error(
        `Better Auth 1.7 issuer migration found an untrusted issuer for provider ${account.providerId}`,
      )
    }
  }

  const identities = new Map<string, string>()
  for (const account of accounts) {
    const trustedIssuer = issuersByProvider.get(account.providerId)!
    const key = JSON.stringify([trustedIssuer, account.accountId])
    const firstProvider = identities.get(key)
    if (firstProvider && firstProvider !== account.providerId) {
      throw new Error(
        `Better Auth 1.7 issuer migration collision for providers ${firstProvider} and ${account.providerId}`,
      )
    }
    identities.set(key, account.providerId)
  }

  await prisma.$transaction(async (tx) => {
    for (const { providerId, issuer } of mappings) {
      await tx.$executeRaw`
        INSERT INTO "auth_account_issuer_mapping"
          ("provider_id", "issuer", "created_at", "updated_at")
        VALUES (${providerId}, ${issuer}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("provider_id") DO UPDATE
        SET "issuer" = EXCLUDED."issuer", "updated_at" = CURRENT_TIMESTAMP
      `
    }

    for (const { providerId, issuer } of mappings) {
      await tx.$executeRaw`
        UPDATE "account"
        SET "issuer" = ${issuer}
        WHERE "provider_id" = ${providerId} AND "issuer" IS NULL
      `
    }

    const remaining = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count" FROM "account" WHERE "issuer" IS NULL
    `
    if (remaining[0]?.count !== 0n) {
      throw new Error("Better Auth 1.7 issuer migration left null issuers")
    }

    // Constant DDL only; no runtime value is interpolated into these commands.
    await tx.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "account_issuer_account_id_key" ON "account"("issuer", "account_id")',
    )
    await tx.$executeRawUnsafe(
      'ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL',
    )
  })
}

function trustedIssuerMappings(): Array<{
  providerId: string
  issuer: string
}> {
  const mappings: Array<{ providerId: string; issuer: string }> =
    Object.entries(STATIC_ACCOUNT_ISSUERS).map(([providerId, issuer]) => ({
      providerId,
      issuer,
    }))

  mappings.push({
    providerId: "jfp",
    issuer: `${withoutTrailingSlash(getAuthBaseUrl())}/api/auth`,
  })
  if (env.OKTA_ISSUER) {
    mappings.push({
      providerId: "okta",
      issuer: withoutTrailingSlash(env.OKTA_ISSUER),
    })
  }

  return mappings
}

function withoutTrailingSlash(value: string) {
  return value.replace(/\/$/, "")
}
