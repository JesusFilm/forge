"use client"
import type { StudioTimelineItem } from "@forge/studio-contracts"
import { NumberField } from "./number-field"

type TextItem = Extract<StudioTimelineItem, { kind: "text" }>
const families = ["sans-serif", "Inter", "Montserrat", "Apercu"]
const animations = ["none", "fade", "slide"] as const

export function TextControls({
  item,
  onChange,
}: {
  item: TextItem
  onChange: (properties: Partial<TextItem["properties"]>) => void
}) {
  const p = item.properties
  const family = p.fontFamily ?? "sans-serif"
  const weight = p.fontWeight ?? 500
  const weights =
    family === "Apercu"
      ? [400, 500, 700]
      : [100, 200, 300, 400, 500, 600, 700, 800, 900]
  return (
    <>
      <label>
        Font family
        <select
          value={family}
          onChange={(e) =>
            onChange({
              fontFamily: e.target.value,
              ...(e.target.value === "Apercu" &&
              ![400, 500, 700].includes(weight)
                ? { fontWeight: 500 }
                : {}),
            })
          }
        >
          {!families.includes(family) && (
            <option value={family}>{family} (existing)</option>
          )}
          {families.map((f) => (
            <option key={f} value={f}>
              {f === "sans-serif" ? "Default sans serif" : f}
            </option>
          ))}
        </select>
      </label>
      <label>
        Font weight
        <select
          value={weight}
          onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}
        >
          {!weights.includes(weight) && (
            <option value={weight}>{weight} (existing)</option>
          )}
          {weights.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>
      <h3>Readability</h3>
      <label>
        Text shadow
        <input
          type="checkbox"
          checked={p.shadow ?? false}
          onChange={(e) => onChange({ shadow: e.target.checked })}
        />
      </label>
      {p.shadow && (
        <>
          <NumberField
            label="Shadow blur"
            value={p.shadowBlur ?? 8}
            min={0}
            max={100}
            onChange={(shadowBlur) => onChange({ shadowBlur })}
          />
          <NumberField
            label="Shadow offset"
            value={p.shadowOffset ?? 3}
            min={0}
            max={100}
            onChange={(shadowOffset) => onChange({ shadowOffset })}
          />
        </>
      )}
      <NumberField
        label="Stroke width (0 = off)"
        value={p.strokeWidth ?? 0}
        min={0}
        max={20}
        step={0.5}
        onChange={(strokeWidth) => onChange({ strokeWidth })}
      />
      {!!p.strokeWidth && (
        <label>
          Stroke color
          <input
            type="color"
            value={p.strokeColor ?? "#000000"}
            onChange={(e) => onChange({ strokeColor: e.target.value })}
          />
        </label>
      )}
      <NumberField
        label="Scrim opacity (0 = off)"
        value={p.scrimOpacity ?? 0}
        min={0}
        max={1}
        step={0.05}
        onChange={(scrimOpacity) => onChange({ scrimOpacity })}
      />
      {!!p.scrimOpacity && (
        <NumberField
          label="Scrim padding"
          value={p.scrimPadding ?? 16}
          min={0}
          max={200}
          onChange={(scrimPadding) => onChange({ scrimPadding })}
        />
      )}
      <h3>Animation</h3>
      {(["entrance", "exit"] as const).map((key) => {
        const label = key === "entrance" ? "Entrance" : "Exit"
        const durationKey = key === "entrance" ? "entranceFrames" : "exitFrames"
        return (
          <div key={key}>
            <label>
              {label}
              <select
                value={p[key] ?? "none"}
                onChange={(e) => {
                  const value = animations.find(
                    (animation) => animation === e.target.value,
                  )
                  if (value) onChange({ [key]: value })
                }}
              >
                {animations.map((animation) => (
                  <option key={animation} value={animation}>
                    {animation === "none"
                      ? "None"
                      : animation === "fade"
                        ? "Fade"
                        : "Slide"}
                  </option>
                ))}
              </select>
            </label>
            {p[key] && p[key] !== "none" && (
              <NumberField
                label={`${label} duration (frames)`}
                value={p[durationKey] ?? 9}
                min={1}
                max={300}
                onChange={(value) => onChange({ [durationKey]: value })}
              />
            )}
          </div>
        )
      })}
      <p className="nle-muted">
        Animation durations are limited to half the card’s length.
      </p>
    </>
  )
}
