import { useEffect, useRef, useState } from "react"
import { AppState } from "react-native"
import { Image } from "expo-image"
import { useReduceMotion } from "../hooks/useReduceMotion"
import { scale } from "../lib/scale"
import type { LogoAnimationId } from "../lib/logoAnimations"

/* eslint-disable @typescript-eslint/no-require-imports */
const sources: Record<LogoAnimationId, number> = {
  "01": require("../../assets/logo-motion/01.webp"),
  "02": require("../../assets/logo-motion/02.webp"),
  "03": require("../../assets/logo-motion/03.webp"),
  "04": require("../../assets/logo-motion/04.webp"),
  "05": require("../../assets/logo-motion/05.webp"),
  "06": require("../../assets/logo-motion/06.webp"),
  "07": require("../../assets/logo-motion/07.webp"),
  "08": require("../../assets/logo-motion/08.webp"),
  "09": require("../../assets/logo-motion/09.webp"),
  "10": require("../../assets/logo-motion/10.webp"),
}
const still = require("../../assets/logo-motion/static.png")
/* eslint-enable @typescript-eslint/no-require-imports */

export function LogoAnimation({
  id,
  active = true,
  startup = false,
  size = 600,
}: {
  id: LogoAnimationId
  active?: boolean
  startup?: boolean
  size?: number
}) {
  const reduceMotion = useReduceMotion()
  const [foreground, setForeground] = useState(
    AppState.currentState !== "background",
  )
  const imageRef = useRef<Image>(null)
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) =>
      setForeground(next !== "background"),
    )
    return () => subscription.remove()
  }, [])
  useEffect(() => {
    if (!startup || id !== "09" || !active || !foreground || reduceMotion)
      return
    const timer = setTimeout(() => {
      void imageRef.current?.stopAnimating()
    }, 4400)
    return () => clearTimeout(timer)
  }, [id, startup, active, foreground, reduceMotion])
  const animate = active && foreground && !reduceMotion
  return (
    <Image
      ref={imageRef}
      key={`${id}-${animate}`}
      source={animate ? sources[id] : still}
      style={{
        width: scale(size),
        height: scale((size * 2) / 3),
        flexShrink: 0,
        opacity: startup && !active ? 0 : 1,
      }}
      contentFit="contain"
      autoplay={animate}
      cachePolicy="none"
      accessible={false}
    />
  )
}
