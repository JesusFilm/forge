import Link from "next/link"

export function RegistryDisabled() {
  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Developer navigation">
        <div>
          <p className="eyebrow">Jesus Film</p>
          <h1>Developer</h1>
        </div>
        <nav>
          <Link href="/">Apps</Link>
        </nav>
        <div className="sidebar-note">
          <span>Auth pending</span>
          <strong>Registry disabled</strong>
        </div>
      </aside>

      <section className="workspace">
        <header className="page-header">
          <div>
            <p className="eyebrow">App Registry</p>
            <h2>Access pending</h2>
          </div>
          <div className="header-meta">developer.jesusfilm.org</div>
        </header>

        <section className="table-panel">
          <div className="empty-state">
            <p className="eyebrow">Configuration</p>
            <h3>Registry data is disabled for this deployment.</h3>
            <p>
              Enable read-only mode only behind the intended access boundary
              until the Developer OAuth session flow lands.
            </p>
          </div>
        </section>
      </section>
    </main>
  )
}
