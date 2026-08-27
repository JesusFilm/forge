export type SearchBackRouter = {
  canGoBack: () => boolean
  back: () => void
  replace: (href: "/") => void
}

export function navigateBackFromSearch(router: SearchBackRouter): true {
  if (router.canGoBack()) router.back()
  else router.replace("/")
  return true
}
