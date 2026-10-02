import { useCallback, useEffect, useState } from "react"
import { useNavigation, useRouter } from "expo-router"

import { FeedbackSheetContent } from "../src/components/feedback/FeedbackSheetContent"

/** The Profile door (KTD4/R1): a ROOT form-sheet route with no context, so it
 * opens on step one. R3: needs no session, so it's the same signed in or out. */
export default function FeedbackSheetRoute() {
  const router = useRouter()
  const navigation = useNavigation()
  const [dismissLocked, setDismissLocked] = useState(false)

  // R19, the iOS half: rn-screens sets `modalInPresentation = !gestureEnabled`
  // (ios/RNSScreen.mm:316), which refuses the pull-down. Android stores the
  // prop (ScreenViewManager.kt:155) and never reads it, so it is inert there.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !dismissLocked })
  }, [navigation, dismissLocked])

  // R19, the JS half: this is what stops the Android back button, the header
  // back and any `router.back()`. It never sees a native iOS sheet dismiss —
  // that is what the option above is for.
  useEffect(() => {
    if (!dismissLocked) return
    return navigation.addListener("beforeRemove", (event) => {
      event.preventDefault()
    })
  }, [navigation, dismissLocked])

  const handleClose = useCallback(() => {
    router.back()
  }, [router])

  return (
    <FeedbackSheetContent
      onClose={handleClose}
      onDismissLockedChange={setDismissLocked}
    />
  )
}
