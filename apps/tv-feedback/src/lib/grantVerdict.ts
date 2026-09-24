import { createHash } from "node:crypto"

export type IntegrityPayload = {
  requestDetails?: {
    requestPackageName?: string
    requestHash?: string
    timestampMillis?: string
  }
  appIntegrity?: {
    appRecognitionVerdict?: string
    packageName?: string
    certificateSha256Digest?: string[]
    versionCode?: string
  }
  accountDetails?: { appLicensingVerdict?: string }
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] }
}

export function acceptsIntegrityVerdict(
  payload: IntegrityPayload | undefined,
  request: { packageName: string; versionCode: number },
  canonical: string,
  policy: { packageName: string; certs: string[]; versions: string[] },
  now = Date.now(),
): boolean {
  const expectedHash = createHash("sha256")
    .update(canonical)
    .digest("base64url")
  const age = now - Number(payload?.requestDetails?.timestampMillis)
  return Boolean(
    payload?.requestDetails?.requestPackageName === policy.packageName &&
    payload.requestDetails.requestHash === expectedHash &&
    age >= -60_000 &&
    age <= 120_000 &&
    request.packageName === policy.packageName &&
    payload.appIntegrity?.appRecognitionVerdict === "PLAY_RECOGNIZED" &&
    payload.appIntegrity.packageName === policy.packageName &&
    payload.appIntegrity.versionCode === String(request.versionCode) &&
    policy.versions.includes(String(request.versionCode)) &&
    payload.appIntegrity.certificateSha256Digest?.some((value) =>
      policy.certs.includes(value),
    ) &&
    payload.accountDetails?.appLicensingVerdict === "LICENSED" &&
    payload.deviceIntegrity?.deviceRecognitionVerdict?.includes(
      "MEETS_DEVICE_INTEGRITY",
    ),
  )
}
