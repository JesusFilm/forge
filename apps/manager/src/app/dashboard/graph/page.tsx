import type { Metadata } from "next"
import { GraphScreen } from "@/features/graph/graph-screen"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Graph -- Forge Manager",
}

export default function GraphPage() {
  return <GraphScreen />
}
