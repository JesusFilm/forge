type BlockVideoDub = {
  hls?: string | null
  dash?: string | null
  share?: string | null
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
