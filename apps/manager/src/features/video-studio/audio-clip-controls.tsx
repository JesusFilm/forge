"use client"
import { useRef, useState, type PointerEvent, type KeyboardEvent } from "react"
import { createPortal } from "react-dom"
import {
  audioDbLabel,
  audioDbToVolume,
  audioVolumeToDb,
  audioFadeSettings,
  audioFadeProgress,
  type StudioAudioItem,
} from "@forge/studio-contracts/audio"

type Settings = ReturnType<typeof audioFadeSettings>
type Draft = { volume: number; audioFade: Settings }
type Control =
  | "volume"
  | "fadeInFrames"
  | "fadeOutFrames"
  | "fadeInCurve"
  | "fadeOutCurve"
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))
function volumeY(volume: number) {
  return volume === 0
    ? 100
    : 2 + ((30 - clamp(audioVolumeToDb(volume), -60, 30)) / 90) * 96
}
function yVolume(y: number) {
  return y >= 100 ? 0 : audioDbToVolume(30 - clamp((y - 2) / 96, 0, 1) * 90)
}

export function AudioClipControls({
  item,
  fps,
  disabled,
  onChange,
  onGestureStart,
}: {
  item: StudioAudioItem
  fps: number
  disabled: boolean
  onChange: (audio: Draft) => void
  onGestureStart: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [gainPointer, setGainPointer] = useState<{
    x: number
    y: number
  } | null>(null)
  function showGain(event: PointerEvent<HTMLSpanElement>) {
    setGainPointer({
      x: clamp(event.clientX + 12, 8, Math.max(8, window.innerWidth - 88)),
      y: clamp(event.clientY + 14, 8, Math.max(8, window.innerHeight - 32)),
    })
  }
  const drag = useRef<{
    pointerId: number
    control: Control
    x: number
    y: number
    width: number
    height: number
    initial: Draft
    next: Draft
  } | null>(null)
  const original: Draft = {
    volume: item.volume,
    audioFade: audioFadeSettings(item),
  }
  const audio = draft ?? original
  const fade = audio.audioFade
  const length = Math.max(1, item.durationInFrames - 1)
  const level = volumeY(audio.volume)
  const endIn = (fade.fadeInFrames / length) * 100
  const startOut = (1 - fade.fadeOutFrames / length) * 100
  function cancel() {
    drag.current = null
    setDraft(null)
    setGainPointer(null)
  }
  function commit(next: Draft) {
    if (disabled || JSON.stringify(next) === JSON.stringify(original)) return
    onChange(next)
  }
  function handlers(control: Control) {
    return {
      onPointerDown(event: PointerEvent<HTMLSpanElement>) {
        event.stopPropagation()
        if (disabled || event.button !== 0 || !root.current) return
        event.preventDefault()
        onGestureStart()
        event.currentTarget.focus({ preventScroll: true })
        event.currentTarget.setPointerCapture(event.pointerId)
        const box = root.current.getBoundingClientRect()
        drag.current = {
          pointerId: event.pointerId,
          control,
          x: event.clientX,
          y: event.clientY,
          width: box.width,
          height: box.height,
          initial: original,
          next: original,
        }
        setDraft(original)
        if (control === "volume") showGain(event)
      },
      onPointerMove(event: PointerEvent<HTMLSpanElement>) {
        event.stopPropagation()
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) return
        const next = {
          volume: current.initial.volume,
          audioFade: { ...current.initial.audioFade },
        }
        if (control === "volume") {
          showGain(event)
          next.volume = yVolume(
            volumeY(current.initial.volume) +
              ((event.clientY - current.y) / current.height) * 100,
          )
        } else if (control === "fadeInFrames" || control === "fadeOutFrames") {
          const direction = control === "fadeInFrames" ? 1 : -1
          const other =
            control === "fadeInFrames" ? "fadeOutFrames" : "fadeInFrames"
          next.audioFade[control] = clamp(
            Math.round(
              current.initial.audioFade[control] +
                ((direction * (event.clientX - current.x)) / current.width) *
                  length,
            ),
            0,
            Math.max(0, item.durationInFrames - 1 - next.audioFade[other]),
          )
        } else {
          const position =
            control === "fadeInCurve"
              ? "fadeInCurvePosition"
              : "fadeOutCurvePosition"
          const frames =
            control === "fadeInCurve" ? "fadeInFrames" : "fadeOutFrames"
          const direction = control === "fadeInCurve" ? 1 : -1
          const fadeWidth =
            (current.width * current.initial.audioFade[frames]) / length
          next.audioFade[position] = clamp(
            current.initial.audioFade[position] +
              (direction * (event.clientX - current.x)) /
                Math.max(1, fadeWidth),
            0.05,
            0.95,
          )
          next.audioFade[control] = clamp(
            current.initial.audioFade[control] -
              ((event.clientY - current.y) / current.height) * 4,
            -1,
            1,
          )
        }
        current.next = next
        setDraft(next)
      },
      onPointerUp(event: PointerEvent<HTMLSpanElement>) {
        event.stopPropagation()
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) return
        drag.current = null
        setDraft(null)
        setGainPointer(null)
        event.currentTarget.releasePointerCapture(event.pointerId)
        commit(current.next)
      },
      onPointerCancel(event: PointerEvent<HTMLSpanElement>) {
        event.stopPropagation()
        cancel()
      },
      onLostPointerCapture() {
        if (drag.current) cancel()
      },
      onClick(event: React.MouseEvent) {
        event.stopPropagation()
      },
      onDoubleClick(event: React.MouseEvent) {
        event.stopPropagation()
        if (disabled) return
        onGestureStart()
        commit(
          control === "volume"
            ? { ...original, volume: 1 }
            : {
                ...original,
                audioFade: {
                  ...original.audioFade,
                  [control]: 0,
                  ...(control === "fadeInCurve"
                    ? { fadeInCurvePosition: 0.5 }
                    : control === "fadeOutCurve"
                      ? { fadeOutCurvePosition: 0.5 }
                      : {}),
                },
              },
        )
      },
      onKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
        event.stopPropagation()
        if (disabled) return
        const direction =
          event.key === "ArrowRight" || event.key === "ArrowUp"
            ? 1
            : event.key === "ArrowLeft" || event.key === "ArrowDown"
              ? -1
              : 0
        if (!direction && event.key !== "Home" && event.key !== "End") return
        event.preventDefault()
        const next = {
          volume: original.volume,
          audioFade: { ...original.audioFade },
        }
        if (control === "volume") {
          const db = audioVolumeToDb(next.volume)
          const value =
            event.key === "Home"
              ? -Infinity
              : event.key === "End"
                ? 30
                : (db === -Infinity ? -61 : db) +
                  direction * (event.shiftKey ? 3 : 1)
          next.volume = audioDbToVolume(value < -60 ? -Infinity : value)
        } else {
          const curve = control.endsWith("Curve")
          const other =
            control === "fadeInFrames" ? "fadeOutFrames" : "fadeInFrames"
          const max = curve
            ? 1
            : Math.max(0, item.durationInFrames - 1 - next.audioFade[other])
          if (
            curve &&
            (event.key === "ArrowLeft" || event.key === "ArrowRight")
          ) {
            const position =
              control === "fadeInCurve"
                ? "fadeInCurvePosition"
                : "fadeOutCurvePosition"
            next.audioFade[position] = clamp(
              next.audioFade[position] +
                direction * (control === "fadeInCurve" ? 0.05 : -0.05),
              0.05,
              0.95,
            )
          } else
            next.audioFade[control] = clamp(
              event.key === "Home"
                ? curve
                  ? -1
                  : 0
                : event.key === "End"
                  ? max
                  : next.audioFade[control] +
                    direction * (curve ? 0.1 : event.shiftKey ? fps : 1),
              curve ? -1 : 0,
              max,
            )
        }
        onGestureStart()
        commit(next)
      },
    }
  }
  const points: [number, number][] = []
  const point = (x: number, strength: number) =>
    points.push([x * 10, 100 * (1 - strength)])
  if (fade.fadeInFrames) {
    for (let i = 0; i <= 24; i++)
      point(
        (endIn * i) / 24,
        audioFadeProgress(i / 24, fade.fadeInCurve, fade.fadeInCurvePosition),
      )
  } else point(0, 1)
  point(startOut, 1)
  if (fade.fadeOutFrames) {
    for (let i = 1; i <= 24; i++)
      point(
        startOut + ((100 - startOut) * i) / 24,
        audioFadeProgress(
          1 - i / 24,
          fade.fadeOutCurve,
          fade.fadeOutCurvePosition,
        ),
      )
  } else point(100, 1)
  const path = points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ")
  return (
    <div
      ref={root}
      className="nle-audio-controls"
      data-dragging={draft ? "true" : undefined}
    >
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
        <path className="nle-audio-fade-shade" d={`${path} L1000,0 L0,0 Z`} />
        <path
          className="nle-audio-envelope"
          d={path}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="nle-audio-volume"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Clip volume"
        aria-disabled={disabled}
        aria-orientation="vertical"
        aria-valuemin={-60}
        aria-valuemax={30}
        aria-valuenow={
          audio.volume ? clamp(audioVolumeToDb(audio.volume), -60, 30) : -60
        }
        aria-valuetext={audioDbLabel(audio.volume)}
        style={{ top: `${level}%` }}
        {...handlers("volume")}
      />
      {(["In", "Out"] as const).map((side) => {
        const frames = side === "In" ? "fadeInFrames" : "fadeOutFrames"
        const curve = side === "In" ? "fadeInCurve" : "fadeOutCurve"
        const end = side === "In" ? endIn : startOut
        const position =
          side === "In" ? fade.fadeInCurvePosition : fade.fadeOutCurvePosition
        const middle =
          side === "In" ? endIn * position : 100 - (100 - startOut) * position
        return (
          <span key={side}>
            <span
              className="nle-audio-fade-handle"
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-disabled={disabled}
              aria-label={`Fade ${side.toLowerCase()} length`}
              aria-valuemin={0}
              aria-valuemax={Math.max(
                0,
                item.durationInFrames -
                  1 -
                  fade[side === "In" ? "fadeOutFrames" : "fadeInFrames"],
              )}
              aria-valuenow={fade[frames]}
              aria-valuetext={`${(fade[frames] / fps).toFixed(2)} seconds`}
              style={{ left: `clamp(4px, ${end}%, calc(100% - 4px))` }}
              {...handlers(frames)}
            />
            {fade[frames] > 0 && (
              <span
                className="nle-audio-curve-handle"
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-disabled={disabled}
                aria-label={`Fade ${side.toLowerCase()} curve`}
                aria-valuemin={-1}
                aria-valuemax={1}
                aria-valuenow={fade[curve]}
                aria-valuetext={`Curve ${fade[curve].toFixed(2)}, position ${Math.round(position * 100)}%`}
                style={{
                  left: `${middle}%`,
                  top: `${100 * (1 - audioFadeProgress(position, fade[curve], position))}%`,
                }}
                {...handlers(curve)}
              />
            )}
          </span>
        )
      })}
      {gainPointer &&
        createPortal(
          <div
            className="nle-audio-gain-popover"
            role="tooltip"
            style={{ left: gainPointer.x, top: gainPointer.y }}
          >
            {audioDbLabel(audio.volume)}
          </div>,
          document.body,
        )}
    </div>
  )
}
