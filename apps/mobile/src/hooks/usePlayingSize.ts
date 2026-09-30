import { useEffect, useState } from "react"
import type { VideoPlayer } from "expo-video"

/** The size of the track the player shows, or null until one loads. */
export function usePlayingSize(player: VideoPlayer) {
  const [size, setSize] = useState(() => player.videoTrack?.size ?? null)
  useEffect(() => {
    setSize(player.videoTrack?.size ?? null)
    const sub = player.addListener("videoTrackChange", ({ videoTrack }) => {
      setSize(videoTrack?.size ?? null)
    })
    return () => sub.remove()
  }, [player])
  return size
}
