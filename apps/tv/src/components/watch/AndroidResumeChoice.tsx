import { useEffect, useId, useRef } from "react"
import { requireNativeModule } from "expo"

import {
  openAndroidResumeChoice,
  type AndroidResumeChoiceModule,
} from "./androidResumeChoiceSession"

export function AndroidResumeChoice({
  resumeLabel,
  onResume,
  onStartOver,
  onClose,
}: {
  resumeLabel: string
  onResume: () => void
  onStartOver: () => void
  onClose: () => void
}) {
  const requestId = useId()
  const callbacks = useRef({ onResume, onStartOver, onClose })
  callbacks.current = { onResume, onStartOver, onClose }
  useEffect(
    () =>
      openAndroidResumeChoice(
        requireNativeModule<AndroidResumeChoiceModule>("NativeAndroidPlayer"),
        requestId,
        resumeLabel,
        {
          onResume: () => callbacks.current.onResume(),
          onStartOver: () => callbacks.current.onStartOver(),
          onClose: () => callbacks.current.onClose(),
        },
      ),
    [requestId, resumeLabel],
  )
  return null
}
