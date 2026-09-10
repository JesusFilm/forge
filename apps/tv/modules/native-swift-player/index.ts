import type { ComponentType } from "react"
import type { NativeSyntheticEvent, ViewProps } from "react-native"
import { requireNativeView } from "expo"

export type NativePlayerOption = {
  id: string
  label: string
  detail: string
  url: string
}

export type NativePlayerMoment = {
  id: string
  label: string
  detail: string
  startSeconds: number
}

type IdEvent = NativeSyntheticEvent<{ id: string | null }>
type PositionEvent = NativeSyntheticEvent<{
  positionSeconds: number
  durationSeconds: number
}>
type ErrorEvent = NativeSyntheticEvent<{ message: string }>
type PlayNextEvent = NativeSyntheticEvent<{ slug: string }>

export type NativeSwiftPlayerViewProps = ViewProps & {
  sourceUrl: string
  playerVariant: "native-a" | "native-b"
  storyboardUrl?: string
  title?: string
  startAtSeconds?: number
  audioOptions: NativePlayerOption[]
  selectedAudioId?: string
  subtitleOptions: NativePlayerOption[]
  selectedSubtitleId?: string
  selectedSubtitleUrl?: string
  moments: NativePlayerMoment[]
  questions: string[]
  upNextSlug?: string
  upNextTitle?: string
  onDismiss: () => void
  onEnded: () => void
  onPlayNext: (event: PlayNextEvent) => void
  onPlaybackPosition: (event: PositionEvent) => void
  onError: (event: ErrorEvent) => void
  onAudioChange: (event: IdEvent) => void
  onSubtitleChange: (event: IdEvent) => void
}

export const NativeSwiftPlayerView =
  requireNativeView<NativeSwiftPlayerViewProps>(
    "NativeSwiftPlayer",
  ) as ComponentType<NativeSwiftPlayerViewProps>
