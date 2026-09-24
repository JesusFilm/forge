import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

const screens = [
  { stage: "photo", title: "1 · Photo" },
  { stage: "draw", title: "2 · Draw" },
  { stage: "editor", title: "3 · Drawing popup" },
  { stage: "send", title: "4 · Send" },
  { stage: "received", title: "5 · Received" },
]

export default function PreviewGallery() {
  if (process.env.NODE_ENV !== "development") notFound()
  return (
    <main className="preview-gallery">
      <header className="preview-header">
        <div>
          <p>WATCH BETA · DESIGN PREVIEW</p>
          <h1>All iPhone screens</h1>
          <span>
            Live components at 390 × 844. Open any screen to inspect it without
            completing earlier steps.
          </span>
        </div>
        <a href="/tv?platform=apple-tv">Open live form</a>
      </header>
      <div className="preview-scale" role="group" aria-label="Preview size">
        <label>
          <input
            id="preview-fit"
            type="radio"
            name="preview-size"
            defaultChecked
          />
          Fit all five
        </label>
        <label>
          <input id="preview-actual" type="radio" name="preview-size" />
          Actual iPhone size
        </label>
      </div>
      <div className="preview-phones">
        {screens.map((screen) => (
          <section className="preview-phone-card" key={screen.stage}>
            <div className="preview-phone-heading">
              <h2>{screen.title}</h2>
              <a href={`/tv/preview/frame?stage=${screen.stage}`}>Open ↗</a>
            </div>
            <div className="preview-phone-shell">
              <iframe
                title={screen.title}
                src={`/tv/preview/frame?stage=${screen.stage}&embed=1`}
                loading="eager"
              />
            </div>
          </section>
        ))}
      </div>
      <p className="preview-footer">
        Preview mode uses a sample image and never sends a report.
      </p>
    </main>
  )
}
