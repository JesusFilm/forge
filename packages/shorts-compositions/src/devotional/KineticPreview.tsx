import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion"
import { z } from "zod"

import { loadShortFonts } from "../fonts"
import { KineticCaption } from "./KineticCaption"
import { loadLiterata } from "./teaser-fonts"

/** Review-only: one opening line in each kinetic arrangement, on a still of
 *  the film. Rendered as stills by apps/shorts-worker/scripts/render-kinetic-preview.mjs. */
export const KINETIC_PREVIEW_ID = "devotional-kinetic-preview"

export const kineticPreviewSchema = z.object({
  bg: z.string(),
  line: z.string(),
  hero: z.string(),
  accents: z.array(z.string()),
  layout: z.enum(["stack", "staircase", "split"]),
  side: z.enum(["left", "right"]),
})

export const KineticPreview = (props: z.infer<typeof kineticPreviewSchema>) => {
  loadShortFonts()
  loadLiterata()
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const px = (n: number) => (n * Math.min(width, height)) / 360
  const dark =
    props.side === "left"
      ? "linear-gradient(90deg, rgba(0,0,0,0.55), rgba(0,0,0,0.12) 55%, rgba(0,0,0,0) 80%)"
      : "linear-gradient(270deg, rgba(0,0,0,0.55), rgba(0,0,0,0.12) 55%, rgba(0,0,0,0) 80%)"
  return (
    <AbsoluteFill style={{ background: "#0c0805" }}>
      <Img
        src={staticFile(props.bg)}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <AbsoluteFill
        style={{
          background: props.layout === "split" ? "rgba(0,0,0,0.28)" : dark,
        }}
      />
      <KineticCaption
        line={props.line}
        hero={props.hero}
        accents={props.accents}
        time={frame / fps}
        layout={props.layout}
        px={px}
        side={props.side}
      />
    </AbsoluteFill>
  )
}
