"use client"

import { useEffect, useRef, useState } from "react"
import {
  BadgeCheck,
  Bot,
  ChevronDown,
  Circle,
  Clapperboard,
  Film,
  LibraryBig,
  ListFilter,
  ListVideo,
  SquarePlay,
  Tags,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { CoverageStatus } from "./coverage-report-model"

export type FilterDropdownOption = {
  value: string
  label: string
}

function FilterDropdownOptionIcon({
  className,
  option,
}: {
  className?: string
  option: FilterDropdownOption
}) {
  const label = option.label.toLowerCase()
  const normalizedValue = option.value.toLowerCase()

  if (label === "media type") {
    return <ListFilter className={className} aria-hidden="true" />
  }
  if (label === "origin") {
    return <Tags className={className} aria-hidden="true" />
  }
  if (label === "collection") {
    return <LibraryBig className={className} aria-hidden="true" />
  }
  if (label === "feature film") {
    return <Film className={className} aria-hidden="true" />
  }
  if (label === "series") {
    return <ListVideo className={className} aria-hidden="true" />
  }
  if (label === "short film") {
    return <Clapperboard className={className} aria-hidden="true" />
  }
  if (label === "standalone") {
    return <SquarePlay className={className} aria-hidden="true" />
  }
  if (normalizedValue === "human") {
    return <BadgeCheck className={className} aria-hidden="true" />
  }
  if (normalizedValue === "ai") {
    return <Bot className={className} aria-hidden="true" />
  }
  if (normalizedValue === "none") {
    return <Circle className={className} aria-hidden="true" />
  }

  return <Tags className={className} aria-hidden="true" />
}

export function CoverageFilterDropdown({
  value,
  onChange,
  labels,
  options: customOptions,
}: {
  value: string
  onChange: (value: string) => void
  labels?: Record<CoverageStatus, string>
  options?: FilterDropdownOption[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const shellRef = useRef<HTMLSpanElement | null>(null)

  const options: FilterDropdownOption[] = customOptions ?? [
    { value: "all", label: "Origin" },
    { value: "human", label: labels?.human ?? "Verified" },
    { value: "ai", label: labels?.ai ?? "AI" },
    { value: "none", label: labels?.none ?? "None" },
  ]

  const currentLabel = options.find((o) => o.value === value)?.label ?? "Origin"
  const defaultValue = options[0]?.value ?? "all"
  const isActive = value !== defaultValue
  const currentOption = { value, label: currentLabel }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false)
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (
        shellRef.current &&
        !shellRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  return (
    <span className="relative w-auto shrink-0" ref={shellRef}>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className={cn(
          "h-10 w-[7.5rem] max-w-full cursor-pointer select-none justify-between gap-1 rounded-xl border-[color:color-mix(in_srgb,var(--ds-black)_14%,transparent)] bg-transparent px-2 text-sm font-medium text-[color:var(--ds-muted)] shadow-none ring-0 transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_6%,transparent)] active:bg-[color:color-mix(in_srgb,var(--ds-black)_10%,transparent)] focus-visible:border-[color:var(--ds-black)] focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)] sm:w-[10.5rem] sm:gap-2 sm:px-3",
          (isOpen || isActive) &&
            "border-[color:var(--ds-black)] bg-[color:color-mix(in_srgb,var(--ds-black)_3%,transparent)] ring-[0.5px] ring-[color:var(--ds-black)]",
          isActive && "text-[color:var(--ds-ink)]",
        )}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-pressed={isActive}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <FilterDropdownOptionIcon
            className="size-4 shrink-0 text-[color:var(--ds-muted)]"
            option={currentOption}
          />
          <span className="truncate text-left">{currentLabel}</span>
        </span>
        <ChevronDown
          className="size-4 text-[color:var(--ds-muted)] sm:size-5"
          aria-hidden="true"
        />
      </Button>
      {isOpen ? (
        <div
          className="absolute left-0 right-0 top-full z-[70] mt-1.5 flex flex-col gap-1 rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-1 shadow-[0_12px_30px_rgba(8,8,8,0.12)] sm:left-auto sm:min-w-full"
          role="listbox"
          aria-label="Coverage filter"
        >
          {options.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant="ghost"
              size="lg"
              className={cn(
                "h-9 justify-start gap-2 rounded-lg px-3 text-sm font-medium text-[color:var(--ds-ink)] transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_6%,transparent)]",
                option.value === value &&
                  "bg-[color:var(--ds-hover)] font-medium text-[color:var(--ds-black)]",
              )}
              onClick={() => {
                onChange(option.value)
                setIsOpen(false)
              }}
              role="option"
              aria-selected={option.value === value}
            >
              <FilterDropdownOptionIcon
                className="size-4 shrink-0 text-[color:var(--ds-muted)]"
                option={option}
              />
              <span className="min-w-0 truncate">{option.label}</span>
            </Button>
          ))}
        </div>
      ) : null}
    </span>
  )
}
