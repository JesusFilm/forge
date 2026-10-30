import { useEffect, useId, useMemo, useRef } from "react"
import { requireNativeModule } from "expo"

import {
  openAndroidTrackChoice,
  type AndroidTrackChoiceModule,
  type TrackChoiceOption,
} from "./androidTrackChoiceSession"

export type NativeTrackChoiceProps = {
  title: string
  options: TrackChoiceOption[]
  selected: string | null
  status?: string | null
  onSelect: (id: string) => void | false
  onClose: () => void
}

/** Both platform bridges implement the same request-scoped picker contract. */
export function NativeTrackChoice({
  nativeModuleName,
  ...props
}: NativeTrackChoiceProps & {
  nativeModuleName: "NativeAndroidPlayer" | "NativeSwiftPlayer"
}) {
  const id = useId()
  const session = useRef<ReturnType<typeof openAndroidTrackChoice> | null>(null)
  const latest = useRef(props)
  latest.current = props
  const native = useMemo(
    () => requireNativeModule<AndroidTrackChoiceModule>(nativeModuleName),
    [nativeModuleName],
  )
  const { title, options, selected, status } = props
  useEffect(() => {
    const opened = openAndroidTrackChoice(
      native,
      id,
      title,
      latest.current.options,
      latest.current.selected,
      latest.current.status ?? null,
      (choice) => latest.current.onSelect(choice),
      () => latest.current.onClose(),
    )
    session.current = opened
    return () => {
      opened.dispose()
      if (session.current === opened) session.current = null
    }
  }, [native, id, title])
  useEffect(() => {
    session.current?.update(options, selected, status ?? null)
  }, [options, selected, status])
  return null
}
