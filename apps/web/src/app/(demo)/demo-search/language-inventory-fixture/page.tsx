import type { Route } from "next"
import { notFound } from "next/navigation"
import { NextIntlClientProvider } from "next-intl"
import { setRequestLocale } from "next-intl/server"

import { LanguageInventoryPage } from "@/components/watch-language-inventory/LanguageInventoryPage"
import {
  LANGUAGE_INVENTORY_CLIENT_MESSAGE_NAMESPACES,
  loadClientMessages,
} from "@/i18n/client-messages"
import type {
  WatchLanguageInventoryCard,
  WatchLanguageInventoryModel,
} from "@/lib/watch-language-inventory"

function inventoryCard(
  id: string,
  overrides: Partial<WatchLanguageInventoryCard> = {},
): WatchLanguageInventoryCard {
  return {
    id,
    coreId: id,
    slug: id,
    title: `Inventory browser fixture ${id}`,
    description: null,
    imageUrl: null,
    imageAlt: "",
    muxPlaybackId: null,
    label: "episode",
    availability: "AUDIO",
    href: `/${id}.html` as Route,
    watchLanguageSlug: "english",
    parentSlug: "fixture-series",
    parentTitle: "Long inventory fixture",
    parentOrder: null,
    durationSeconds: 420,
    childCount: 0,
    publishedAt: "2026-09-01",
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

function fixtureInventory(): WatchLanguageInventoryModel {
  const audioVideos = Array.from({ length: 140 }, (_, index) =>
    inventoryCard(`episode-${index + 1}`),
  )
  const subtitleTarget = inventoryCard("subtitle-target", {
    title: "Below-fold subtitle target",
    label: "shortFilm",
    availability: "SUBTITLE_ONLY",
    parentSlug: null,
    parentTitle: null,
    durationSeconds: 180,
  })

  return {
    languageSlug: "english",
    languageName: "English",
    languageNativeName: "English",
    switcherLanguages: [],
    counts: {
      audioCollections: 1,
      audioVideos: audioVideos.length,
      subtitleOnlyVideos: 1,
      total: audioVideos.length + 2,
    },
    promoted: [],
    audioCollections: [
      inventoryCard("fixture-series", {
        title: "Long inventory fixture",
        label: "collection",
        href: "/fixture-series.html" as Route,
        parentSlug: null,
        parentTitle: null,
        childCount: audioVideos.length,
      }),
    ],
    audioVideos,
    subtitleOnlyVideos: [subtitleTarget],
    collectionLanguageCounts: {},
  }
}

export default async function LanguageInventoryBrowserFixture() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.PLAYWRIGHT_TEST !== "1"
  ) {
    notFound()
  }

  setRequestLocale("en")
  const messages = await loadClientMessages(
    "en",
    LANGUAGE_INVENTORY_CLIENT_MESSAGE_NAMESPACES,
  )

  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <LanguageInventoryPage inventory={fixtureInventory()} />
    </NextIntlClientProvider>
  )
}
