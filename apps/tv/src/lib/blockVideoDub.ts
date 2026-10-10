type BlockVideoDub = {
  hls?: string | null
  dash?: string | null
  share?: string | null
  muxVideo?: { playbackId?: string | null } | null
}

export function blockStreamingUrl(block: {
  videoDub?: BlockVideoDub | null
  streamingUrl?: string | null
}): string | null {
  return (
    block.videoDub?.hls ??
    block.videoDub?.dash ??
    block.videoDub?.share ??
    block.streamingUrl ??
    null
  )
}

export function blockMuxPlaybackId(block: {
  videoDub?: BlockVideoDub | null
}): string | null {
  return block.videoDub?.muxVideo?.playbackId ?? null
}
