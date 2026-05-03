import type { Metadata } from "next"
import { DesignSystemKitchenSink } from "@/features/design-system/design-system-kitchen-sink"

export const metadata: Metadata = {
  title: "Design System Kitchen Sink -- Studio",
}

export default function DesignSystemKitchenSinkPage() {
  return <DesignSystemKitchenSink />
}
