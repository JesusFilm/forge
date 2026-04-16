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

function ReportIcon({
  icon: Icon,
  value,
}: {
  icon: LucideIcon
  value: ReportOption["value"]
}) {
  return (
    <span className={`design-system-report-icon is-${value}`}>
      <Icon size={18} aria-hidden="true" strokeWidth={2} />
    </span>
  )
}

export function DesignSystemReportSwitcher() {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedReport, setSelectedReport] = useState<ReportOption>(
    reportOptions[0],
  )
  const shellRef = useRef<HTMLDivElement | null>(null)
  const SelectedIcon = selectedReport.icon

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
    <div
      className={`design-system-report-switch${isOpen ? " is-open" : ""}`}
      ref={shellRef}
    >
      <button
        type="button"
        className="design-system-workspace-button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Current report: ${selectedReport.label}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="design-system-avatar design-system-avatar--report">
          <ReportIcon icon={SelectedIcon} value={selectedReport.value} />
        </span>
        <span className="design-system-workspace-copy">
          <strong>{selectedReport.label}</strong>
          <small>{selectedReport.subtitle}</small>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>

      {isOpen ? (
        <div
          className="design-system-report-switch-menu"
          role="listbox"
          aria-label="Report selector"
        >
          {reportOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`design-system-report-switch-option${
                option.value === selectedReport.value ? " is-selected" : ""
              }`}
              role="option"
              aria-selected={option.value === selectedReport.value}
              onClick={() => {
                setSelectedReport(option)
                setIsOpen(false)
              }}
            >
              <ReportIcon icon={option.icon} value={option.value} />
              <span className="design-system-report-switch-copy">
                <strong>{option.label}</strong>
                <small>{option.subtitle}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
