import { expect, it } from "vitest"
import { previewFrame } from "./preview-frame"
it("keeps source text from closing the fixed script and supplies a closed document policy", () => {
  const html = previewFrame('console.log("</script><img src=x>")')
  expect(html.match(/<\/script>/g)).toHaveLength(1)
  expect(html).toContain("form-action 'none'")
  expect(html).toContain("default-src 'none'")
  expect(html).not.toContain("script-src https:")
  expect(html).toContain("worker-src blob:")
})
