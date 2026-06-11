import { loadShortFonts } from "../fonts"
import type { ShortInputProps } from "../schema"
import { Focus } from "./Focus"
import { Frame } from "./Frame"

// Shared composition rendered by both the manager <Player> preview and the
// shorts-worker render — parity by construction.
export const ShortComposition = (props: ShortInputProps) => {
  // Single-flight font load using Remotion's delayRender pattern; renders
  // wait for the vendored fonts before painting text.
  void loadShortFonts()

  return props.templateId === "frame" ? (
    <Frame {...props} />
  ) : (
    <Focus {...props} />
  )
}
