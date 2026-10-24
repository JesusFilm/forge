import { WatchNotFound } from "@/components/WatchNotFound"

export { generateMetadata } from "../../404/page"

export const dynamic = "force-dynamic"

export default function WatchRouteRecovery() {
  return <WatchNotFound />
}
