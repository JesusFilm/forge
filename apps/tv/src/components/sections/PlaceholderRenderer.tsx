import type { NormalizedBlock } from "../../lib/normalizer"

export interface PlaceholderRendererProps {
  section: NormalizedBlock
}

/**
 * Fallback renderer for unimplemented block types.
 * Logs a warning in dev and renders nothing.
 */
export function PlaceholderRenderer({ section }: PlaceholderRendererProps) {
  if (__DEV__) {
    console.warn(`[TV] Unhandled block type: ${section.kind}`)
  }
  return null
}
