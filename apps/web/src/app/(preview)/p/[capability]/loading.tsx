export default function PublicPlaylistLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading community playlist"
      className="min-h-screen bg-stone-950 px-5 py-12 text-stone-100 sm:px-8"
    >
      <div className="mx-auto max-w-7xl animate-pulse">
        <div className="h-4 w-44 rounded bg-white/10" />
        <div className="mt-5 h-12 max-w-2xl rounded bg-white/10" />
        <div className="mt-4 h-20 max-w-3xl rounded bg-white/10" />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="aspect-video rounded-xl bg-white/10" />
          ))}
        </div>
      </div>
    </main>
  )
}
