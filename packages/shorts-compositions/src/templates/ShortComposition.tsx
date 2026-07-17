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

  // Exhaustive over the schema's templateId enum — adding a template id to
  // schema.ts fails compilation here instead of silently falling through.
  switch (props.templateId) {
    case "frame":
      return <Frame {...props} />
    case "focus":
      return <Focus {...props} />
    default: {
      const exhausted: never = props.templateId
      throw new Error(`Unknown shorts template id: ${String(exhausted)}`)
    }
  }
}
