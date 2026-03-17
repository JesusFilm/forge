// Mux service — video asset management and streaming.
// Docs: https://docs.mux.com

import Mux from "@mux/mux-node"
import { env } from "@/config/env"

export const mux = new Mux({
  tokenId: env.MUX_TOKEN_ID,
  tokenSecret: env.MUX_TOKEN_SECRET,
})

export type CreateAssetOptions = {
  inputUrl: string
  passthrough?: string
}

export async function createMuxAsset(options: CreateAssetOptions) {
  return mux.video.assets.create({
    input: [{ url: options.inputUrl }],
    playback_policy: ["public"],
    passthrough: options.passthrough,
  })
}
