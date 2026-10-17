import { createHash, createPublicKey, createVerify } from "node:crypto"

type ProofInput = {
  challengeId: string
  installationId: string
  keyFingerprint: string
  packageName: string
  versionCode: number
  publicKey: string
  signature: string
}

export function canonicalGrantRequest(
  input: ProofInput,
  nonce: string,
  utcDay: string,
): string {
  return [
    "feedback-qr-v1",
    input.challengeId,
    nonce,
    utcDay,
    input.installationId,
    input.keyFingerprint,
    input.packageName,
    String(input.versionCode),
  ].join("\n")
}

export function publicKeyMatches(
  input: ProofInput,
  canonical: string,
): boolean {
  try {
    const bytes = Buffer.from(input.publicKey, "base64url")
    if (
      createHash("sha256").update(bytes).digest("base64url") !==
      input.keyFingerprint
    )
      return false
    const key = createPublicKey({ key: bytes, format: "der", type: "spki" })
    if (
      key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    )
      return false
    const verifier = createVerify("sha256")
    verifier.update(canonical)
    verifier.end()
    return verifier.verify(key, Buffer.from(input.signature, "base64url"))
  } catch {
    return false
  }
}

export function nextUtcMidnight(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000)
}
