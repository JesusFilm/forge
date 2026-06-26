import { AppShell } from "@/components/shell/app-shell"
import { isSeekerChatEnabled } from "@/config/env"

// `force-dynamic` is load-bearing (feat-205, KTD1): without it Next.js folds the
// isSeekerChatEnabled() env read into the build-time prerender, so flipping
// SEEKER_CHAT_ENABLED on Railway wouldn't change the page until a rebuild.
export const dynamic = "force-dynamic"

export default function HomePage() {
  return <AppShell seekerEnabled={isSeekerChatEnabled()} />
}
