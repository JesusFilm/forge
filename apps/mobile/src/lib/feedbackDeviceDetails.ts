/**
 * Device details for the opt-in switch (R9/KTD6). Three sources: expo-application
 * for the app version and native build, expo-device for the model, and Platform
 * for the OS name and version.
 *
 * Every value the phone cannot read renders and sends the string "Unknown", so
 * the disclosure list and the ticket say the same thing. The platform name has
 * no "Unknown" — it is always readable and is ALWAYS sent, switch or not.
 */
import * as Application from "expo-application"
import * as Device from "expo-device"
import { Platform } from "react-native"

import type { FeedbackDeviceDetails, FeedbackPlatform } from "./feedbackQueries"
import { FEEDBACK_DEVICE_FIELD_MAX_LENGTH } from "./feedbackSubmission"

export const UNKNOWN_DEVICE_VALUE = "Unknown"

/** Mirrors admin's PLATFORM_LABEL so the disclosure names what the ticket shows. */
export const FEEDBACK_PLATFORM_LABEL: Record<FeedbackPlatform, string> = {
  IOS: "iOS",
  ANDROID: "Android",
}

export function getFeedbackPlatform(): FeedbackPlatform {
  return Platform.OS === "ios" ? "IOS" : "ANDROID"
}

function readable(value: string | number | null | undefined): string {
  if (value == null) return UNKNOWN_DEVICE_VALUE
  const text = String(value).trim()
  if (!text) return UNKNOWN_DEVICE_VALUE
  // R18 cannot show an inline fix for a field nobody typed, so admin's 100
  // bound is enforced here instead of refusing the whole submission.
  return text.slice(0, FEEDBACK_DEVICE_FIELD_MAX_LENGTH)
}

export function readFeedbackDeviceDetails(): FeedbackDeviceDetails {
  return {
    appVersion: readable(Application.nativeApplicationVersion),
    appBuild: readable(Application.nativeBuildVersion),
    // A string on iOS ("26.0"), the API level as a number on Android.
    osVersion: readable(Platform.Version),
    deviceModel: readable(Device.modelName),
  }
}
