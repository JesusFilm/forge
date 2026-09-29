/**
 * R22's foreground rule (KTD9). The adapter registers one handler for both
 * families, so the branch that decides what a notification shows lives here,
 * pure: the native module supplies the trigger and nothing else is read.
 */

export type NotificationPresentation = {
  shouldShowBanner: boolean
  shouldShowList: boolean
  shouldPlaySound: boolean
  shouldSetBadge: boolean
}

/** A reminder that fires while the app is open must show nothing (KTD1). */
export const SUPPRESSED_PRESENTATION: NotificationPresentation = {
  shouldShowBanner: false,
  shouldShowList: false,
  shouldPlaySound: false,
  shouldSetBadge: false,
}

/** Sound stays off: the viewer is already looking at the screen (R22). */
export const ANNOUNCEMENT_PRESENTATION: NotificationPresentation = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: false,
  shouldSetBadge: false,
}

/** True only for the trigger the push service delivers. */
export function isRemotePushTrigger(trigger: unknown): boolean {
  if (typeof trigger !== "object" || trigger === null) return false
  return (trigger as { type?: unknown }).type === "push"
}

/**
 * What one arriving notification shows. Anything the module cannot describe
 * suppresses, which is the safe answer: a local reminder is the only thing
 * this app schedules, and an unreadable trigger is not a remote one.
 */
export function presentationForTrigger(
  trigger: unknown,
): NotificationPresentation {
  return isRemotePushTrigger(trigger)
    ? ANNOUNCEMENT_PRESENTATION
    : SUPPRESSED_PRESENTATION
}
