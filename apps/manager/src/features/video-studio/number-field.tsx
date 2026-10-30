"use client"
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type PointerEvent,
} from "react"

export function NumberField({
  label,
  hideLabel = false,
  unit,
  value,
  onChange,
  onPreview,
  min,
  max,
  step = 1,
  decimalPlaces,
}: {
  label: string
  hideLabel?: boolean
  unit?: string
  value: number
  onChange: (n: number) => void
  /** Temporary scrub value; null restores the committed document. */
  onPreview?: (n: number | null) => void
  min?: number
  max?: number
  step?: number
  decimalPlaces?: number
}) {
  function format(n: number) {
    return decimalPlaces === undefined
      ? String(n)
      : String(Number(n.toFixed(decimalPlaces)))
  }
  const displayValue = format(value)
  const input = useRef<HTMLInputElement>(null)
  const preview = useRef(onPreview)
  useLayoutEffect(() => {
    preview.current = onPreview
  }, [onPreview])
  const frame = useRef<number | null>(null)
  const drag = useRef<{
    pointerId: number
    x: number
    lastX: number
    shift: boolean
    start: number
    next: number
    original: string
  } | null>(null)
  function clearPreview() {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    preview.current?.(null)
  }
  function cancel() {
    if (!drag.current) return
    if (input.current) input.current.value = drag.current.original
    drag.current = null
    clearPreview()
  }
  const cancelGesture = useEffectEvent(() => cancel())
  useEffect(() => {
    const blur = () => cancelGesture()
    window.addEventListener("blur", blur)
    return () => {
      window.removeEventListener("blur", blur)
      cancelGesture()
    }
  }, [])
  const scrub = {
    title: "Drag left or right to adjust",
    onPointerDown(event: PointerEvent<HTMLSpanElement>) {
      if (
        event.button !== 0 ||
        !input.current ||
        input.current.matches(":disabled")
      )
        return
      event.preventDefault()
      const current = Number(input.current.value)
      const start =
        input.current.value === displayValue || !Number.isFinite(current)
          ? value
          : current
      drag.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        lastX: event.clientX,
        shift: event.shiftKey,
        start,
        next: start,
        original: input.current.value,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove(event: PointerEvent<HTMLSpanElement>) {
      const current = drag.current
      if (!current || current.pointerId !== event.pointerId || !input.current)
        return
      if (current.shift !== event.shiftKey) {
        current.start = current.next
        current.x = current.lastX
        current.shift = event.shiftKey
      }
      current.lastX = event.clientX
      const increments = Math.trunc((event.clientX - current.x) / 4)
      const next =
        increments === 0
          ? current.start
          : Number(
              (
                current.start +
                increments * step * (current.shift ? 10 : 1)
              ).toFixed(10),
            )
      current.next = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next))
      input.current.value = format(current.next)
      if (preview.current && frame.current === null)
        frame.current = requestAnimationFrame(() => {
          frame.current = null
          if (drag.current) preview.current?.(drag.current.next)
        })
    },
    onPointerUp(event: PointerEvent<HTMLSpanElement>) {
      const current = drag.current
      if (!current || current.pointerId !== event.pointerId) return
      drag.current = null
      clearPreview()
      event.currentTarget.releasePointerCapture(event.pointerId)
      // Let the committed document restore rejected edits (for example an empty crop).
      if (input.current) input.current.value = displayValue
      if (current.next !== value) onChange(current.next)
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  }
  return (
    <label
      className={
        unit ? "nle-number-field nle-number-field--unit" : "nle-number-field"
      }
    >
      {hideLabel ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="nle-number-label" {...scrub}>
          {label}
        </span>
      )}
      <input
        ref={input}
        key={value}
        type="number"
        aria-label={label}
        defaultValue={displayValue}
        min={min}
        max={max}
        step={step}
        onBlur={(e) => {
          if (drag.current) return
          // Display rounding alone must never change the stored transform.
          if (e.target.value === displayValue) return
          const n = Number(e.target.value)
          if (decimalPlaces !== undefined) e.target.value = displayValue
          if (Number.isFinite(n) && n !== value) onChange(n)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
        }}
      />
      {unit && (
        <span className="nle-number-unit" aria-hidden="true" {...scrub}>
          {unit}
        </span>
      )}
    </label>
  )
}
