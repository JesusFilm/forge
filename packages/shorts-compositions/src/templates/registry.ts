import type { ShortDraft, ShortTemplateId } from "../schema"

// Per-template default knobs applied when an operator picks a template.
export type ShortTemplateDefaults = Pick<
  ShortDraft,
  | "accentColor"
  | "captionPosition"
  | "captionFont"
  | "waveformStyle"
  | "showCaptions"
>

export type ShortTemplateDefinition = {
  id: ShortTemplateId
  label: string
  description: string
  defaults: ShortTemplateDefaults
}

export const SHORT_TEMPLATES: readonly ShortTemplateDefinition[] = [
  {
    id: "focus",
    label: "Focus",
    description:
      "Source video center-cropped to fill 9:16. Captions animate in the center band; waveform sits above the bottom safe margin.",
    defaults: {
      accentColor: "#f97316",
      captionPosition: "center",
      captionFont: "montserrat",
      waveformStyle: "bars",
      showCaptions: true,
    },
  },
  {
    id: "frame",
    label: "Frame",
    description:
      "Source video letterboxed at its native aspect over a blurred copy of itself. Optional title on top; captions below the video.",
    defaults: {
      accentColor: "#f97316",
      captionPosition: "lower",
      captionFont: "montserrat",
      waveformStyle: "bars",
      showCaptions: true,
    },
  },
]
