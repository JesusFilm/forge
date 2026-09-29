/**
 * R31's reveal. A five-second hold on the mission screen's "Become a beta
 * tester" button shows this phone's notification test ID in a native alert,
 * with Close and a copy action. The app shows the ID nowhere else, on purpose;
 * the admin test-device page tells staff how to find it.
 *
 * The alert names the ID only when this phone has one. Before the first
 * registration lands it reads as registering, and while permission is denied it
 * says so instead. Neither state offers the copy action.
 */
import { Alert, type AlertButton } from "react-native"

import {
  PUSH_TEST_ID_ALERT_TITLE,
  PUSH_TEST_ID_CLOSE_ACTION,
  PUSH_TEST_ID_COPY_ACTION,
  PUSH_TEST_ID_HELP,
  PUSH_TEST_ID_NOTIFICATIONS_OFF,
  PUSH_TEST_ID_REGISTERING,
} from "./constants"
import {
  getPushRegistrationStore,
  type PushRegistrationSnapshot,
  type PushRegistrationStore,
} from "./store"
import { copyPushTestId } from "./testIdActions"

export type PushTestIdAlert = Readonly<{
  title: string
  message: string
  buttons: AlertButton[]
}>

export function pushTestIdAlert(
  snapshot: PushRegistrationSnapshot,
  copy: (testDeviceId: string) => void = copyPushTestId,
): PushTestIdAlert {
  const { testDeviceId, permission } = snapshot
  const close: AlertButton = {
    text: PUSH_TEST_ID_CLOSE_ACTION,
    style: "cancel",
  }
  if (testDeviceId == null || testDeviceId.length === 0) {
    return {
      title: PUSH_TEST_ID_ALERT_TITLE,
      message:
        permission === "denied"
          ? PUSH_TEST_ID_NOTIFICATIONS_OFF
          : PUSH_TEST_ID_REGISTERING,
      buttons: [close],
    }
  }
  const note =
    permission === "denied" ? PUSH_TEST_ID_NOTIFICATIONS_OFF : PUSH_TEST_ID_HELP
  return {
    title: PUSH_TEST_ID_ALERT_TITLE,
    message: `${testDeviceId}\n\n${note}`,
    buttons: [
      close,
      { text: PUSH_TEST_ID_COPY_ACTION, onPress: () => copy(testDeviceId) },
    ],
  }
}

export type PushTestIdRevealDeps = {
  store: Pick<PushRegistrationStore, "hydrate" | "getSnapshot">
  alert: typeof Alert.alert
}

export async function revealPushTestId(
  deps: PushTestIdRevealDeps = {
    store: getPushRegistrationStore(),
    alert: (...args) => Alert.alert(...args),
  },
): Promise<void> {
  // The store reads its record once per launch, and nothing may have read it
  // yet on this launch. `hydrate` never rejects, so the alert always shows.
  await deps.store.hydrate()
  const { title, message, buttons } = pushTestIdAlert(deps.store.getSnapshot())
  deps.alert(title, message, buttons, { cancelable: true })
}
