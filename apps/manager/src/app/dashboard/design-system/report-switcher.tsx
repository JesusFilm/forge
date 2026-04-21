"use client"

import type { LucideIcon } from "lucide-react"
import {
  Captions,
  ChevronDown,
  FileAudio2,
  FileJson2,
  Sparkles,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

const reportOptions = [
  {
    value: "subtitles",
    label: "Subtitles",
    subtitle: "Subtitle coverage for the selected language.",
    icon: Captions,
  },
  {
    value: "audio",
    label: "Audio",
    subtitle: "Audio coverage for the selected language.",
    icon: FileAudio2,
  },
  {
    value: "meta",
    label: "Meta",
    subtitle: "Metadata coverage for the selected language.",
    icon: FileJson2,
  },
  {
    value: "experiences",
    label: "Experiences",
    subtitle: "Experience coverage for the selected language.",
    icon: Sparkles,
  },
] as const

type ReportOption = (typeof reportOptions)[number]

function ReportIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon className="size-4 text-foreground" aria-hidden="true" />
}

export function DesignSystemReportSwitcher() {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedReport, setSelectedReport] = useState<ReportOption>(
    reportOptions[0],
  )
  const shellRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
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
    <div className="relative w-full" ref={shellRef}>
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-[1.25rem] border border-border bg-card px-4 py-3 text-left shadow-[0_10px_24px_rgba(8,8,8,0.05)] transition-colors hover:bg-accent"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Current report: ${selectedReport.label}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <ReportIcon icon={selectedReport.icon} />
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-[0.95rem] font-semibold tracking-[-0.02em] text-foreground">
            {selectedReport.label}
          </strong>
          <small className="mt-0.5 block truncate text-[0.84rem] leading-5 text-muted-foreground">
            {selectedReport.subtitle}
          </small>
        </span>
        <ChevronDown
          className={cn(
            "size-5 shrink-0 text-foreground transition-transform duration-200",
            isOpen && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {isOpen ? (
        <div
          className="absolute left-0 top-full z-20 mt-2.5 w-full overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-[0_24px_56px_rgba(8,8,8,0.12)]"
          role="listbox"
          aria-label="Report selector"
        >
          <div className="p-2">
            {reportOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "flex w-full items-start gap-3 rounded-[1rem] px-3.5 py-2.5 text-left transition-colors hover:bg-accent",
                  option.value === selectedReport.value && "bg-secondary",
                )}
                role="option"
                aria-selected={option.value === selectedReport.value}
                onClick={() => {
                  setSelectedReport(option)
                  setIsOpen(false)
                }}
              >
                <ReportIcon icon={option.icon} />
                <span className="min-w-0 flex-1">
                  <strong className="block text-[0.95rem] font-semibold tracking-[-0.02em] text-foreground">
                    {option.label}
                  </strong>
                  <small className="block text-[0.84rem] leading-5 text-muted-foreground">
                    {option.subtitle}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
