import Image from "next/image"
import { EyeOff, Users } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { formatDuration } from "@/lib/format-duration"
import {
  tryAsContentSlug,
  tryAsLocaleSlug,
  WATCH_BASE_PATH,
  watchVideoPath,
} from "@/lib/routes"
import type {
  LoadedPublicUserPlaylist,
  PublicUserPlaylistVideo,
} from "@/lib/user-playlist"
import type { PublicUserPlaylistBlock } from "@/lib/user-playlist-public-contract"
import { PublicUserPlaylistReportDialog } from "./PublicUserPlaylistReportDialog"

function videoHref(video: PublicUserPlaylistVideo): string | null {
  const slug = tryAsContentSlug(video.slug)
  const language = tryAsLocaleSlug(video.languageSlug)
  return slug && language
    ? `${WATCH_BASE_PATH}${watchVideoPath(slug, language)}`
    : null
}

function PublicVideoCard({ video }: { video: PublicUserPlaylistVideo }) {
  const href = videoHref(video)
  const content = (
    <>
      <div className="relative aspect-video overflow-hidden rounded-xl bg-[linear-gradient(135deg,#292524,#450a0a_52%,#052e16)]">
        {video.imageUrl ? (
          <Image
            src={video.imageUrl}
            alt={video.imageAlt}
            fill
            sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 360px"
            placeholder={video.blurDataUrl ? "blur" : "empty"}
            blurDataURL={video.blurDataUrl ?? undefined}
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : null}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-4 pt-16">
          <h3 className="line-clamp-2 text-base leading-6 font-bold text-white">
            {video.title}
          </h3>
          {video.durationSeconds != null ? (
            <p className="mt-1 text-xs text-stone-300">
              {formatDuration(video.durationSeconds)}
            </p>
          ) : null}
        </div>
      </div>
    </>
  )
  return href ? (
    <a
      href={href}
      referrerPolicy="no-referrer"
      className="group block rounded-xl focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:ring-offset-4 focus-visible:ring-offset-stone-950 focus-visible:outline-none"
    >
      {content}
    </a>
  ) : (
    <div>{content}</div>
  )
}

function PublicTextBlock({ block }: { block: { text: string } }) {
  return (
    <section className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
      <p className="whitespace-pre-wrap text-lg leading-8 text-stone-100 sm:text-xl sm:leading-9">
        {block.text}
      </p>
    </section>
  )
}

function PublicMediaBlock({
  block,
  videoById,
}: {
  block: Extract<
    PublicUserPlaylistBlock,
    { kind: "mediaCollection" | "videoCarousel" }
  >
  videoById: ReadonlyMap<string, PublicUserPlaylistVideo>
}) {
  const videos = block.videoIds.flatMap((id) => {
    const video = videoById.get(id)
    return video ? [video] : []
  })
  if (videos.length === 0) return null
  const isCarousel = block.kind === "videoCarousel"
  return (
    <section className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
      {block.title ? (
        <h2 className="mb-5 text-2xl font-bold text-white sm:text-3xl">
          {block.title}
        </h2>
      ) : null}
      <div
        className={
          isCarousel
            ? "flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 [&>*]:w-[82vw] [&>*]:max-w-sm [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-80"
            : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {videos.map((video) => (
          <PublicVideoCard key={video.id} video={video} />
        ))}
      </div>
    </section>
  )
}

export async function PublicUserPlaylistPage({
  data,
  intentTtlMs,
}: {
  data: LoadedPublicUserPlaylist
  intentTtlMs: number
}) {
  const t = await getTranslations({
    locale: data.uiLocale,
    namespace: "PublicUserPlaylist",
  })
  const videoById = new Map(data.videos.map((video) => [video.id, video]))
  const context = [data.playlist.locale, data.playlist.countryCode].filter(
    Boolean,
  )

  return (
    <main
      lang={data.playlist.locale}
      className="min-h-screen bg-stone-950 text-stone-100"
    >
      <header className="border-b border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(127,29,29,.38),transparent_45%),#0c0a09]">
        <div className="mx-auto grid w-full max-w-7xl gap-6 px-5 py-10 sm:px-8 sm:py-14 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-red-200 uppercase">
              <Users className="h-4 w-4" aria-hidden="true" />
              {t("communityCreated")}
            </p>
            <h1 className="mt-3 text-3xl leading-tight font-black break-words text-white sm:text-5xl">
              {data.playlist.title}
            </h1>
            {data.playlist.description ? (
              <p className="mt-4 max-w-3xl whitespace-pre-wrap text-base leading-7 text-stone-300 sm:text-lg">
                {data.playlist.description}
              </p>
            ) : null}
            {context.length > 0 ? (
              <p className="mt-4 text-sm text-stone-400">
                {t("context", { context: context.join(" · ") })}
              </p>
            ) : null}
            <div className="mt-5 flex max-w-3xl items-start gap-3 rounded-xl border border-amber-200/25 bg-amber-950/25 p-4 text-sm leading-6 text-amber-100">
              <EyeOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p>{t("unlistedNotice")}</p>
            </div>
          </div>
          <PublicUserPlaylistReportDialog
            reportIntent={data.playlist.reportIntent}
            intentTtlMs={intentTtlMs}
          />
        </div>
      </header>

      <div>
        {data.playlist.blocks.map((block, index) =>
          block.kind === "text" ? (
            <PublicTextBlock key={`text-${index}`} block={block} />
          ) : (
            <PublicMediaBlock
              key={`${block.kind}-${index}`}
              block={block}
              videoById={videoById}
            />
          ),
        )}
      </div>
    </main>
  )
}
