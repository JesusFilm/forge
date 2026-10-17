import { notFound } from "next/navigation"
import { NextIntlClientProvider } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import messages from "../../../../../messages/en.json"
import { RecommendationTrafficFixture } from "./fixture-client"

export const metadata = {
  title: "Recommendation traffic test fixture",
  robots: { index: false, follow: false },
}

export default async function RecommendationTrafficBrowserFixture({
  searchParams,
}: {
  searchParams: Promise<{ surface?: string }>
}) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.PLAYWRIGHT_TEST !== "1"
  )
    notFound()
  setRequestLocale("en")
  const { surface } = await searchParams
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <RecommendationTrafficFixture
        surface={surface === "for-you" ? "for-you" : "seeded"}
      />
    </NextIntlClientProvider>
  )
}
