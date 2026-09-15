import type { ComponentType } from "react"
import type { NativeSyntheticEvent, ViewProps } from "react-native"
import { requireNativeView } from "expo"

export type NativeAndroidPlayerOption = {
  id: string
  label: string
  detail: string
  url: string
  disabled?: boolean
  searchText?: string
}

export type NativeAndroidPlayerMoment = {
  id: string
  label: string
  detail: string
  startSeconds: number
}

type SelectionEvent = NativeSyntheticEvent<{ id: string | null }>
type PositionEvent = NativeSyntheticEvent<{
  positionSeconds: number
  durationSeconds: number
}>
type ErrorEvent = NativeSyntheticEvent<{ message: string }>
type PlayNextEvent = NativeSyntheticEvent<{ slug: string }>

export type NativeAndroidPlayerViewProps = ViewProps & {
  sourceUrl: string
  storyboardUrl?: string
  title?: string
  subtitle?: string
  startAtSeconds?: number
  screenReaderEnabled?: boolean
  reduceMotion?: boolean
  foreground?: boolean
  menuAvailable?: boolean
  subtitleStatus?: string
  exploreStatus?: string
  currentMomentText?: string
  summaries?: string[]
  audioOptions: NativeAndroidPlayerOption[]
  selectedAudioId?: string
  subtitleOptions: NativeAndroidPlayerOption[]
  selectedSubtitleId?: string
  selectedSubtitleUrl?: string
  moments: NativeAndroidPlayerMoment[]
  questions: string[]
  upNextSlug?: string
  upNextTitle?: string
  onDismiss: () => void
  onEnded: () => void
  onPlayNext: (event: PlayNextEvent) => void
  onPlaybackPosition: (event: PositionEvent) => void
  onError: (event: ErrorEvent) => void
  onAudioChange: (event: SelectionEvent) => void
  onSubtitleChange: (event: SelectionEvent) => void
  onMenuChange?: (
    event: NativeSyntheticEvent<{ section: string | null }>,
  ) => void
  onFirstFrame?: () => void
  onRebuffer?: () => void
}

export const NativeAndroidPlayerView =
  requireNativeView<NativeAndroidPlayerViewProps>(
    "NativeAndroidPlayer",
  ) as ComponentType<NativeAndroidPlayerViewProps>
