"use client"

import { useId, useRef, type KeyboardEvent } from "react"

/** English resource chrome: LTR, automatic activation, no I/O on selection.
 * Mirrors WatchRoleTabs' roving focus and shared host-owned panel pattern. */
export function useWatchResourceTabs<T extends string | null>(
  values: readonly T[],
  selected: T,
  select: (value: T) => void,
) {
  const id = useId()
  const buttons = useRef(new Map<T, HTMLButtonElement>())
  return {
    panelProps: {
      id: `${id}-panel`,
      role: "tabpanel",
      "aria-labelledby": `${id}-tab-${values.indexOf(selected)}`,
      tabIndex: 0,
    } as const,
    tabProps(value: T) {
      const index = values.indexOf(value)
      return {
        id: `${id}-tab-${index}`,
        role: "tab",
        "aria-controls": `${id}-panel`,
        "aria-selected": selected === value,
        tabIndex: selected === value ? 0 : -1,
        ref: (node: HTMLButtonElement | null) => {
          if (node) buttons.current.set(value, node)
          else buttons.current.delete(value)
        },
        onClick: () => select(value),
        onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
          const count = values.length
          const next =
            event.key === "ArrowRight"
              ? (index + 1) % count
              : event.key === "ArrowLeft"
                ? (index - 1 + count) % count
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? count - 1
                    : null
          if (next === null) return
          event.preventDefault()
          const value = values[next]!
          select(value)
          buttons.current.get(value)?.focus()
        },
      } as const
    },
  }
}
