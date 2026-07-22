import { adminGraphql } from "../../admin"

export const adminBlockVideoDubFragment = adminGraphql(`
  fragment AdminBlockVideoDub on VideoDub @_unmask {
    id
    videoId
    hls
    dash
    share
    duration
    lengthInMilliseconds
    language {
      id
      slug
      bcp47
    }
    muxVideo {
      playbackId
    }
  }
`)
