/** No Manager/network script origin, credentials, forms or same-origin privilege. */
export function previewFrame(runtime: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; connect-src https://mux.com https://*.mux.com https://api-media-core.jesusfilm.org blob:; media-src https://mux.com https://*.mux.com https://api-media-core.jesusfilm.org blob:; img-src blob: data:; worker-src blob:; base-uri 'none'; form-action 'none'"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:black}</style></head><body><div id="root"></div><script>${runtime.replace(/<\/script/gi, "<\\/script")}</script></body></html>`
}
