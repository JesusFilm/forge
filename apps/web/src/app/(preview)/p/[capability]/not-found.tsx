import { WATCH_BASE_PATH } from "@/lib/routes"

export default function PublicPlaylistNotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-stone-950 px-5 text-center text-stone-100">
      <div className="max-w-lg">
        <h1 className="text-3xl font-black">This playlist is unavailable</h1>
        <a
          href={WATCH_BASE_PATH}
          referrerPolicy="no-referrer"
          className="mt-6 inline-flex min-h-11 items-center rounded-full bg-white px-5 font-bold text-stone-950 focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:ring-offset-4 focus-visible:ring-offset-stone-950 focus-visible:outline-none"
        >
          Back to Watch
        </a>
      </div>
    </main>
  )
}
