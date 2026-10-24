import { importSPKI } from "jose"

type SeoVerificationKey = Awaited<ReturnType<typeof importSPKI>>

export class SeoAssertionConfigurationError extends Error {
  constructor() {
    super("SEO assertion verification is not configured")
    this.name = "SeoAssertionConfigurationError"
  }
}

export class SeoAssertionInvalidError extends Error {
  constructor(message = "SEO assertion is invalid") {
    super(message)
    this.name = "SeoAssertionInvalidError"
  }
}

const importedKeys = new Map<string, Promise<SeoVerificationKey>>()

function keyMaterialFingerprint(value: string): string {
  return value.replace(/-----[^-]+-----|\s+/gu, "")
}

function parseKeyring(raw: string | undefined): Record<string, string> {
  if (!raw) throw new SeoAssertionConfigurationError()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new SeoAssertionConfigurationError()
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SeoAssertionConfigurationError()
  }
  const entries = Object.entries(parsed)
  if (
    entries.length === 0 ||
    entries.some(
      ([kid, pem]) =>
        !kid.trim() || typeof pem !== "string" || !pem.includes("PUBLIC KEY"),
    )
  ) {
    throw new SeoAssertionConfigurationError()
  }
  return Object.fromEntries(entries) as Record<string, string>
}

export function assertSeoAssertionKeyringsDisjoint({
  approval,
  workload,
}: {
  approval: string | undefined
  workload: string | undefined
}) {
  if (!approval || !workload) return
  const approvalKeys = new Set(
    Object.values(parseKeyring(approval)).map(keyMaterialFingerprint),
  )
  const overlaps = Object.values(parseKeyring(workload)).some((key) =>
    approvalKeys.has(keyMaterialFingerprint(key)),
  )
  if (overlaps) throw new SeoAssertionConfigurationError()
}

export async function resolveSeoAssertionKey({
  rawKeyring,
  kid,
  keyringName,
}: {
  rawKeyring: string | undefined
  kid: string | undefined
  keyringName: "approval" | "workload"
}): Promise<SeoVerificationKey> {
  if (!kid) throw new SeoAssertionInvalidError()
  const keyring = parseKeyring(rawKeyring)
  const pem = keyring[kid]
  if (!pem) throw new SeoAssertionInvalidError()
  const cacheKey = `${keyringName}:${kid}:${pem}`
  let imported = importedKeys.get(cacheKey)
  if (!imported) {
    imported = importSPKI(pem, "EdDSA")
    importedKeys.set(cacheKey, imported)
  }
  try {
    return await imported
  } catch {
    importedKeys.delete(cacheKey)
    throw new SeoAssertionConfigurationError()
  }
}
