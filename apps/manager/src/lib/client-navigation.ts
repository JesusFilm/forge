/** Editors may cancel imperative routing before callers commit associated UI state. */
export const CLIENT_NAVIGATION_REQUEST = "manager-client-navigation-request"

export function requestClientNavigation(href: string): boolean {
  return window.dispatchEvent(
    new CustomEvent<{ href: string }>(CLIENT_NAVIGATION_REQUEST, {
      cancelable: true,
      detail: { href },
    }),
  )
}
