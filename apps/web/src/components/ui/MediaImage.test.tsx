import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import MediaImage from "./MediaImage"
it("keeps stale Studio poster URLs on the canonical origin while Core images retain optimization", () => {
  const studio = "https://admin.test/api/studio/playback/release/poster.webp"
  const rendered = renderToStaticMarkup(
    <MediaImage src={studio} alt="Studio" width={100} height={100} />,
  )
  expect(rendered).toContain(`src="${studio}"`)
  expect(rendered).not.toContain("_next/image")
  const core = renderToStaticMarkup(
    <MediaImage src="/images/core.png" alt="Core" width={100} height={100} />,
  )
  expect(core).toContain("_next/image")
})
