import { requireOptionalNativeModule } from "expo-modules-core"
import { Platform } from "react-native"

export type GoogleTvVideo = {
  slug: string
  title: string
  description: string
  posterUri: string
  playbackUri: string
  durationMillis: number
  positionMillis?: number
  lastEngagementMillis?: number
}

export type GoogleTvHomeResult = {
  status:
    | "available"
    | "unavailable"
    | "published"
    | "removed"
    | "error"
    | "blocked"
  environment: "production" | "verification"
  message: string
  count: number
}

type GoogleTvHomeModule = {
  getStatus(continuation: boolean): Promise<GoogleTvHomeResult>
  publish(
    videos: GoogleTvVideo[],
    consent: boolean,
    title: string,
    continuation: boolean,
  ): Promise<GoogleTvHomeResult>
  remove(continuation: boolean): Promise<GoogleTvHomeResult>
}

export function getGoogleTvHomeModule(): GoogleTvHomeModule | null {
  return Platform.OS === "android"
    ? requireOptionalNativeModule<GoogleTvHomeModule>("GoogleTvHome")
    : null
}
