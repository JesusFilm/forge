import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { setRequestLocale } from "next-intl/server"

import { WatchHistoryClient } from "@/components/watch/WatchHistoryClient"
import { verifyAuthSession } from "@/lib/auth-session"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Watch History | Jesus Film Project",
}

type HistoryPageProps = {
  params: Promise<{ locale: string }>
}

export default async function WatchHistoryPage({ params }: HistoryPageProps) {
  const { locale } = await params
  setRequestLocale(locale)

  const session = await verifyAuthSession(await headers())
  if (!session.authenticated) {
    redirect("/api/auth/login?returnTo=/watch/history")
  }

  return (
    <main className="min-h-screen bg-[#050505] pt-24 text-white">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">
          Watch History
        </h1>
        <WatchHistoryClient />
      </div>
    </main>
  )
}
