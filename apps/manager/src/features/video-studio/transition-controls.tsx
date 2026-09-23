"use client"
import type {
  StudioDocument,
  StudioTimelineItem,
} from "@forge/studio-contracts"
import { studioCuts } from "@forge/studio-contracts/transitions"
import { NumberField } from "./number-field"

type VideoItem = Extract<StudioTimelineItem, { kind: "video" }>
export function TransitionControls({
  item,
  document,
  onChange,
}: {
  item: VideoItem
  document: StudioDocument
  onChange: (transition: VideoItem["transition"]) => void
}) {
  const cut = studioCuts(document).find((c) => c.incomingId === item.id)
  return (
    <>
      <h3>Transition from previous clip</h3>
      <label>
        Video transition
        <select
          value={item.transition?.type ?? "none"}
          onChange={(e) => {
            const type = e.target.value
            if (type === "none") onChange(undefined)
            else if (type === "crossfade" || type === "fade-black")
              onChange({
                type,
                durationInFrames:
                  item.transition?.durationInFrames ??
                  Math.round(document.fps / 3),
              })
          }}
        >
          <option value="none">None</option>
          <option value="crossfade">Crossfade</option>
          <option value="fade-black">Fade through black</option>
        </select>
      </label>
      {item.transition && (
        <>
          <NumberField
            label="Transition duration (frames)"
            value={item.transition.durationInFrames}
            min={1}
            max={300}
            onChange={(durationInFrames) =>
              onChange({ type: item.transition!.type, durationInFrames })
            }
          />
          <p className="nle-muted">
            {cut
              ? cut.type === "crossfade"
                ? `${cut.frames} frames before the cut, using earlier footage from this source. Clip and audio timing stay fixed.`
                : `${cut.frames} frames fading out and ${cut.frames} fading in. Audio timing stays fixed.`
              : "Inactive: place this clip directly after one video on the same track. Crossfade also needs footage before this clip’s source-in; use Fade through black when none is available."}
          </p>
        </>
      )}
    </>
  )
}
