export default function WatchRouteAlertsLoading() {
  return (
    <section
      className="mx-auto w-full max-w-[1500px] animate-pulse p-5 md:p-8"
      aria-label="Loading Watch route alerts"
    >
      <div className="h-4 w-32 rounded bg-[color:var(--ds-panel-muted)]" />
      <div className="mt-4 h-12 w-80 max-w-full rounded bg-[color:var(--ds-panel-muted)]" />
      <div className="mt-10 h-24 rounded-[var(--ds-radius)] bg-[color:var(--ds-panel-muted)]" />
      <div className="mt-8 h-72 rounded-[var(--ds-radius)] bg-[color:var(--ds-panel-muted)]" />
    </section>
  )
}
