// feat-692 KTD9: an Android return reload reads the launch link again, so its
// first route goes to Home (R5). A start reload keeps its link: the reloaded
// runtime is the first one to read it.
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string
  initial: boolean
}): string {
  if (!initial) return path
  try {
    // A lazy require, like the root layout: a throwing import must not crash
    // the router before any error panel can render.
    /* eslint-disable-next-line @typescript-eslint/no-require-imports */
    const { afterReturnReload } = require("../src/i18n/layoutDirection") as {
      afterReturnReload: () => boolean
    }
    return afterReturnReload() ? "/" : path
  } catch {
    return path
  }
}
