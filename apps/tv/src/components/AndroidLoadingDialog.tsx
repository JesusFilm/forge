import { useCallback, useId, useRef } from "react"
import { requireNativeModule } from "expo"
import { useFocusEffect } from "expo-router"

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
  const id = useId()
  const generation = useRef(0)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  useFocusEffect(
    useCallback(
      () =>
        openAndroidLoading(
          requireNativeModule<AndroidLoadingModule>("NativeAndroidPlayer"),
          `${id}-${++generation.current}`,
          message,
          () => onBackRef.current(),
        ),
      [id, message],
    ),
  )
  return null
}
