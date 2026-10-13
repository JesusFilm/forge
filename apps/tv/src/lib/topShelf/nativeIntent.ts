import { Linking, Platform } from "react-native"

const SCHEME = "org.jesusfilm.forgetv:"
const TARGET = /^\/[a-zA-Z0-9_-]{1,160}$/

export function topShelfRoute(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== SCHEME ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !["watch", "top-shelf-topic"].includes(url.hostname) ||
      !TARGET.test(url.pathname) ||
      url.searchParams.getAll("autoplay").length > 1 ||
      url.searchParams.getAll("topShelf").length !== 1 ||
      url.searchParams.get("topShelf") !== "1"
    )
      return null
    const autoplay = url.searchParams.get("autoplay") === "1"
    return `/${url.hostname}${url.pathname}?topShelf=1${
      url.hostname === "watch" && autoplay ? "&autoplay=1" : ""
    }`
  } catch {
    return null
  }
}

function isRootLaunch(path: string): boolean {
  if (path === "" || path === "/") return true
  try {
    const url = new URL(path)
    return (
      url.protocol === SCHEME &&
      (url.hostname === "expo-development-client" ||
        (!url.hostname && (!url.pathname || url.pathname === "/")))
    )
  } catch {
    return false
  }
}

export async function redirectSystemPath({
  path,
  initial,
}: {
  path: string
  initial: boolean
}): Promise<string> {
  if (Platform.OS !== "ios" || !Platform.isTV) return path
  const direct = topShelfRoute(path)
  if (direct) return direct
  if (!initial || !isRootLaunch(path)) return path
  try {
    // Dev Launcher forwards the pending URL to RN launch options, not Expo Linking's registry.
    return topShelfRoute(await Linking.getInitialURL()) ?? path
  } catch {
    return path
  }
}
