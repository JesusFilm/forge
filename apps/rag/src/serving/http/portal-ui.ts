import { readFileSync } from "node:fs"

// Static assets contain no session identity, consumer data or issued credentials.
const asset = (name: string) =>
  readFileSync(new URL(`./portal-assets/${name}`, import.meta.url), "utf8")
export const portalHtml = asset("index.html")
export const portalCss = asset("portal.css")
export const portalScript = asset("portal.js")
// Vendored from Forge web/public/fonts; no runtime dependency on another app.
export const portalFonts = {
  "apercu-regular.woff2": readFileSync(
    new URL("./portal-assets/apercu-regular.woff2", import.meta.url),
  ),
  "apercu-bold.woff2": readFileSync(
    new URL("./portal-assets/apercu-bold.woff2", import.meta.url),
  ),
}
export const portalCsp =
  "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
