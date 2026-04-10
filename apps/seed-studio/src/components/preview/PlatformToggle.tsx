"use client"

import { Monitor, Smartphone } from "lucide-react"

import { cn } from "@/lib/cn"

type PlatformToggleProps = {
  platform: "web" | "mobile"
  onChange: (p: "web" | "mobile") => void
}

export function PlatformToggle({ platform, onChange }: PlatformToggleProps) {
  return (
    <div className="inline-flex gap-1 rounded-lg bg-neutral-100 p-1">
      <button
        type="button"
        onClick={() => onChange("web")}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5",
          "text-sm font-medium transition-colors",
          platform === "web"
            ? "bg-primary-500 text-white shadow-sm"
            : "text-neutral-500 hover:text-neutral-700",
        )}
      >
        <Monitor className="h-4 w-4" />
        Web
      </button>
      <button
        type="button"
        onClick={() => onChange("mobile")}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5",
          "text-sm font-medium transition-colors",
          platform === "mobile"
            ? "bg-primary-500 text-white shadow-sm"
            : "text-neutral-500 hover:text-neutral-700",
        )}
      >
        <Smartphone className="h-4 w-4" />
        Mobile
      </button>
    </div>
  )
}
