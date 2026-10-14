import type { ReloadKind } from "../../modules/layout-direction"

type Controller = typeof import("./layoutDirection")

// A lazy require: the root layout guards the direction module's import, and a
// static import elsewhere would evaluate it first, outside that guard.
function readController<T>(
  read: (controller: Controller) => T,
  fallback: T,
): T {
  try {
    /* eslint-disable-next-line @typescript-eslint/no-require-imports */
    return read(require("./layoutDirection") as Controller)
  } catch {
    return fallback
  }
}

/** KTD9, for callers outside the root layout: false when the module fails. */
export function afterDirectionReturnReload(): boolean {
  return readController((controller) => controller.afterReturnReload(), false)
}

/** The kind of direction reload that started this runtime, or null. */
export function readDirectionReloadKind(): ReloadKind | null {
  return readController((controller) => controller.directionReloadKind(), null)
}
