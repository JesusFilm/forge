import {
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import { VideoView, type VideoContentFit, type VideoPlayer } from "expo-video"

export type FeedVideoViewProps = {
  /** One of the two players from `useFeedPlayers`. */
  player: VideoPlayer
  /** The caller owns the framing. */
  contentFit: VideoContentFit
  style?: StyleProp<ViewStyle>
}

/**
 * The one component that draws a feed player (KTD2), so the video-view guards
 * have one file to name. It spreads no picture-in-picture prop: a clip never
 * enters the OS window (R3).
 */
export function FeedVideoView({
  player,
  contentFit,
  style,
}: FeedVideoViewProps) {
  return (
    <VideoView
      player={player}
      style={style ?? StyleSheet.absoluteFill}
      nativeControls={false}
      // iOS 16+ defaults this on, which floats a Live Text button over a
      // paused frame that shows text.
      allowsVideoFrameAnalysis={false}
      contentFit={contentFit}
      // A SurfaceView draws outside the RN hierarchy on Android, so the
      // overlay and captions would not render above the clip.
      surfaceType={Platform.OS === "android" ? "textureView" : undefined}
    />
  )
}
