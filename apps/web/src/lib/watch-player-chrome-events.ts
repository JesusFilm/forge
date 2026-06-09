export const WATCH_PLAYER_CHROME_VISIBILITY_EVENT =
  "watch-player-chrome-visibility-change"

export type WatchPlayerChromeVisibilityDetail = {
  visible: boolean
  opacity?: number
}

export const WATCH_PLAYER_CHROME_REVEAL_EVENT = "watch-player-chrome-reveal"

export const WATCH_PLAYER_PLAYBACK_STATE_EVENT =
  "watch-player-playback-state-change"

export type WatchPlayerPlaybackStateDetail = {
  playing: boolean
  muted: boolean
  preview?: boolean
}

export const WATCH_HEADER_LANGUAGE_SWITCHER_EVENT =
  "watch-header-language-switcher-change"

export type WatchHeaderLanguageSwitcherDetail = {
  visible: boolean
  onClick: (() => void) | null
}
