import { useCallback, useId, useRef } from "react"
import { requireNativeModule } from "expo"
import { useFocusEffect } from "expo-router"
import { useStartupIntroActive } from "../contexts/StartupIntroProvider"

import {
  openAndroidLoading,
  type AndroidLoadingModule,
} from "./androidLoadingSession"

export function AndroidLoadingDialog({
  message,
  onBack,
}: {
  message: string
  onBack: () => void
}) {
  const introActive = useStartupIntroActive()
  const id = useId()
  const generation = useRef(0)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  useFocusEffect(
    useCallback(() => {
      if (introActive) return
      return openAndroidLoading(
        requireNativeModule<AndroidLoadingModule>("NativeAndroidPlayer"),
        `${id}-${++generation.current}`,
        message,
        () => onBackRef.current(),
      )
    }, [id, message, introActive]),
  )
  return null
}
