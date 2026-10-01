import { requireOptionalNativeModule } from "expo"
import { Platform } from "react-native"

export type AttestedGrant = {
  installationId: string
  publicKey: string
  keyFingerprint: string
  packageName: string
  versionCode: number
  tvMode: boolean
  signature: string
  integrityToken: string
}

type NativeModule = {
  attestGrant(
    challengeId: string,
    nonce: string,
    utcDay: string,
    cloudProjectNumber: string,
  ): Promise<AttestedGrant>
}

export type AppleGrantProof = Omit<AttestedGrant, "integrityToken"> & {
  deviceToken: string
}

type AppleModule = {
  attestGrant(
    challengeId: string,
    nonce: string,
    utcDay: string,
  ): Promise<AppleGrantProof>
}

const nativeModule =
  Platform.OS === "android"
    ? requireOptionalNativeModule<NativeModule>("TvFeedbackIntegrity")
    : null
const appleModule =
  Platform.OS === "ios"
    ? requireOptionalNativeModule<AppleModule>("TvFeedbackAppleIntegrity")
    : null

export async function attestFeedbackGrant(
  challengeId: string,
  nonce: string,
  utcDay: string,
  cloudProjectNumber: string,
): Promise<AttestedGrant> {
  if (!nativeModule) throw new Error("verified_feedback_unavailable")
  return nativeModule.attestGrant(
    challengeId,
    nonce,
    utcDay,
    cloudProjectNumber,
  )
}

export async function attestAppleFeedbackGrant(
  challengeId: string,
  nonce: string,
  utcDay: string,
): Promise<AppleGrantProof> {
  if (!appleModule) throw new Error("verified_feedback_unavailable")
  return appleModule.attestGrant(challengeId, nonce, utcDay)
}
