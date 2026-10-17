"use client"

import Image from "next/image"
import { useTranslations } from "next-intl"

/**
 * The poster for a player box whose `<video>` is behind the deferred chunk.
 *
 * The player is `ssr: false`, so its own `poster` attribute exists neither in
 * the server HTML nor while the chunk is in flight, and never at all if the
 * chunk fails. This layer is plain markup that renders on the server and stays
 * put. Render it BEFORE the player in the same positioned box: the player
 * paints over it once it has a poster or a frame, both `object-cover` over the
 * same box, so nothing has to hide or reveal it.
 *
 * `unoptimized` keeps the request what the `poster` attribute made — the
 * original URL, eagerly — so it costs no optimizer round-trip and is not
 * subject to the `remotePatterns` allowlist the attribute never needed.
 */
export function DeferredVideoPoster({ src }: { src: string }) {
  return (
    <div
      aria-hidden
      data-testid="deferred-video-poster"
      className="pointer-events-none absolute inset-0"
    >
      <Image
        src={src}
        alt=""
        fill
        unoptimized
        loading="eager"
        sizes="100vw"
        className="object-cover"
      />
    </div>
  )
}

/**
 * What a player box shows once its chunk has failed to load.
 *
 * The rejection is cached by the bundler runtime and by `React.lazy`, so the
 * only recovery is a full reload — which is what the button does. Nothing
 * here retries the `import()`; that is inert on Turbopack.
 */
export function DeferredVideoLoadFailed() {
  const t = useTranslations("ExperienceError")

  return (
    <div
      role="alert"
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/60 p-4 text-center text-white"
    >
      <p className="text-base font-semibold">{t("pageLoadFailed")}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-stone-950 transition hover:bg-stone-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {t("tryAgain")}
      </button>
    </div>
  )
}
