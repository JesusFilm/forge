"use client"

import { useState } from "react"

export function CopyBrainstormButton({
  filePath,
  size = "default",
}: {
  filePath: string
  size?: "default" | "small"
}) {
  const [copied, setCopied] = useState(false)
  const command = `/ce:brainstorm ${filePath}`

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    navigator.clipboard.writeText(command)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const icon = (
    <svg
      className={size === "small" ? "h-3 w-3" : "h-3.5 w-3.5"}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      {copied ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      ) : (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
        />
      )}
    </svg>
  )

  if (size === "small") {
    return (
      <button
        onClick={handleCopy}
        title={`Copy: ${command}`}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
      >
        {icon}
        {copied ? "Copied" : "brainstorm"}
      </button>
    )
  }

  return (
    <button
      onClick={handleCopy}
      title={`Copy: ${command}`}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
    >
      {icon}
      {copied ? "Copied!" : "brainstorm"}
    </button>
  )
}
