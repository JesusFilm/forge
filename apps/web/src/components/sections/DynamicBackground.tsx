"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { CONTENT_WIDTH_ALIGN_CLASSES } from "@/lib/content-width"

const BASE_PATH = "/watch"

const DynamicBgContext = createContext<
  ((url: string | null) => void) | undefined
>(undefined)

export function useDynamicBackground() {
  return useContext(DynamicBgContext)
}

export function DynamicBackground({
  bgClass,
  children,
}: {
  bgClass: string
  children: ReactNode
}) {
  const [activeImage, setActiveImage] = useState<string | null>(null)

  return (
    <DynamicBgContext.Provider value={setActiveImage}>
      <div
        className={cn(
          `relative ${CONTENT_WIDTH_ALIGN_CLASSES} overflow-hidden py-16 backdrop-blur-2xl`,
          bgClass,
        )}
      >
        <div
          className={cn(
            "absolute inset-0 z-0 bg-cover bg-center bg-no-repeat mix-blend-overlay blur-lg transition-opacity duration-500 ease-in-out",
            activeImage ? "opacity-30" : "opacity-0",
          )}
          aria-hidden="true"
          style={
            activeImage
              ? { backgroundImage: `url("${BASE_PATH}${activeImage}")` }
              : undefined
          }
        />

        <div
          className="absolute inset-0 z-1 bg-repeat mix-blend-multiply"
          style={{
            backgroundImage: `url("${BASE_PATH}/assets/overlay.svg")`,
          }}
          aria-hidden="true"
        />

        <div className="relative z-2">{children}</div>
      </div>
    </DynamicBgContext.Provider>
  )
}
